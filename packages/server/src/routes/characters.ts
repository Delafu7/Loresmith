import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import {
  createCharacterSchema,
  exhaustionSchema,
  hpDeltaSchema,
  replaceClassesSchema,
  replaceSavingThrowProficienciesSchema,
  replaceSkillProficienciesSchema,
  updateArmorClassModeSchema,
  updateCharacterSchema,
} from '../schemas/characters.js';
import { createCharacterItemSchema, updateCharacterItemSchema } from '../schemas/characterItems.js';
import { createCharacterAttackSchema, updateCharacterAttackSchema } from '../schemas/characterAttacks.js';
import { createCharacterSpellSchema, spellRowQuerySchema, updateCharacterSpellSchema } from '../schemas/characterSpells.js';
import { applyTargetEffectSchema } from '../schemas/effects.js';
import { resourceAmountSchema } from '../schemas/resources.js';
import { applyDamageSchema } from '../schemas/damage.js';
import * as charactersService from '../services/characters.js';
import * as characterItemsService from '../services/characterItems.js';
import * as characterAttacksService from '../services/characterAttacks.js';
import * as characterSpellsService from '../services/characterSpells.js';
import * as effectsService from '../services/effects.js';
import * as resourcePoolsService from '../services/resourcePools.js';
import {
  getIo,
  broadcastHpChanged,
  broadcastEffectApplied,
  broadcastEffectExpired,
  broadcastArmorClassChanged,
} from '../sockets/broadcast.js';
import type { Server } from 'socket.io';
import type { ArmorClassEncounterSync } from '../services/armorClass.js';

// Shared by every route below that can trigger an AC recompute (generic
// PATCH /:id, items equip toggle, armor-class-mode toggle) — broadcasts
// PARTICIPANT_AC_CHANGED once per live encounter the character is currently
// a combat_participants row in. ONLY called after the triggering service
// call's transaction has already committed (this app's universal broadcast
// discipline), and the caller already only invokes this when the service
// reported an actual AC change (a non-null armorClassSync).
function broadcastArmorClassSyncs(
  io: Server,
  characterId: number,
  armorClass: number,
  encounterSyncs: ArmorClassEncounterSync[],
): void {
  for (const sync of encounterSyncs) {
    broadcastArmorClassChanged(
      io,
      { encounter_id: sync.encounter_id, campaign_id: sync.campaign_id, sync_seq: sync.sync_seq },
      { participantId: sync.participant_id, characterId, armorClass },
    );
  }
}

// Mounted at /campaigns/:id/characters
export const campaignCharactersRouter = Router({ mergeParams: true });
campaignCharactersRouter.use(requireAuth, requireCampaignMember());

campaignCharactersRouter.get('/', async (req, res) => {
  const characters = await charactersService.listCharacters(pool, req.campaignId!, req.campaignRole!);
  res.json({ characters });
});

campaignCharactersRouter.post('/', async (req, res) => {
  const input = createCharacterSchema.parse(req.body);
  const character = await charactersService.createCharacter(pool, req.user!.id, req.campaignId!, req.campaignRole!, input);
  res.status(201).json({ character });
});

// Mounted at /characters
export const charactersRouter = Router();
charactersRouter.use(requireAuth);

charactersRouter.get('/:id', async (req, res) => {
  const character = await charactersService.getCharacter(pool, req.user!.id, Number(req.params.id));
  res.json({ character });
});

charactersRouter.patch('/:id', async (req, res) => {
  const input = updateCharacterSchema.parse(req.body);
  const { character, armorClassSync } = await charactersService.updateCharacter(pool, req.user!.id, Number(req.params.id), input);
  if (armorClassSync) {
    broadcastArmorClassSyncs(
      getIo(req.app),
      Number(req.params.id),
      armorClassSync.character.armor_class as number,
      armorClassSync.encounterSyncs,
    );
  }
  res.json({ character });
});

charactersRouter.delete('/:id', async (req, res) => {
  await charactersService.deleteCharacter(pool, req.user!.id, Number(req.params.id));
  res.status(204).send();
});

// GET counterparts to the replace-all PUTs below — added because there was
// otherwise no way to read a character's current classes/skill-proficiencies/
// saving-throw-proficiencies without first performing a write (see
// services/characters.ts's getClasses/getSkillProficiencies/
// getSavingThrowProficiencies for the authorization note: same "any campaign
// member may read" rule as GET /:id, ownership is only enforced on the PUTs).

charactersRouter.get('/:id/classes', async (req, res) => {
  const classes = await charactersService.getClasses(pool, req.user!.id, Number(req.params.id));
  res.json({ classes });
});

charactersRouter.get('/:id/skill-proficiencies', async (req, res) => {
  const skillProficiencies = await charactersService.getSkillProficiencies(pool, req.user!.id, Number(req.params.id));
  res.json({ skillProficiencies });
});

charactersRouter.get('/:id/saving-throw-proficiencies', async (req, res) => {
  const savingThrowProficiencies = await charactersService.getSavingThrowProficiencies(
    pool, req.user!.id, Number(req.params.id),
  );
  res.json({ savingThrowProficiencies });
});

charactersRouter.put('/:id/classes', async (req, res) => {
  const input = replaceClassesSchema.parse(req.body);
  const classes = await charactersService.replaceClasses(pool, req.user!.id, Number(req.params.id), input);
  res.json({ classes });
});

charactersRouter.put('/:id/skill-proficiencies', async (req, res) => {
  const input = replaceSkillProficienciesSchema.parse(req.body);
  const skillProficiencies = await charactersService.replaceSkillProficiencies(pool, req.user!.id, Number(req.params.id), input);
  res.json({ skillProficiencies });
});

charactersRouter.put('/:id/saving-throw-proficiencies', async (req, res) => {
  const input = replaceSavingThrowProficienciesSchema.parse(req.body);
  const savingThrowProficiencies = await charactersService.replaceSavingThrowProficiencies(
    pool, req.user!.id, Number(req.params.id), input,
  );
  res.json({ savingThrowProficiencies });
});

charactersRouter.patch('/:id/hp', async (req, res) => {
  const input = hpDeltaSchema.parse(req.body);
  const { character, encounterSyncs } = await charactersService.applyHpDelta(pool, req.user!.id, Number(req.params.id), input);
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    broadcastHpChanged(io, {
      encounterId: sync.encounter_id,
      campaignId: sync.campaign_id,
      seq: sync.sync_seq,
      participantId: sync.participant_id,
      characterId: Number(req.params.id),
      monsterInstanceId: null,
      hpCurrent: character.hp_current as number,
      hpMax: character.hp_max as number,
      hpTemp: character.hp_temp as number,
      delta: input.delta,
    });
  }
  res.json({ character });
});

// REFACTOR-PLAN.md §6: sibling to PATCH .../hp — rolls the damage dice
// server-side and applies resistance/vulnerability/immunity, rather than
// trusting a client-computed final delta (see services/characters.ts's
// applyDamage for the full rationale).
charactersRouter.post('/:id/apply-damage', async (req, res) => {
  const input = applyDamageSchema.parse(req.body);
  const result = await charactersService.applyDamage(pool, req.user!.id, Number(req.params.id), input);
  const io = getIo(req.app);
  for (const sync of result.encounterSyncs) {
    broadcastHpChanged(io, {
      encounterId: sync.encounter_id,
      campaignId: sync.campaign_id,
      seq: sync.sync_seq,
      participantId: sync.participant_id,
      characterId: Number(req.params.id),
      monsterInstanceId: null,
      hpCurrent: result.character.hp_current as number,
      hpMax: result.character.hp_max as number,
      hpTemp: result.character.hp_temp as number,
      delta: -result.appliedDamage,
    });
  }
  res.json({
    character: result.character,
    diceRoll: result.diceRoll,
    rawTotal: result.rawTotal,
    appliedDamage: result.appliedDamage,
    breakdown: result.breakdown,
  });
});

charactersRouter.patch('/:id/exhaustion', async (req, res) => {
  const input = exhaustionSchema.parse(req.body);
  const character = await charactersService.updateExhaustion(pool, req.user!.id, Number(req.params.id), input);
  res.json({ character });
});

charactersRouter.patch('/:id/armor-class-mode', async (req, res) => {
  const input = updateArmorClassModeSchema.parse(req.body);
  const { character, armorClassSync } = await charactersService.updateArmorClassMode(pool, req.user!.id, Number(req.params.id), input);
  if (armorClassSync) {
    broadcastArmorClassSyncs(getIo(req.app), Number(req.params.id), character.armor_class as number, armorClassSync.encounterSyncs);
  }
  res.json({ character });
});

// ---- Spells (character_spells) ----

charactersRouter.get('/:id/spells', async (req, res) => {
  const spells = await characterSpellsService.listCharacterSpells(pool, req.user!.id, Number(req.params.id));
  res.json({ spells });
});

charactersRouter.post('/:id/spells', async (req, res) => {
  const input = createCharacterSpellSchema.parse(req.body);
  const spell = await characterSpellsService.learnCharacterSpell(pool, req.user!.id, Number(req.params.id), input);
  res.status(201).json({ spell });
});

charactersRouter.patch('/:id/spells/:spellId', async (req, res) => {
  const input = updateCharacterSpellSchema.parse(req.body);
  const { classId } = spellRowQuerySchema.parse(req.query);
  const spell = await characterSpellsService.toggleCharacterSpellPrepared(
    pool, req.user!.id, Number(req.params.id), Number(req.params.spellId), classId, input,
  );
  res.json({ spell });
});

charactersRouter.delete('/:id/spells/:spellId', async (req, res) => {
  const { classId } = spellRowQuerySchema.parse(req.query);
  await characterSpellsService.unlearnCharacterSpell(pool, req.user!.id, Number(req.params.id), Number(req.params.spellId), classId);
  res.status(204).send();
});

// ---- Items (character_items) ----

// REFACTOR-PLAN.md §6: a character's structured, selectable attack list.
charactersRouter.get('/:id/attacks', async (req, res) => {
  const attacks = await characterAttacksService.listCharacterAttacks(pool, req.user!.id, Number(req.params.id));
  res.json({ attacks });
});

charactersRouter.post('/:id/attacks', async (req, res) => {
  const input = createCharacterAttackSchema.parse(req.body);
  const attack = await characterAttacksService.addCharacterAttack(pool, req.user!.id, Number(req.params.id), input);
  res.status(201).json({ attack });
});

charactersRouter.patch('/:id/attacks/:attackId', async (req, res) => {
  const input = updateCharacterAttackSchema.parse(req.body);
  const attack = await characterAttacksService.updateCharacterAttack(
    pool, req.user!.id, Number(req.params.id), Number(req.params.attackId), input,
  );
  res.json({ attack });
});

charactersRouter.delete('/:id/attacks/:attackId', async (req, res) => {
  await characterAttacksService.removeCharacterAttack(pool, req.user!.id, Number(req.params.id), Number(req.params.attackId));
  res.status(204).send();
});

charactersRouter.get('/:id/items', async (req, res) => {
  const items = await characterItemsService.listCharacterItems(pool, req.user!.id, Number(req.params.id));
  res.json({ items });
});

charactersRouter.post('/:id/items', async (req, res) => {
  const input = createCharacterItemSchema.parse(req.body);
  const { item, character, armorClassSync } = await characterItemsService.addCharacterItem(
    pool, req.user!.id, Number(req.params.id), input,
  );
  if (armorClassSync) {
    broadcastArmorClassSyncs(
      getIo(req.app),
      Number(req.params.id),
      armorClassSync.character.armor_class as number,
      armorClassSync.encounterSyncs,
    );
  }
  res.status(201).json({ item, character });
});

charactersRouter.patch('/:id/items/:itemId', async (req, res) => {
  const input = updateCharacterItemSchema.parse(req.body);
  const { item, character, armorClassSync } = await characterItemsService.updateCharacterItem(
    pool, req.user!.id, Number(req.params.id), Number(req.params.itemId), input,
  );
  if (armorClassSync) {
    broadcastArmorClassSyncs(
      getIo(req.app),
      Number(req.params.id),
      armorClassSync.character.armor_class as number,
      armorClassSync.encounterSyncs,
    );
  }
  // `character` reflects any AC recompute this equip-toggle may have
  // triggered — a client not currently subscribed to PARTICIPANT_AC_CHANGED
  // (e.g. viewing the character sheet, not a live encounter's combat
  // tracker) has no other way to learn its AC just changed.
  res.json({ item, character });
});

charactersRouter.delete('/:id/items/:itemId', async (req, res) => {
  await characterItemsService.removeCharacterItem(pool, req.user!.id, Number(req.params.id), Number(req.params.itemId));
  res.status(204).send();
});

// ---- Resource pools (character_resource_pools) ----

charactersRouter.get('/:id/resources', async (req, res) => {
  const resources = await resourcePoolsService.listResourcePools(pool, req.user!.id, Number(req.params.id));
  res.json({ resources });
});

charactersRouter.post('/:id/resources/:key/spend', async (req, res) => {
  const input = resourceAmountSchema.parse(req.body);
  const resource = await resourcePoolsService.spendResource(pool, req.user!.id, Number(req.params.id), req.params.key!, input);
  res.json({ resource });
});

charactersRouter.post('/:id/resources/:key/recover', async (req, res) => {
  const input = resourceAmountSchema.parse(req.body);
  const resource = await resourcePoolsService.recoverResource(pool, req.user!.id, Number(req.params.id), req.params.key!, input);
  res.json({ resource });
});

// ---- Effects applied outside combat (encounter_id = null) — DM-only, see
// services/effects.ts ----

charactersRouter.get('/:id/effects', async (req, res) => {
  const effects = await effectsService.listCharacterEffects(pool, req.user!.id, Number(req.params.id));
  res.json({ effects });
});

charactersRouter.post('/:id/effects', async (req, res) => {
  const input = applyTargetEffectSchema.parse(req.body);
  const { effect, effectDefinitionName, encounterSyncs, replacedEffect } = await effectsService.applyCharacterEffect(pool, req.user!.id, Number(req.params.id), input);
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    if (replacedEffect) {
      await broadcastEffectExpired(io, sync, replacedEffect.effect, replacedEffect.effectDefinitionName);
    }
    await broadcastEffectApplied(io, sync, effect, effectDefinitionName);
  }
  res.status(201).json({ effect });
});
