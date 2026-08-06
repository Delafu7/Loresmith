import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { AppError, notFound } from '../middleware/errors.js';
import { isUuid } from '../domain/ids.js';
import { requireMembership, requireDm, type CampaignRole } from '../services/authz.js';
import {
  addParticipantSchema,
  applyActionEconomySchema,
  createEncounterSchema,
  rollInitiativeSchema,
  setEncounterModeSchema,
  setInitiativeSchema,
  setParticipantFactionSchema,
  setParticipantPositionSchema,
  setParticipantVisibilitySchema,
  spawnParticipantsSchema,
  transitionDispositionSchema,
  updateEncounterSchema,
  upsertCellOverrideSchema,
  upsertEncounterMapSchema,
} from '../schemas/encounters.js';
import { performShoveSchema } from '../schemas/shove.js';
import { performGrappleSchema } from '../schemas/grapple.js';
import { recordActionSchema } from '../schemas/combatActions.js';
import * as encountersService from '../services/encounters.js';
import * as spawnService from '../services/spawn.js';
import { performShove } from '../services/shove.js';
import { performGrapple } from '../services/grapple.js';
import * as entityFieldRevealService from '../services/entityFieldReveal.js';
import * as combatActionsService from '../services/combatActions.js';
import * as mapsService from '../services/maps.js';
import { setActiveMapSchema } from '../schemas/maps.js';
import {
  getIo,
  broadcastCombatStarted,
  broadcastCombatEnded,
  broadcastInitiativeRolled,
  broadcastTurnAdvanced,
  broadcastParticipantJoined,
  broadcastParticipantLeft,
  broadcastEffectApplied,
  broadcastEffectExpired,
  broadcastMapUpdated,
  broadcastTokenMoved,
  broadcastModeChanged,
  broadcastDispositionChanged,
  broadcastParticipantFactionChanged,
  broadcastActionEconomyChanged,
  broadcastDiceRolled,
  broadcastFullStateResync,
  broadcastActionRecorded,
  broadcastEncounterOpened,
  pushEncounterRoomJoinForOwner,
} from '../sockets/broadcast.js';

// Mounted at /campaigns/:id/encounters — nested CRUD (id under the campaign
// prefix, same convention as monster-instances). A campaign can have several
// encounters with status='active' at once; never assume a single one.
export const campaignEncountersRouter = Router({ mergeParams: true });
campaignEncountersRouter.use(requireAuth, requireCampaignMember());

campaignEncountersRouter.get('/', async (req, res) => {
  const encounters = await encountersService.listEncounters(pool, req.campaignId!, req.campaignRole!);
  res.json({ encounters });
});

campaignEncountersRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createEncounterSchema.parse(req.body);
  const encounter = await encountersService.createEncounter(pool, req.campaignId!, input);
  res.status(201).json({ encounter });
});

// Map-first encounter system: "on reload/reconnect, land directly in the
// current fullscreen map." Registered before the /:encounterId route below
// so Express matches this literal path first — /:encounterId would otherwise
// swallow "my-live" as an encounter id and hit a Postgres uuid-cast error
// instead of a clean route match.
campaignEncountersRouter.get('/my-live', async (req, res) => {
  const encounter = await encountersService.getMyLiveEncounter(pool, req.campaignId!, req.user!.id, req.campaignRole!);
  res.json({ encounter });
});

campaignEncountersRouter.get('/:encounterId', async (req, res) => {
  const encounter = await encountersService.getEncounter(
    pool, req.campaignId!, (req.params.encounterId as string), req.campaignRole!,
  );
  res.json({ encounter });
});

campaignEncountersRouter.patch('/:encounterId', requireRole('dm'), async (req, res) => {
  const input = updateEncounterSchema.parse(req.body);
  const encounter = await encountersService.updateEncounter(pool, req.campaignId!, (req.params.encounterId as string), input);
  res.json({ encounter });
});

campaignEncountersRouter.delete('/:encounterId', requireRole('dm'), async (req, res) => {
  await encountersService.deleteEncounter(pool, req.campaignId!, (req.params.encounterId as string));
  res.status(204).send();
});

// Mounted at /encounters — flat action routes (start/end/participants/
// roll-initiative/advance-turn). No campaignId in the URL, so this local
// middleware derives it from the encounter row itself, then applies the
// usual membership + DM-role checks (combat control is a DM tool).
async function requireEncounterDm(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const encounterId = (req.params.id as string);
  if (!isUuid(encounterId)) throw new AppError('VALIDATION_ERROR', 'Invalid encounter id');

  const result = await pool.query<{ campaign_id: string }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');

  const role = await requireMembership(pool, row.campaign_id, req.user!.id);
  requireDm(role);
  next();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Resolved by requireOwnParticipantOrDm — the position route needs the
      // actual role (not just "allowed or not") to know whether combat-mode
      // turn/budget validation applies (DM stays unconditional; a player is
      // additionally required to be on their own turn — see
      // services/encounters.ts's computeValidatedMoveCost).
      participantActionRole?: CampaignRole;
    }
  }
}

// Player-or-DM gate for /participants/:pid/action-economy AND
// /participants/:pid/position (battle mode, REVISION-PLAN.md §10.2 +
// exploration/combat modes) — every other route in this file stays
// requireEncounterDm-gated exactly as before. A player needs to spend their
// OWN character's action-economy slots during their turn, and move their OWN
// token; the DM still needs to be able to act on any participant (e.g.
// running an NPC's turn). The resolve-participant + membership + owner-or-DM
// check itself lives in services/encounters.ts's authorizeParticipantAction
// so it's testable without Express, matching requireEncounterDm's own "thin
// wrapper around a services/authz.ts call" shape just above.
async function requireOwnParticipantOrDm(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const encounterId = (req.params.id as string);
  const participantId = (req.params.pid as string);
  if (!isUuid(encounterId) || !isUuid(participantId)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid encounter or participant id');
  }
  req.participantActionRole = await encountersService.authorizeParticipantAction(pool, req.user!.id, encounterId, participantId);
  next();
}

export const encountersRouter = Router();
encountersRouter.use(requireAuth);

// Flat read (REFACTOR-PLAN.md §1: powers /maps/:mapId, a standalone
// full-screen route reached with only an encounter id, no campaignId in the
// URL). Membership-gated, not DM-only — players need to view the map too.
encountersRouter.get('/:id', async (req, res) => {
  const encounter = await encountersService.getEncounterFlat(pool, req.user!.id, (req.params.id as string));
  res.json({ encounter });
});

// Map-first encounter system: 'preparing' -> 'active' is the moment a
// non-DM socket is first allowed to join this encounter's room at all
// (assertCanJoinEncounter, sockets/rooms.ts) — i.e. this IS "the GM opens
// the map." broadcastEncounterOpened pushes every relevant player straight
// into the fullscreen live map with zero clicks, on top of the existing
// broadcastCombatStarted (which only reaches sockets already in the
// encounter room).
encountersRouter.post('/:id/start', requireEncounterDm, async (req, res) => {
  const encounter = await encountersService.startEncounter(pool, (req.params.id as string));
  const io = getIo(req.app);
  broadcastCombatStarted(io, encounter);
  await broadcastEncounterOpened(io, pool, encounter, encounter.name as string, false);
  res.json({ encounter });
});

encountersRouter.post('/:id/end', requireEncounterDm, async (req, res) => {
  const encounter = await encountersService.endEncounter(pool, (req.params.id as string));
  broadcastCombatEnded(getIo(req.app), encounter);
  res.json({ encounter });
});

// The atomic "Start combat" action (map-first encounter system): rolls
// initiative for everyone and sets the active-participant pointer in one
// step — see services/encounters.ts's startCombat for why this replaced the
// old two-click "toggle mode, then separately roll initiative" flow. Full
// resync (not a narrower event) because this can touch mode, round, turn
// index, active participant, AND every participant's initiative/turn_order
// all at once — reusing the granular MODE_CHANGED/INITIATIVE_ROLLED/
// TURN_ADVANCED events for one atomic action would mean the client
// reconciling three partial patches for something that's really one state
// transition.
encountersRouter.post('/:id/start-combat', requireEncounterDm, async (req, res) => {
  const { encounter, participants } = await encountersService.startCombat(pool, (req.params.id as string));
  await broadcastFullStateResync(getIo(req.app), encounter.id, encounter.campaign_id);
  res.json({ encounter, participants });
});

// DM control to force every relevant player back into fullscreen (map-first
// encounter system) regardless of whether they'd minimized it — same push
// as /start, just explicitly re-triggerable and always "forced" (overrides
// a player's own minimized preference; ENCOUNTER_OPENED, by contrast,
// respects it). No encounter-state mutation, so no broadcastFullStateResync.
encountersRouter.post('/:id/force-fullscreen', requireEncounterDm, async (req, res) => {
  const encounterId = req.params.id as string;
  const result = await pool.query<{ id: string; campaign_id: string; name: string; sync_seq: number }>(
    `SELECT id, campaign_id, name, sync_seq FROM encounters WHERE id = $1`,
    [encounterId],
  );
  const encounter = result.rows[0];
  if (!encounter) throw notFound('Encounter');
  await broadcastEncounterOpened(getIo(req.app), pool, encounter, encounter.name, true);
  res.status(204).send();
});

// Resets every monster instance currently seated in this encounter back to
// "weaknesses hidden" — a single fresh FULL_STATE_SYNC instead of a pile of
// per-field REVEAL_CHANGED events.
encountersRouter.post('/:id/reveals/reset', requireEncounterDm, async (req, res) => {
  const encounterId = (req.params.id as string);
  const { campaignId } = await entityFieldRevealService.resetRevealsForEncounter(pool, req.user!.id, encounterId);
  await broadcastFullStateResync(getIo(req.app), encounterId, campaignId);
  res.status(204).send();
});

encountersRouter.post('/:id/participants', requireEncounterDm, async (req, res) => {
  const input = addParticipantSchema.parse(req.body);
  const { encounter, participant } = await encountersService.addParticipant(pool, (req.params.id as string), input);
  const io = getIo(req.app);
  broadcastParticipantJoined(io, encounter, participant);
  await pushEncounterRoomJoinForOwner(io, pool, encounter.id, encounter.campaign_id, participant.character_id);
  res.status(201).json({ participant });
});

// Iteration 2 "Fast add/spawn UX" — batched sibling of POST /:id/participants
// above: one request creates N monster_instances + N combat_participants
// instead of the client driving N sequential create+seat round-trips. A
// single FULL_STATE_SYNC push (not a new granular socket event) tells every
// connected client about the whole batch at once — mirrors how
// PARTICIPANT_JOINED's own minimal payload already can't carry display
// name/HP/AC, so useEncounterLive.ts just resyncs on receipt anyway; pushing
// the resync directly here skips that extra client round-trip.
encountersRouter.post('/:id/spawn', requireEncounterDm, async (req, res) => {
  const input = spawnParticipantsSchema.parse(req.body);
  const { encounter, participants } = await spawnService.spawnParticipants(pool, (req.params.id as string), input);
  await broadcastFullStateResync(getIo(req.app), encounter.id as string, encounter.campaign_id as string);
  res.status(201).json({ participants });
});

encountersRouter.delete('/:id/participants/:pid', requireEncounterDm, async (req, res) => {
  const { encounter, participant } = await encountersService.removeParticipant(
    pool, (req.params.id as string), (req.params.pid as string),
  );
  broadcastParticipantLeft(getIo(req.app), encounter, participant);
  res.status(204).send();
});

encountersRouter.patch('/:id/participants/:pid/initiative', requireEncounterDm, async (req, res) => {
  const input = setInitiativeSchema.parse(req.body);
  const participant = await encountersService.setParticipantInitiative(
    pool, (req.params.id as string), (req.params.pid as string), input,
  );
  res.json({ participant });
});

encountersRouter.post('/:id/roll-initiative', requireEncounterDm, async (req, res) => {
  const input = rollInitiativeSchema.parse(req.body ?? {});
  const result = await encountersService.rollInitiative(pool, (req.params.id as string), input.force);
  broadcastInitiativeRolled(getIo(req.app), result.encounter, result.participants);
  res.json(result);
});

encountersRouter.post('/:id/advance-turn', requireEncounterDm, async (req, res) => {
  const result = await encountersService.advanceTurn(pool, (req.params.id as string));
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
  const { encounter, map } = await encountersService.upsertEncounterMap(pool, (req.params.id as string), input);
  broadcastMapUpdated(getIo(req.app), encounter, map);
  res.json({ map: encountersService.formatMapForWire(map) });
});

// Campaign-scoped map library (1784269788666_create-campaign-maps-library.ts)
// — the N:M link/unlink/activate actions for THIS encounter. DM-only, same
// guard as every other map-configuration route above. Library CRUD itself
// (create/rename/delete a map) lives in routes/maps.ts's campaignMapsRouter.
encountersRouter.get('/:id/maps', requireEncounterDm, async (req, res) => {
  const maps = await mapsService.listMapsForEncounter(pool, req.params.id as string);
  res.json({ maps });
});

encountersRouter.post('/:id/maps/:mapId/link', requireEncounterDm, async (req, res) => {
  await mapsService.linkMapToEncounter(pool, req.params.id as string, req.params.mapId as string);
  res.status(204).send();
});

// Unlinking the currently active map is a bigger change than a routine map-
// settings tweak — a resync, not a MAP_UPDATED tick, same "genuinely
// changes what's visible" precedent as the participant-visibility route
// above. Unlinking a non-active map has nothing to broadcast (see
// unlinkMapFromEncounter's own comment).
encountersRouter.delete('/:id/maps/:mapId/link', requireEncounterDm, async (req, res) => {
  const result = await mapsService.unlinkMapFromEncounter(pool, req.params.id as string, req.params.mapId as string);
  if (result) await broadcastFullStateResync(getIo(req.app), result.encounter.id, result.encounter.campaign_id);
  res.status(204).send();
});

encountersRouter.post('/:id/active-map', requireEncounterDm, async (req, res) => {
  const input = setActiveMapSchema.parse(req.body);
  const { encounter, map } = await mapsService.setActiveMap(pool, req.params.id as string, input.mapId);
  broadcastMapUpdated(getIo(req.app), encounter, map!);
  res.json({ map: encountersService.formatMapForWire(map) });
});

// DM-or-owning-player (exploration/combat modes) — was requireEncounterDm
// (DM-only) until players could move their own token at all. Authorization
// (own participant or DM) is requireOwnParticipantOrDm's job; whether the
// move is actually PERMITTED right now (mode, turn order, movement budget)
// is services/encounters.ts's computeValidatedMoveCost's job, driven by the
// resolved role stashed on the request.
encountersRouter.patch('/:id/participants/:pid/position', requireOwnParticipantOrDm, async (req, res) => {
  const input = setParticipantPositionSchema.parse(req.body);
  const { encounter, participant } = await encountersService.setParticipantPosition(
    pool, (req.params.id as string), (req.params.pid as string), input, req.participantActionRole!,
  );
  broadcastTokenMoved(getIo(req.app), encounter, participant);
  res.json({ participant });
});

// Exploration vs. combat mode toggle — DM-only, independent of status.
encountersRouter.patch('/:id/mode', requireEncounterDm, async (req, res) => {
  const input = setEncounterModeSchema.parse(req.body);
  const encounter = await encountersService.setEncounterMode(pool, (req.params.id as string), input);
  broadcastModeChanged(getIo(req.app), encounter);
  res.json({ encounter });
});

// Encounter-level disposition transition (friendly/neutral/hostile/unknown)
// — a POST action, not a PATCH, since it's a first-class logged transition
// (see 1784269787666's header comment), not a raw field edit. DM-only, same
// guard as the rest of the combat-control surface in this file.
encountersRouter.post('/:id/disposition', requireEncounterDm, async (req, res) => {
  const input = transitionDispositionSchema.parse(req.body);
  const { encounter, event } = await encountersService.transitionDisposition(
    pool, (req.params.id as string), input, req.user!.id,
  );
  broadcastDispositionChanged(getIo(req.app), encounter, {
    id: event.id,
    fromDisposition: event.from_disposition,
    toDisposition: event.to_disposition,
    changedByUserId: event.changed_by_user_id,
    note: event.note,
    createdAt: event.created_at,
  });
  res.json({ encounter, event });
});

// History log for the disposition control (membership-gated, not DM-only —
// same reasoning as GET /:id/actions just below: players should see why
// the scene's mood changed, not just the DM).
encountersRouter.get('/:id/disposition/events', async (req, res) => {
  const encounterId = req.params.id as string;
  const result = await pool.query<{ campaign_id: string }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');
  await requireMembership(pool, row.campaign_id, req.user!.id);
  const events = await encountersService.listDispositionEvents(pool, encounterId);
  res.json({ events });
});

// REFACTOR-PLAN.md §4: "selecting a character highlights reachable cells."
// Membership-gated (not DM-only) via requireEncounterDm being swapped for a
// plain membership check — a player should be able to see their OWN
// reachable cells too, not just the DM. Reuses requireOwnParticipantOrDm's
// shape (owner-or-DM), same as the action-economy route just below.
encountersRouter.get('/:id/participants/:pid/reachable', requireOwnParticipantOrDm, async (req, res) => {
  const result = await encountersService.getParticipantReachableCells(pool, (req.params.id as string), (req.params.pid as string));
  res.json(result);
});

// Terrain cell overrides (REFACTOR-PLAN.md §4). DM-only, same guard as the
// rest of the map-configuration surface above.
encountersRouter.get('/:id/map/cell-overrides', requireEncounterDm, async (req, res) => {
  const overrides = await encountersService.listMapCellOverrides(pool, (req.params.id as string));
  res.json({ overrides });
});

encountersRouter.put('/:id/map/cell-overrides/:x/:y', requireEncounterDm, async (req, res) => {
  const input = upsertCellOverrideSchema.parse(req.body);
  const { encounter, map } = await encountersService.upsertMapCellOverride(
    pool, (req.params.id as string), Number(req.params.x), Number(req.params.y), input,
  );
  broadcastMapUpdated(getIo(req.app), encounter, map);
  res.status(204).send();
});

encountersRouter.delete('/:id/map/cell-overrides/:x/:y', requireEncounterDm, async (req, res) => {
  const result = await encountersService.deleteMapCellOverride(
    pool, (req.params.id as string), Number(req.params.x), Number(req.params.y),
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
    pool, (req.params.id as string), (req.params.pid as string), input,
  );
  broadcastParticipantFactionChanged(getIo(req.app), encounter, participant);
  res.json({ participant });
});

// Encounter visibility by state (nav point 1) — DM-only, e.g. revealing an
// ambush monster mid-fight. Broadcasts a role-split resync (not a dedicated
// event) since this genuinely changes what a player can see, not just a
// display detail.
encountersRouter.patch('/:id/participants/:pid/visibility', requireEncounterDm, async (req, res) => {
  const input = setParticipantVisibilitySchema.parse(req.body);
  const { encounter, participant } = await encountersService.setParticipantVisibility(
    pool, (req.params.id as string), (req.params.pid as string), input,
  );
  await broadcastFullStateResync(getIo(req.app), encounter.id, encounter.campaign_id);
  res.json({ participant });
});

// Action recording / combat log (nav point 2). Not requireEncounterDm —
// authorization is per-actor (DM, or the actor participant's owning player),
// resolved inside combatActionsService.recordAction via the same
// authorizeParticipantAction gate the action-economy route below uses.
encountersRouter.post('/:id/actions', async (req, res) => {
  const input = recordActionSchema.parse(req.body);
  const encounterId = req.params.id as string;
  const action = await combatActionsService.recordAction(pool, req.user!.id, encounterId, input);
  const encounterRes = await pool.query<{ campaign_id: string }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const campaignId = encounterRes.rows[0]?.campaign_id;
  if (campaignId) await broadcastActionRecorded(getIo(req.app), pool, action, campaignId);
  res.status(201).json({ action });
});

// Membership-gated (any campaign role), not DM-only — players read the log
// too, filtered to what's visible to them (nav point 1).
encountersRouter.get('/:id/actions', async (req, res) => {
  const encounterId = req.params.id as string;
  const encounterRes = await pool.query<{ campaign_id: string }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const row = encounterRes.rows[0];
  if (!row) throw notFound('Encounter');
  const role = await requireMembership(pool, row.campaign_id, req.user!.id);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  const actions = await combatActionsService.listActionsForEncounter(pool, encounterId, role, { limit, offset });
  res.json({ actions });
});

encountersRouter.patch('/:id/participants/:pid/action-economy', requireOwnParticipantOrDm, async (req, res) => {
  const input = applyActionEconomySchema.parse(req.body);
  const { encounter, participant } = await encountersService.applyActionEconomy(
    pool, (req.params.id as string), (req.params.pid as string), input,
  );
  broadcastActionEconomyChanged(getIo(req.app), encounter, participant);
  res.json({ participant });
});

// REFACTOR-PLAN.md §5 ("allow the DM to undo") — DM-only, unlike the spend
// route just above: undo is a DM correction tool, not a player action, so
// this stays on requireEncounterDm rather than requireOwnParticipantOrDm.
encountersRouter.post('/:id/participants/:pid/action-economy/undo', requireEncounterDm, async (req, res) => {
  const { encounter, participant } = await encountersService.undoActionEconomy(
    pool, (req.params.id as string), (req.params.pid as string),
  );
  broadcastActionEconomyChanged(getIo(req.app), encounter, participant);
  res.json({ participant });
});

// Shove Check Against a Specific NPC (Phase 3.7). Same requireEncounterDm
// guard as the rest of this file — the DM triggers the contested roll on
// behalf of whichever PC's turn it is, same as every other combat mutation.
encountersRouter.post('/:id/participants/:pid/shove', requireEncounterDm, async (req, res) => {
  const input = performShoveSchema.parse(req.body);
  const shove = await performShove(pool, (req.params.id as string), (req.params.pid as string), req.user!.id, input);
  const io = getIo(req.app);
  broadcastActionEconomyChanged(io, shove.encounter, shove.participant);
  await broadcastDiceRolled(io, shove.encounter.campaign_id, shove.attackerRoll);
  if (shove.defenderRoll) {
    await broadcastDiceRolled(io, shove.encounter.campaign_id, shove.defenderRoll);
  }
  // Combat log (nav point 2) — recorded from the route, not from inside
  // performShove itself, so services/shove.ts doesn't gain a dependency on
  // services/combatActions.ts; the route already orchestrates every other
  // side effect (broadcasts) the same way.
  const shoveAction = await combatActionsService.recordAction(pool, req.user!.id, (req.params.id as string), {
    actorParticipantId: (req.params.pid as string),
    targetParticipantIds: [input.targetParticipantId],
    actionType: 'ability',
    meansLabel: 'Shove',
    diceRollId: shove.attackerRoll.id,
    resultKind: shove.success ? 'effect' : 'miss',
    effectDescription: shove.success
      ? shove.outcome === 'push_5ft'
        ? 'Pushed 5 feet away'
        : 'Knocked prone'
      : undefined,
  });
  await broadcastActionRecorded(io, pool, shoveAction, shove.encounter.campaign_id);
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

// Grapple Check Against a Specific NPC (Phase 7 / docs/rules/actions.md's
// Grapple section) — mirrors the Shove route exactly, including its
// requireEncounterDm gating: same "DM triggers the contested roll on behalf
// of whichever PC's turn it is" reasoning as Shove above.
encountersRouter.post('/:id/participants/:pid/grapple', requireEncounterDm, async (req, res) => {
  const input = performGrappleSchema.parse(req.body);
  const grapple = await performGrapple(pool, (req.params.id as string), (req.params.pid as string), req.user!.id, input);
  const io = getIo(req.app);
  broadcastActionEconomyChanged(io, grapple.encounter, grapple.participant);
  await broadcastDiceRolled(io, grapple.encounter.campaign_id, grapple.attackerRoll);
  if (grapple.defenderRoll) {
    await broadcastDiceRolled(io, grapple.encounter.campaign_id, grapple.defenderRoll);
  }
  if (grapple.appliedEffect) {
    for (const sync of grapple.appliedEffect.encounterSyncs) {
      broadcastEffectApplied(io, sync, grapple.appliedEffect.effect, grapple.appliedEffect.effectDefinitionName);
    }
  }
  const grappleAction = await combatActionsService.recordAction(pool, req.user!.id, (req.params.id as string), {
    actorParticipantId: (req.params.pid as string),
    targetParticipantIds: [input.targetParticipantId],
    actionType: 'ability',
    meansLabel: 'Grapple',
    diceRollId: grapple.attackerRoll.id,
    resultKind: grapple.success ? 'effect' : 'miss',
    effectDescription: grapple.success ? 'Grappled' : undefined,
  });
  await broadcastActionRecorded(io, pool, grappleAction, grapple.encounter.campaign_id);
  res.json({
    participant: grapple.participant,
    attackerRoll: grapple.attackerRoll,
    defenderRoll: grapple.defenderRoll,
    defenderTotal: grapple.defenderTotal,
    defenderOverridden: grapple.defenderOverridden,
    success: grapple.success,
    appliedEffect: grapple.appliedEffect?.effect ?? null,
    message: grapple.message,
  });
});
