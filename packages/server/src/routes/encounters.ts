import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm } from '../services/authz.js';
import {
  addParticipantSchema,
  applyActionEconomySchema,
  createEncounterSchema,
  rollInitiativeSchema,
  setInitiativeSchema,
  setParticipantFactionSchema,
  setParticipantPositionSchema,
  updateEncounterSchema,
  upsertCellOverrideSchema,
  upsertEncounterMapSchema,
} from '../schemas/encounters.js';
import { performShoveSchema } from '../schemas/shove.js';
import * as encountersService from '../services/encounters.js';
import { performShove } from '../services/shove.js';
import * as entityFieldRevealService from '../services/entityFieldReveal.js';
import {
  getIo,
  broadcastCombatStarted,
  broadcastCombatEnded,
  broadcastInitiativeRolled,
  broadcastTurnAdvanced,
  broadcastParticipantJoined,
  broadcastParticipantLeft,
  broadcastEffectExpired,
  broadcastMapUpdated,
  broadcastTokenMoved,
  broadcastParticipantFactionChanged,
  broadcastActionEconomyChanged,
  broadcastDiceRolled,
  broadcastFullStateResync,
  pushEncounterRoomJoinForOwner,
} from '../sockets/broadcast.js';

// Mounted at /campaigns/:id/encounters — nested CRUD (id under the campaign
// prefix, same convention as monster-instances). A campaign can have several
// encounters with status='active' at once; never assume a single one.
export const campaignEncountersRouter = Router({ mergeParams: true });
campaignEncountersRouter.use(requireAuth, requireCampaignMember());

campaignEncountersRouter.get('/', async (req, res) => {
  const encounters = await encountersService.listEncounters(pool, req.campaignId!);
  res.json({ encounters });
});

campaignEncountersRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createEncounterSchema.parse(req.body);
  const encounter = await encountersService.createEncounter(pool, req.campaignId!, input);
  res.status(201).json({ encounter });
});

campaignEncountersRouter.get('/:encounterId', async (req, res) => {
  const encounter = await encountersService.getEncounter(pool, req.campaignId!, Number(req.params.encounterId));
  res.json({ encounter });
});

campaignEncountersRouter.patch('/:encounterId', requireRole('dm'), async (req, res) => {
  const input = updateEncounterSchema.parse(req.body);
  const encounter = await encountersService.updateEncounter(pool, req.campaignId!, Number(req.params.encounterId), input);
  res.json({ encounter });
});

campaignEncountersRouter.delete('/:encounterId', requireRole('dm'), async (req, res) => {
  await encountersService.deleteEncounter(pool, req.campaignId!, Number(req.params.encounterId));
  res.status(204).send();
});

// Mounted at /encounters — flat action routes (start/end/participants/
// roll-initiative/advance-turn). No campaignId in the URL, so this local
// middleware derives it from the encounter row itself, then applies the
// usual membership + DM-role checks (combat control is a DM tool).
async function requireEncounterDm(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const encounterId = Number(req.params.id);
  if (!Number.isInteger(encounterId)) throw new AppError('VALIDATION_ERROR', 'Invalid encounter id');

  const result = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');

  const role = await requireMembership(pool, row.campaign_id, req.user!.id);
  requireDm(role);
  next();
}

// Player-or-DM gate for /participants/:pid/action-economy ONLY (battle mode,
// REVISION-PLAN.md §10.2) — every other route in this file stays
// requireEncounterDm-gated exactly as before. A player needs to spend their
// OWN character's action-economy slots during their turn; the DM still needs
// to be able to act on any participant (e.g. running an NPC's turn). The
// resolve-participant + membership + owner-or-DM check itself lives in
// services/encounters.ts's authorizeParticipantAction so it's testable
// without Express, matching requireEncounterDm's own "thin wrapper around a
// services/authz.ts call" shape just above.
async function requireOwnParticipantOrDm(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const encounterId = Number(req.params.id);
  const participantId = Number(req.params.pid);
  if (!Number.isInteger(encounterId) || !Number.isInteger(participantId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid encounter or participant id');
  }
  await encountersService.authorizeParticipantAction(pool, req.user!.id, encounterId, participantId);
  next();
}

export const encountersRouter = Router();
encountersRouter.use(requireAuth);

// Flat read (REFACTOR-PLAN.md §1: powers /maps/:mapId, a standalone
// full-screen route reached with only an encounter id, no campaignId in the
// URL). Membership-gated, not DM-only — players need to view the map too.
encountersRouter.get('/:id', async (req, res) => {
  const encounter = await encountersService.getEncounterFlat(pool, req.user!.id, Number(req.params.id));
  res.json({ encounter });
});

encountersRouter.post('/:id/start', requireEncounterDm, async (req, res) => {
  const encounter = await encountersService.startEncounter(pool, Number(req.params.id));
  broadcastCombatStarted(getIo(req.app), encounter);
  res.json({ encounter });
});

encountersRouter.post('/:id/end', requireEncounterDm, async (req, res) => {
  const encounter = await encountersService.endEncounter(pool, Number(req.params.id));
  broadcastCombatEnded(getIo(req.app), encounter);
  res.json({ encounter });
});

// "Reset reveals for this encounter" (PLAN.md §11.5) — scoped to entities
// currently seated in it. Same "push a full resync instead of a pile of
// per-field events" reasoning as /campaigns/:id/reveals/hide-all.
encountersRouter.post('/:id/reveals/reset', requireEncounterDm, async (req, res) => {
  const encounterId = Number(req.params.id);
  const { campaignId } = await entityFieldRevealService.resetRevealsForEncounter(pool, req.user!.id, encounterId);
  await broadcastFullStateResync(getIo(req.app), encounterId, campaignId);
  res.status(204).send();
});

encountersRouter.post('/:id/participants', requireEncounterDm, async (req, res) => {
  const input = addParticipantSchema.parse(req.body);
  const { encounter, participant } = await encountersService.addParticipant(pool, Number(req.params.id), input);
  const io = getIo(req.app);
  broadcastParticipantJoined(io, encounter, participant);
  await pushEncounterRoomJoinForOwner(io, pool, encounter.id, encounter.campaign_id, participant.character_id);
  res.status(201).json({ participant });
});

encountersRouter.delete('/:id/participants/:pid', requireEncounterDm, async (req, res) => {
  const { encounter, participant } = await encountersService.removeParticipant(
    pool, Number(req.params.id), Number(req.params.pid),
  );
  broadcastParticipantLeft(getIo(req.app), encounter, participant);
  res.status(204).send();
});

encountersRouter.patch('/:id/participants/:pid/initiative', requireEncounterDm, async (req, res) => {
  const input = setInitiativeSchema.parse(req.body);
  const participant = await encountersService.setParticipantInitiative(
    pool, Number(req.params.id), Number(req.params.pid), input,
  );
  res.json({ participant });
});

encountersRouter.post('/:id/roll-initiative', requireEncounterDm, async (req, res) => {
  const input = rollInitiativeSchema.parse(req.body ?? {});
  const result = await encountersService.rollInitiative(pool, Number(req.params.id), input.force);
  broadcastInitiativeRolled(getIo(req.app), result.encounter, result.participants);
  res.json(result);
});

encountersRouter.post('/:id/advance-turn', requireEncounterDm, async (req, res) => {
  const result = await encountersService.advanceTurn(pool, Number(req.params.id));
  const io = getIo(req.app);
  broadcastTurnAdvanced(io, result.encounter, result.participants);
  // Round-based effects that just hit zero duration (services/encounters.ts's
  // advanceTurn decrements 'rounds' effects in the same transaction as the
  // turn advance) all share this turn advance's bumped sync_seq — see
  // broadcast.ts's batching-choice comment on broadcastEffectExpired for why
  // this is one event per expired effect rather than one batched event.
  const sync = { encounter_id: result.encounter.id, campaign_id: result.encounter.campaign_id, sync_seq: result.encounter.sync_seq };
  for (const expired of result.expiredEffects) {
    await broadcastEffectExpired(io, sync, expired, expired.effect_definition_name);
  }
  res.json(result);
});

// Battle map (Phase 3.3). Same requireEncounterDm guard as /start, /end,
// etc. — placing tokens and configuring the map is a DM tool.
encountersRouter.put('/:id/map', requireEncounterDm, async (req, res) => {
  const input = upsertEncounterMapSchema.parse(req.body);
  const { encounter, map } = await encountersService.upsertEncounterMap(pool, Number(req.params.id), input);
  broadcastMapUpdated(getIo(req.app), encounter, map);
  res.json({ map: encountersService.formatMapForWire(map) });
});

encountersRouter.patch('/:id/participants/:pid/position', requireEncounterDm, async (req, res) => {
  const input = setParticipantPositionSchema.parse(req.body);
  const { encounter, participant } = await encountersService.setParticipantPosition(
    pool, Number(req.params.id), Number(req.params.pid), input,
  );
  broadcastTokenMoved(getIo(req.app), encounter, participant);
  res.json({ participant });
});

// REFACTOR-PLAN.md §4: "selecting a character highlights reachable cells."
// Membership-gated (not DM-only) via requireEncounterDm being swapped for a
// plain membership check — a player should be able to see their OWN
// reachable cells too, not just the DM. Reuses requireOwnParticipantOrDm's
// shape (owner-or-DM), same as the action-economy route just below.
encountersRouter.get('/:id/participants/:pid/reachable', requireOwnParticipantOrDm, async (req, res) => {
  const result = await encountersService.getParticipantReachableCells(pool, Number(req.params.id), Number(req.params.pid));
  res.json(result);
});

// Terrain cell overrides (REFACTOR-PLAN.md §4). DM-only, same guard as the
// rest of the map-configuration surface above.
encountersRouter.get('/:id/map/cell-overrides', requireEncounterDm, async (req, res) => {
  const overrides = await encountersService.listMapCellOverrides(pool, Number(req.params.id));
  res.json({ overrides });
});

encountersRouter.put('/:id/map/cell-overrides/:x/:y', requireEncounterDm, async (req, res) => {
  const input = upsertCellOverrideSchema.parse(req.body);
  const { encounter, map } = await encountersService.upsertMapCellOverride(
    pool, Number(req.params.id), Number(req.params.x), Number(req.params.y), input,
  );
  broadcastMapUpdated(getIo(req.app), encounter, map);
  res.status(204).send();
});

encountersRouter.delete('/:id/map/cell-overrides/:x/:y', requireEncounterDm, async (req, res) => {
  const result = await encountersService.deleteMapCellOverride(
    pool, Number(req.params.id), Number(req.params.x), Number(req.params.y),
  );
  if (result) broadcastMapUpdated(getIo(req.app), result.encounter, result.map);
  res.status(204).send();
});

// Per-turn action economy (Phase 3.6). Unlike every other combat_participants
// mutation in this file, this ONE route also allows the owning player (battle
// mode, REVISION-PLAN.md §10.2) — see requireOwnParticipantOrDm above.
// REFACTOR-PLAN.md §3: DM-only (requireEncounterDm, same as position/map) —
// board-readability metadata, not a player action.
encountersRouter.patch('/:id/participants/:pid/faction', requireEncounterDm, async (req, res) => {
  const input = setParticipantFactionSchema.parse(req.body);
  const { encounter, participant } = await encountersService.setParticipantFaction(
    pool, Number(req.params.id), Number(req.params.pid), input,
  );
  broadcastParticipantFactionChanged(getIo(req.app), encounter, participant);
  res.json({ participant });
});

encountersRouter.patch('/:id/participants/:pid/action-economy', requireOwnParticipantOrDm, async (req, res) => {
  const input = applyActionEconomySchema.parse(req.body);
  const { encounter, participant } = await encountersService.applyActionEconomy(
    pool, Number(req.params.id), Number(req.params.pid), input,
  );
  broadcastActionEconomyChanged(getIo(req.app), encounter, participant);
  res.json({ participant });
});

// REFACTOR-PLAN.md §5 ("allow the DM to undo") — DM-only, unlike the spend
// route just above: undo is a DM correction tool, not a player action, so
// this stays on requireEncounterDm rather than requireOwnParticipantOrDm.
encountersRouter.post('/:id/participants/:pid/action-economy/undo', requireEncounterDm, async (req, res) => {
  const { encounter, participant } = await encountersService.undoActionEconomy(
    pool, Number(req.params.id), Number(req.params.pid),
  );
  broadcastActionEconomyChanged(getIo(req.app), encounter, participant);
  res.json({ participant });
});

// Shove Check Against a Specific NPC (Phase 3.7). Same requireEncounterDm
// guard as the rest of this file — the DM triggers the contested roll on
// behalf of whichever PC's turn it is, same as every other combat mutation.
encountersRouter.post('/:id/participants/:pid/shove', requireEncounterDm, async (req, res) => {
  const input = performShoveSchema.parse(req.body);
  const shove = await performShove(pool, Number(req.params.id), Number(req.params.pid), req.user!.id, input);
  const io = getIo(req.app);
  broadcastActionEconomyChanged(io, shove.encounter, shove.participant);
  await broadcastDiceRolled(io, shove.encounter.campaign_id, shove.attackerRoll);
  if (shove.defenderRoll) {
    await broadcastDiceRolled(io, shove.encounter.campaign_id, shove.defenderRoll);
  }
  res.json({
    participant: shove.participant,
    attackerRoll: shove.attackerRoll,
    defenderRoll: shove.defenderRoll,
    defenderTotal: shove.defenderTotal,
    defenderOverridden: shove.defenderOverridden,
    success: shove.success,
    outcome: shove.outcome,
    message: shove.message,
  });
});
