import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import {
  assignCharacterOwnerSchema,
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
  characterId: string,
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
  const character = await charactersService.getCharacter(pool, req.user!.id, (req.params.id as string));
  res.json({ character });
});

charactersRouter.patch('/:id', async (req, res) => {
  const input = updateCharacterSchema.parse(req.body);
  const { character, armorClassSync } = await charactersService.updateCharacter(pool, req.user!.id, (req.params.id as string), input);
  if (armorClassSync) {
    broadcastArmorClassSyncs(
      getIo(req.app),
      (req.params.id as string),
      armorClassSync.character.armor_class as number,
      armorClassSync.encounterSyncs,
    );
  }
  res.json({ character });
});

charactersRouter.delete('/:id', async (req, res) => {
  await charactersService.deleteCharacter(pool, req.user!.id, (req.params.id as string));
  res.status(204).send();
});

charactersRouter.post('/:id/duplicate', async (req, res) => {
  const character = await charactersService.duplicateCharacter(pool, req.user!.id, (req.params.id as string));
  res.status(201).json({ character });
});

// DM-only "assign this PC to a player by email" — see
// services/characters.ts's assignCharacterToPlayer for the membership
// validation this does that a raw PATCH /:id ownerUserId doesn't.
charactersRouter.patch('/:id/assign-owner', async (req, res) => {
  const input = assignCharacterOwnerSchema.parse(req.body);
  const character = await charactersService.assignCharacterToPlayer(pool, req.user!.id, (req.params.id as string), input);
  res.json({ character });
});

// GET counterparts to the replace-all PUTs below — added because there was
// otherwise no way to read a character's current classes/skill-proficiencies/
// saving-throw-proficiencies without first performing a write (see
// services/characters.ts's getClasses/getSkillProficiencies/
// getSavingThrowProficiencies for the authorization note: same "any campaign
// member may read" rule as GET /:id, ownership is only enforced on the PUTs).

charactersRouter.get('/:id/classes', async (req, res) => {
  const classes = await charactersService.getClasses(pool, req.user!.id, (req.params.id as string));
  res.json({ classes });
});

charactersRouter.get('/:id/skill-proficiencies', async (req, res) => {
  const skillProficiencies = await charactersService.getSkillProficiencies(pool, req.user!.id, (req.params.id as string));
  res.json({ skillProficiencies });
});

charactersRouter.get('/:id/saving-throw-proficiencies', async (req, res) => {
  const savingThrowProficiencies = await charactersService.getSavingThrowProficiencies(
    pool, req.user!.id, (req.params.id as string),
  );
  res.json({ savingThrowProficiencies });
});

charactersRouter.put('/:id/classes', async (req, res) => {
  const input = replaceClassesSchema.parse(req.body);
  const classes = await charactersService.replaceClasses(pool, req.user!.id, (req.params.id as string), input);
  res.json({ classes });
});

charactersRouter.put('/:id/skill-proficiencies', async (req, res) => {
  const input = replaceSkillProficienciesSchema.parse(req.body);
  const skillProficiencies = await charactersService.replaceSkillProficiencies(pool, req.user!.id, (req.params.id as string), input);
  res.json({ skillProficiencies });
});

charactersRouter.put('/:id/saving-throw-proficiencies', async (req, res) => {
  const input = replaceSavingThrowProficienciesSchema.parse(req.body);
  const savingThrowProficiencies = await charactersService.replaceSavingThrowProficiencies(
    pool, req.user!.id, (req.params.id as string), input,
  );
  res.json({ savingThrowProficiencies });
});

charactersRouter.patch('/:id/hp', async (req, res) => {
  const input = hpDeltaSchema.parse(req.body);
  const { character, encounterSyncs } = await charactersService.applyHpDelta(pool, req.user!.id, (req.params.id as string), input);
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    broadcastHpChanged(io, {
      encounterId: sync.encounter_id,
      campaignId: sync.campaign_id,
      seq: sync.sync_seq,
      participantId: sync.participant_id,
      characterId: (req.params.id as string),
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
  const result = await charactersService.applyDamage(pool, req.user!.id, (req.params.id as string), input);
  const io = getIo(req.app);
  for (const sync of result.encounterSyncs) {
    broadcastHpChanged(io, {
      encounterId: sync.encounter_id,
      campaignId: sync.campaign_id,
      seq: sync.sync_seq,
      participantId: sync.participant_id,
      characterId: (req.params.id as string),
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
  const character = await charactersService.updateExhaustion(pool, req.user!.id, (req.params.id as string), input);
  res.json({ character });
});

charactersRouter.patch('/:id/armor-class-mode', async (req, res) => {
  const input = updateArmorClassModeSchema.parse(req.body);
  const { character, armorClassSync } = await charactersService.updateArmorClassMode(pool, req.user!.id, (req.params.id as string), input);
  if (armorClassSync) {
    broadcastArmorClassSyncs(getIo(req.app), (req.params.id as string), character.armor_class as number, armorClassSync.encounterSyncs);
  }
  res.json({ character });
});

// ---- Spells (character_spells) ----

charactersRouter.get('/:id/spells', async (req, res) => {
  const spells = await characterSpellsService.listCharacterSpells(pool, req.user!.id, (req.params.id as string));
  res.json({ spells });
});

charactersRouter.post('/:id/spells', async (req, res) => {
  const input = createCharacterSpellSchema.parse(req.body);
  const spell = await characterSpellsService.learnCharacterSpell(pool, req.user!.id, (req.params.id as string), input);
  res.status(201).json({ spell });
});

charactersRouter.patch('/:id/spells/:spellId', async (req, res) => {
  const input = updateCharacterSpellSchema.parse(req.body);
  const { classId } = spellRowQuerySchema.parse(req.query);
  const spell = await characterSpellsService.toggleCharacterSpellPrepared(
    pool, req.user!.id, (req.params.id as string), (req.params.spellId as string), classId, input,
  );
  res.json({ spell });
});

charactersRouter.delete('/:id/spells/:spellId', async (req, res) => {
  const { classId } = spellRowQuerySchema.parse(req.query);
  await characterSpellsService.unlearnCharacterSpell(pool, req.user!.id, (req.params.id as string), (req.params.spellId as string), classId);
  res.status(204).send();
});

// ---- Items (character_items) ----

// REFACTOR-PLAN.md §6: a character's structured, selectable attack list.
charactersRouter.get('/:id/attacks', async (req, res) => {
  const attacks = await characterAttacksService.listCharacterAttacks(pool, req.user!.id, (req.params.id as string));
  res.json({ attacks });
});

charactersRouter.post('/:id/attacks', async (req, res) => {
  const input = createCharacterAttackSchema.parse(req.body);
  const attack = await characterAttacksService.addCharacterAttack(pool, req.user!.id, (req.params.id as string), input);
  res.status(201).json({ attack });
});

charactersRouter.patch('/:id/attacks/:attackId', async (req, res) => {
  const input = updateCharacterAttackSchema.parse(req.body);
  const attack = await characterAttacksService.updateCharacterAttack(
    pool, req.user!.id, (req.params.id as string), (req.params.attackId as string), input,
  );
  res.json({ attack });
});

charactersRouter.delete('/:id/attacks/:attackId', async (req, res) => {
  await characterAttacksService.removeCharacterAttack(pool, req.user!.id, (req.params.id as string), (req.params.attackId as string));
  res.status(204).send();
});

charactersRouter.get('/:id/items', async (req, res) => {
  const items = await characterItemsService.listCharacterItems(pool, req.user!.id, (req.params.id as string));
  res.json({ items });
});

// Read-only derivation (services/encumbrance.ts) — not stored, computed
// fresh on every read from the character's STR score + summed item weight,
// same "derived, not hardcoded in the UI" discipline the brief asks for
// AC/damage/saves/speed (services/armorClass.ts's own precedent).
charactersRouter.get('/:id/encumbrance', async (req, res) => {
  const encumbrance = await characterItemsService.getCharacterEncumbrance(pool, req.user!.id, (req.params.id as string));
  res.json({ encumbrance });
});

charactersRouter.post('/:id/items', async (req, res) => {
  const input = createCharacterItemSchema.parse(req.body);
  const { item, character, armorClassSync } = await characterItemsService.addCharacterItem(
    pool, req.user!.id, (req.params.id as string), input,
  );
  if (armorClassSync) {
    broadcastArmorClassSyncs(
      getIo(req.app),
      (req.params.id as string),
      armorClassSync.character.armor_class as number,
      armorClassSync.encounterSyncs,
    );
  }
  res.status(201).json({ item, character });
});

charactersRouter.patch('/:id/items/:itemId', async (req, res) => {
  const input = updateCharacterItemSchema.parse(req.body);
  const { item, character, armorClassSync } = await characterItemsService.updateCharacterItem(
    pool, req.user!.id, (req.params.id as string), (req.params.itemId as string), input,
  );
  if (armorClassSync) {
    broadcastArmorClassSyncs(
      getIo(req.app),
      (req.params.id as string),
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
  await characterItemsService.removeCharacterItem(pool, req.user!.id, (req.params.id as string), (req.params.itemId as string));
  res.status(204).send();
});

// ---- Resource pools (character_resource_pools) ----

charactersRouter.get('/:id/resources', async (req, res) => {
  const resources = await resourcePoolsService.listResourcePools(pool, req.user!.id, (req.params.id as string));
  res.json({ resources });
});

charactersRouter.post('/:id/resources/:key/spend', async (req, res) => {
  const input = resourceAmountSchema.parse(req.body);
  const resource = await resourcePoolsService.spendResource(pool, req.user!.id, (req.params.id as string), req.params.key!, input);
  res.json({ resource });
});

charactersRouter.post('/:id/resources/:key/recover', async (req, res) => {
  const input = resourceAmountSchema.parse(req.body);
  const resource = await resourcePoolsService.recoverResource(pool, req.user!.id, (req.params.id as string), req.params.key!, input);
  res.json({ resource });
});

// ---- Effects applied outside combat (encounter_id = null) — DM-only, see
// services/effects.ts ----

charactersRouter.get('/:id/effects', async (req, res) => {
  const effects = await effectsService.listCharacterEffects(pool, req.user!.id, (req.params.id as string));
  res.json({ effects });
});

charactersRouter.post('/:id/effects', async (req, res) => {
  const input = applyTargetEffectSchema.parse(req.body);
  const { effect, effectDefinitionName, encounterSyncs, replacedEffect } = await effectsService.applyCharacterEffect(pool, req.user!.id, (req.params.id as string), input);
  const io = getIo(req.app);
  for (const sync of encounterSyncs) {
    if (replacedEffect) {
      await broadcastEffectExpired(io, sync, replacedEffect.effect, replacedEffect.effectDefinitionName);
    }
    await broadcastEffectApplied(io, sync, effect, effectDefinitionName);
  }
  res.status(201).json({ effect });
});
