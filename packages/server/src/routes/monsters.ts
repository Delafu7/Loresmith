import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { notFound } from '../middleware/errors.js';
import { monsterQuerySchema } from '../schemas/catalog.js';
import {
  createMonsterInstanceSchema,
  monsterInstanceHpDeltaSchema,
  updateMonsterInstanceSchema,
} from '../schemas/monsters.js';
import { createHomebrewMonsterSchema, updateHomebrewMonsterSchema } from '../schemas/monsterCatalog.js';
import { applyTargetEffectSchema } from '../schemas/effects.js';
import { updateRevealsSchema } from '../schemas/reveals.js';
import { applyDamageSchema } from '../schemas/damage.js';
import * as catalogService from '../services/catalog.js';
import * as monstersService from '../services/monsters.js';
import * as monsterCatalogService from '../services/monsterCatalog.js';
import * as effectsService from '../services/effects.js';
import * as entityFieldRevealService from '../services/entityFieldReveal.js';
import { requireMembership, getMembership } from '../services/authz.js';
import {
  getIo,
  broadcastHpChanged,
  broadcastEffectApplied,
  broadcastEffectExpired,
  broadcastRevealChanged,
  broadcastConcentrationCheckPrompted,
  broadcastPendingActionCreated,
} from '../sockets/broadcast.js';

// Mounted at /catalog/monsters (bestiary browse)
export const monsterCatalogRouter = Router();
monsterCatalogRouter.use(requireAuth);
monsterCatalogRouter.get('/', async (req, res) => {
  const query = monsterQuerySchema.parse(req.query);
  // A campaignId filter unions in that campaign's homebrew monsters (see
  // services/catalog.ts's listMonsters) — same membership-gating fix
  // already applied to GET /catalog/effect-definitions (routes/catalog.ts):
  // any campaignId-scoped catalog read MUST verify membership first.
  if (query.campaignId !== undefined) {
    await requireMembership(pool, query.campaignId, req.user!.id);
  }
  res.json({ monsters: await catalogService.listMonsters(pool, query, req.user!.id) });
});

// Own endpoint for a single creature (REFACTOR-PLAN.md §1: /creature/:id on
// the web side). A global row (owning_campaign_id/owning_user_id both NULL)
// is readable by any authenticated user, same as the unfiltered list above;
// a campaign-owned homebrew row requires membership in its owning campaign,
// same as before Iteration 2. A user-library row (Iteration 2 "Shared
// bestiary") is readable by its owning user OR by any member of a campaign
// that has curated it into their bestiary (campaign_bestiary_entries) —
// otherwise a shared template would be invisible to the very campaigns
// using it. Never leaks existence of another campaign's/user's homebrew
// creature to someone without one of those two paths in.
monsterCatalogRouter.get('/:id', async (req, res) => {
  const monster = await catalogService.getMonsterById(pool, (req.params.id as string));
  if (!monster) throw notFound('Monster');
  const owningCampaignId = monster.owning_campaign_id as string | null;
  const owningUserId = monster.owning_user_id as string | null;
  if (owningCampaignId !== null) {
    // M4 fix: a campaign-owned homebrew row can be curated into OTHER
    // campaigns' bestiaries too (Iteration 2 "Shared bestiary" didn't
    // restrict campaign_bestiary_entries to the owning campaign) — the list
    // view (services/catalog.ts's listMonsters) already unions those in,
    // but this detail route used to require membership in the OWNING
    // campaign specifically, so a member of a campaign that still curates
    // the monster got a confusing NOT_CAMPAIGN_MEMBER on the detail view
    // right after seeing it fine in the list.
    const isOwningMember = await getMembership(pool, owningCampaignId, req.user!.id);
    if (!isOwningMember) {
      const sharedRes = await pool.query(
        `SELECT 1 FROM campaign_bestiary_entries cbe
         JOIN campaign_members cm ON cm.campaign_id = cbe.campaign_id
         WHERE cbe.monster_id = $1 AND cm.user_id = $2 LIMIT 1`,
        [monster.id, req.user!.id],
      );
      if ((sharedRes.rowCount ?? 0) === 0) throw notFound('Monster');
    }
  } else if (owningUserId !== null && owningUserId !== req.user!.id) {
    const sharedRes = await pool.query(
      `SELECT 1 FROM campaign_bestiary_entries cbe
       JOIN campaign_members cm ON cm.campaign_id = cbe.campaign_id
       WHERE cbe.monster_id = $1 AND cm.user_id = $2 LIMIT 1`,
      [monster.id, req.user!.id],
    );
    if ((sharedRes.rowCount ?? 0) === 0) throw notFound('Monster');
  }
  res.json({ monster });
});

// Mounted at /campaigns/:id/monsters — the first write access to a catalog
// table in this app (PLAN.md §4.4). DM-only, and only for homebrew rows
// owned by their own campaign; global/seeded monsters stay immutable via
// this path regardless of role (see services/monsterCatalog.ts).
export const campaignMonstersRouter = Router({ mergeParams: true });
campaignMonstersRouter.use(requireAuth, requireCampaignMember());

campaignMonstersRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createHomebrewMonsterSchema.parse(req.body);
  const monster = await monsterCatalogService.createHomebrewMonster(pool, req.campaignId!, req.user!.id, input);
  res.status(201).json({ monster });
});

campaignMonstersRouter.patch('/:monsterId', requireRole('dm'), async (req, res) => {
  const input = updateHomebrewMonsterSchema.parse(req.body);
  const monster = await monsterCatalogService.updateHomebrewMonster(
    pool, req.campaignId!, req.user!.id, (req.params.monsterId as string), input,
  );
  res.json({ monster });
});

campaignMonstersRouter.delete('/:monsterId', requireRole('dm'), async (req, res) => {
  await monsterCatalogService.deleteHomebrewMonster(pool, req.campaignId!, req.user!.id, (req.params.monsterId as string));
  res.status(204).send();
});

// Forks any monster (official, or another campaign's) into a homebrew copy
// owned by this campaign — no request body, matching the generic catalog
// entities' duplicate route (routes/catalogHomebrew.ts).
campaignMonstersRouter.post('/:monsterId/duplicate', requireRole('dm'), async (req, res) => {
  const monster = await monsterCatalogService.duplicateHomebrewMonster(pool, req.campaignId!, (req.params.monsterId as string));
  res.status(201).json({ monster });
});

// Iteration 2 "Shared bestiary" — in-place scope conversion (same row, not a
// copy). No request body: source/destination are fully determined by the
// URL (this campaign) and the caller (req.user).
campaignMonstersRouter.post('/:monsterId/promote-to-library', requireRole('dm'), async (req, res) => {
  const monster = await monsterCatalogService.promoteHomebrewMonsterToLibrary(
    pool, req.campaignId!, req.user!.id, (req.params.monsterId as string),
  );
  res.json({ monster });
});

campaignMonstersRouter.post('/:monsterId/assign-to-campaign', requireRole('dm'), async (req, res) => {
  const monster = await monsterCatalogService.assignHomebrewMonsterToCampaign(
    pool, req.campaignId!, req.user!.id, (req.params.monsterId as string),
  );
  res.json({ monster });
});

// Mounted at /campaigns/:id/monster-instances — per PLAN.md §4.1 this
// resource nests the single-item id under the campaign prefix (unlike
// characters, where /:id is flat), so GET/PATCH/DELETE-by-id live here too.
export const campaignMonsterInstancesRouter = Router({ mergeParams: true });
campaignMonsterInstancesRouter.use(requireAuth, requireCampaignMember());

campaignMonsterInstancesRouter.get('/', async (req, res) => {
  const instances = await monstersService.listMonsterInstances(pool, req.campaignId!, req.campaignRole!);
  res.json({ monsterInstances: instances });
});

campaignMonsterInstancesRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createMonsterInstanceSchema.parse(req.body);
  const instance = await monstersService.createMonsterInstance(pool, req.campaignId!, input);
  res.status(201).json({ monsterInstance: instance });
});

campaignMonsterInstancesRouter.get('/:instanceId', async (req, res) => {
  const instance = await monstersService.getMonsterInstance(pool, req.campaignId!, (req.params.instanceId as string), req.campaignRole!);
  res.json({ monsterInstance: instance });
});

campaignMonsterInstancesRouter.patch('/:instanceId', requireRole('dm'), async (req, res) => {
  const input = updateMonsterInstanceSchema.parse(req.body);
  const instance = await monstersService.updateMonsterInstance(pool, req.campaignId!, (req.params.instanceId as string), input);
  res.json({ monsterInstance: instance });
});

campaignMonsterInstancesRouter.delete('/:instanceId', requireRole('dm'), async (req, res) => {
  await monstersService.deleteMonsterInstance(pool, req.campaignId!, (req.params.instanceId as string));
  res.status(204).send();
});

// Mounted at /monster-instances — flat, hp-patch-only (same shape as
// PATCH /characters/:id/hp).
export const monsterInstancesRouter = Router();
monsterInstancesRouter.use(requireAuth);

monsterInstancesRouter.patch('/:id/hp', async (req, res) => {
  const input = monsterInstanceHpDeltaSchema.parse(req.body);
  const { monsterInstance, encounterSyncs } = await monstersService.applyMonsterInstanceHpDelta(
    pool, req.user!.id, (req.params.id as string), input,
  );
  const io = getIo(req.app);
  await Promise.all(
    encounterSyncs.map((sync) =>
      broadcastHpChanged(io, {
        encounterId: sync.encounter_id,
        campaignId: sync.campaign_id,
        seq: sync.sync_seq,
        participantId: sync.participant_id,
        characterId: null,
        monsterInstanceId: (req.params.id as string),
        hpCurrent: monsterInstance.hp_current as number,
        hpMax: (monsterInstance.hp_max_override as number | null) ?? (monsterInstance.hit_point_average as number),
        hpTemp: monsterInstance.hp_temp as number,
        delta: input.delta,
      }),
    ),
  );
  res.json({ monsterInstance });
});

// REFACTOR-PLAN.md §6: sibling to PATCH .../hp — see
// services/monsters.ts's applyMonsterInstanceDamage.
monsterInstancesRouter.post('/:id/apply-damage', async (req, res) => {
  const input = applyDamageSchema.parse(req.body);
  const result = await monstersService.applyMonsterInstanceDamage(pool, req.user!.id, (req.params.id as string), input);
  const io = getIo(req.app);

  // Phase 4 "DM approval before a player-submitted action resolves" — a
  // non-DM attacker's damage was queued instead of applied; nothing to
  // broadcast except "a request now exists for the DM to review."
  if ('pending' in result) {
    await broadcastPendingActionCreated(io, result.request.campaign_id, result.request);
    res.status(202).json({ pending: true, request: result.request });
    return;
  }

  await Promise.all(
    result.encounterSyncs.map((sync) =>
      broadcastHpChanged(io, {
        encounterId: sync.encounter_id,
        campaignId: sync.campaign_id,
        seq: sync.sync_seq,
        participantId: sync.participant_id,
        characterId: null,
        monsterInstanceId: (req.params.id as string),
        hpCurrent: result.monsterInstance.hp_current as number,
        hpMax: (result.monsterInstance.hp_max_override as number | null) ?? (result.monsterInstance.hit_point_average as number),
        hpTemp: result.monsterInstance.hp_temp as number,
        delta: -result.appliedDamage,
      }),
    ),
  );
  if (result.concentrationCheck) {
    // No controller for a monster instance — DM only, see
    // broadcastConcentrationCheckPrompted's own comment.
    await Promise.all(
      result.encounterSyncs.map((sync) =>
        broadcastConcentrationCheckPrompted(io, {
          encounterId: sync.encounter_id,
          campaignId: sync.campaign_id,
          characterId: null,
          monsterInstanceId: (req.params.id as string),
          effectId: result.concentrationCheck!.effectId,
          effectDefinitionId: result.concentrationCheck!.effectDefinitionId,
          effectName: result.concentrationCheck!.effectName,
          dc: result.concentrationCheck!.dc,
          damage: result.appliedDamage,
          controllerUserId: null,
        }),
      ),
    );
  }
  res.json({
    monsterInstance: result.monsterInstance,
    diceRoll: result.diceRoll,
    rawTotal: result.rawTotal,
    appliedDamage: result.appliedDamage,
    breakdown: result.breakdown,
    concentrationCheck: result.concentrationCheck,
  });
});

// Phase 2 "HP/damage undo" — mirrors .../action-economy/undo's DM-only shape.
monsterInstancesRouter.post('/:id/hp/undo', async (req, res) => {
  const result = await monstersService.undoLastMonsterInstanceDamage(pool, req.user!.id, (req.params.id as string));
  const io = getIo(req.app);
  await Promise.all(
    result.encounterSyncs.map((sync) =>
      broadcastHpChanged(io, {
        encounterId: sync.encounter_id,
        campaignId: sync.campaign_id,
        seq: sync.sync_seq,
        participantId: sync.participant_id,
        characterId: null,
        monsterInstanceId: (req.params.id as string),
        hpCurrent: result.monsterInstance.hp_current as number,
        hpMax: (result.monsterInstance.hp_max_override as number | null) ?? (result.monsterInstance.hit_point_average as number),
        hpTemp: result.monsterInstance.hp_temp as number,
        delta: 0,
      }),
    ),
  );
  res.json({ monsterInstance: result.monsterInstance });
});

monsterInstancesRouter.get('/:id/effects', async (req, res) => {
  const effects = await effectsService.listMonsterInstanceEffects(pool, req.user!.id, (req.params.id as string));
  res.json({ effects });
});

// docs/roadmap/dnd-2024-gap-analysis.md P2-2 (CB-07) — see routes/characters.ts's
// sibling route for the full rationale.
monsterInstancesRouter.get('/:id/condition-effects', async (req, res) => {
  const report = await effectsService.getMonsterInstanceConditionEffects(pool, req.user!.id, (req.params.id as string));
  res.json(report);
});

// Effects applied outside combat (encounter_id = null) — DM-only, see services/effects.ts.
monsterInstancesRouter.post('/:id/effects', async (req, res) => {
  const input = applyTargetEffectSchema.parse(req.body);
  const { effect, effectDefinitionName, encounterSyncs, replacedEffect } = await effectsService.applyMonsterInstanceEffect(pool, req.user!.id, (req.params.id as string), input);
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    if (replacedEffect) {
      await broadcastEffectExpired(io, sync, replacedEffect.effect, replacedEffect.effectDefinitionName);
    }
    await broadcastEffectApplied(io, sync, effect, effectDefinitionName);
  }
  res.status(201).json({ effect });
});

// ---- Weakness reveals — DM-only, entity_field_reveals ----

monsterInstancesRouter.get('/:id/reveals', async (req, res) => {
  const fields = await entityFieldRevealService.getMonsterInstanceReveals(pool, req.user!.id, (req.params.id as string));
  res.json({ fields });
});

monsterInstancesRouter.patch('/:id/reveals', async (req, res) => {
  const input = updateRevealsSchema.parse(req.body);
  const monsterInstanceId = (req.params.id as string);
  const result = await entityFieldRevealService.updateMonsterInstanceReveals(pool, req.user!.id, monsterInstanceId, input);

  const fieldKeys = result.fields.map((f) => f.fieldKey);
  const trueValues = await entityFieldRevealService.getTrueFieldValues(pool, monsterInstanceId, fieldKeys);
  const io = getIo(req.app);
  for (const sync of result.encounterSyncs) {
    for (const field of result.fields) {
      await broadcastRevealChanged(io, {
        encounterId: sync.encounter_id,
        campaignId: sync.campaign_id,
        seq: sync.sync_seq,
        participantId: sync.participant_id,
        monsterInstanceId,
        fieldKey: field.fieldKey,
        revealed: field.revealed,
        playerOverride: field.playerOverride,
        trueValue: trueValues[field.fieldKey],
      });
    }
  }
  res.json({ fields: result.fields });
});
