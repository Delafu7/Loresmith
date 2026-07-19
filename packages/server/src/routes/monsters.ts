import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { monsterQuerySchema } from '../schemas/catalog.js';
import {
  createMonsterInstanceSchema,
  monsterInstanceHpDeltaSchema,
  updateMonsterInstanceSchema,
} from '../schemas/monsters.js';
import { createHomebrewMonsterSchema, updateHomebrewMonsterSchema } from '../schemas/monsterCatalog.js';
import { applyTargetEffectSchema } from '../schemas/effects.js';
import * as catalogService from '../services/catalog.js';
import * as monstersService from '../services/monsters.js';
import * as monsterCatalogService from '../services/monsterCatalog.js';
import * as effectsService from '../services/effects.js';
import { requireMembership } from '../services/authz.js';
import { getIo, broadcastHpChanged, broadcastEffectApplied, broadcastEffectExpired } from '../sockets/broadcast.js';

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
  const monster = await monsterCatalogService.updateHomebrewMonster(pool, req.campaignId!, Number(req.params.monsterId), input);
  res.json({ monster });
});

campaignMonstersRouter.delete('/:monsterId', requireRole('dm'), async (req, res) => {
  await monsterCatalogService.deleteHomebrewMonster(pool, req.campaignId!, Number(req.params.monsterId));
  res.status(204).send();
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
  const instance = await monstersService.getMonsterInstance(pool, req.campaignId!, Number(req.params.instanceId), req.campaignRole!);
  res.json({ monsterInstance: instance });
});

campaignMonsterInstancesRouter.patch('/:instanceId', requireRole('dm'), async (req, res) => {
  const input = updateMonsterInstanceSchema.parse(req.body);
  const instance = await monstersService.updateMonsterInstance(pool, req.campaignId!, Number(req.params.instanceId), input);
  res.json({ monsterInstance: instance });
});

campaignMonsterInstancesRouter.delete('/:instanceId', requireRole('dm'), async (req, res) => {
  await monstersService.deleteMonsterInstance(pool, req.campaignId!, Number(req.params.instanceId));
  res.status(204).send();
});

// Mounted at /monster-instances — flat, hp-patch-only (same shape as
// PATCH /characters/:id/hp).
export const monsterInstancesRouter = Router();
monsterInstancesRouter.use(requireAuth);

monsterInstancesRouter.patch('/:id/hp', async (req, res) => {
  const input = monsterInstanceHpDeltaSchema.parse(req.body);
  const { monsterInstance, encounterSyncs } = await monstersService.applyMonsterInstanceHpDelta(
    pool, req.user!.id, Number(req.params.id), input,
  );
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    await broadcastHpChanged(io, {
      encounterId: sync.encounter_id,
      campaignId: sync.campaign_id,
      seq: sync.sync_seq,
      participantId: sync.participant_id,
      characterId: null,
      monsterInstanceId: Number(req.params.id),
      hpVisibility: sync.hp_visibility,
      hpCurrent: monsterInstance.hp_current as number,
      hpMax: (monsterInstance.hp_max_override as number | null) ?? (monsterInstance.hit_point_average as number),
      hpTemp: monsterInstance.hp_temp as number,
      delta: input.delta,
    });
  }
  res.json({ monsterInstance });
});

monsterInstancesRouter.get('/:id/effects', async (req, res) => {
  const effects = await effectsService.listMonsterInstanceEffects(pool, req.user!.id, Number(req.params.id));
  res.json({ effects });
});

// Effects applied outside combat (encounter_id = null) — DM-only, see services/effects.ts.
monsterInstancesRouter.post('/:id/effects', async (req, res) => {
  const input = applyTargetEffectSchema.parse(req.body);
  const { effect, effectDefinitionName, encounterSyncs, replacedEffect } = await effectsService.applyMonsterInstanceEffect(pool, req.user!.id, Number(req.params.id), input);
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    if (replacedEffect) {
      await broadcastEffectExpired(io, sync, replacedEffect.effect, replacedEffect.effectDefinitionName);
    }
    await broadcastEffectApplied(io, sync, effect, effectDefinitionName);
  }
  res.status(201).json({ effect });
});
