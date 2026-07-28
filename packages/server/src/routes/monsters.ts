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
import { requireMembership } from '../services/authz.js';
import { getIo, broadcastHpChanged, broadcastEffectApplied, broadcastEffectExpired, broadcastRevealChanged } from '../sockets/broadcast.js';

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
  res.json({ monsters: await catalogService.listMonsters(pool, query) });
});

// Own endpoint for a single creature (REFACTOR-PLAN.md §1: /creature/:id on
// the web side). A global row (owning_campaign_id NULL) is readable by any
// authenticated user, same as the unfiltered list above; a homebrew row
// additionally requires membership in its owning campaign — never leaks
// existence of another campaign's homebrew creature to a non-member.
monsterCatalogRouter.get('/:id', async (req, res) => {
  const monster = await catalogService.getMonsterById(pool, (req.params.id as string));
  if (!monster) throw notFound('Monster');
  if (monster.owning_campaign_id !== null) {
    await requireMembership(pool, monster.owning_campaign_id as string, req.user!.id);
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
  const monster = await monsterCatalogService.createHomebrewMonster(pool, req.campaignId!, input);
  res.status(201).json({ monster });
});

campaignMonstersRouter.patch('/:monsterId', requireRole('dm'), async (req, res) => {
  const input = updateHomebrewMonsterSchema.parse(req.body);
  const monster = await monsterCatalogService.updateHomebrewMonster(pool, req.campaignId!, (req.params.monsterId as string), input);
  res.json({ monster });
});

campaignMonstersRouter.delete('/:monsterId', requireRole('dm'), async (req, res) => {
  await monsterCatalogService.deleteHomebrewMonster(pool, req.campaignId!, (req.params.monsterId as string));
  res.status(204).send();
});

// Forks any monster (official, or another campaign's) into a homebrew copy
// owned by this campaign — no request body, matching the generic catalog
// entities' duplicate route (routes/catalogHomebrew.ts).
campaignMonstersRouter.post('/:monsterId/duplicate', requireRole('dm'), async (req, res) => {
  const monster = await monsterCatalogService.duplicateHomebrewMonster(pool, req.campaignId!, (req.params.monsterId as string));
  res.status(201).json({ monster });
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
  for (const sync of encounterSyncs) {
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
    });
  }
  res.json({ monsterInstance });
});

// REFACTOR-PLAN.md §6: sibling to PATCH .../hp — see
// services/monsters.ts's applyMonsterInstanceDamage.
monsterInstancesRouter.post('/:id/apply-damage', async (req, res) => {
  const input = applyDamageSchema.parse(req.body);
  const result = await monstersService.applyMonsterInstanceDamage(pool, req.user!.id, (req.params.id as string), input);
  const io = getIo(req.app);
  for (const sync of result.encounterSyncs) {
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
    });
  }
  res.json({
    monsterInstance: result.monsterInstance,
    diceRoll: result.diceRoll,
    rawTotal: result.rawTotal,
    appliedDamage: result.appliedDamage,
    breakdown: result.breakdown,
  });
});

monsterInstancesRouter.get('/:id/effects', async (req, res) => {
  const effects = await effectsService.listMonsterInstanceEffects(pool, req.user!.id, (req.params.id as string));
  res.json({ effects });
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
