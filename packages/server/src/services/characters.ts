import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm, requireOwnerOrDm, type CampaignRole } from './authz.js';
import { applyHpDeltaWithTempAbsorption, type HpState } from './hp.js';
import { redactHpFields, resolveHpVisibility } from './hpVisibility.js';
import { redactEntityFields, resolveReveals } from './entityFieldReveal.js';
import { isCheckViolation } from './dbErrors.js';
import { recomputeSpellSlots, validateMulticlassPrerequisites } from './spellSlots.js';
import { recomputeAndApplyCharacterArmorClass, type ArmorClassEncounterSync } from './armorClass.js';
import { computeAppliedDamage } from './damage.js';
import { rollDie } from './diceRolls.js';
import type {
  CreateCharacterInput,
  ExhaustionInput,
  HpDeltaInput,
  ReplaceClassesInput,
  ReplaceSavingThrowProficienciesInput,
  ReplaceSkillProficienciesInput,
  UpdateArmorClassModeInput,
  UpdateCharacterInput,
} from '../schemas/characters.js';
import type { ApplyDamageInput } from '../schemas/damage.js';

interface CharacterRow {
  id: number;
  campaign_id: number;
  is_pc: boolean;
  owner_user_id: number | null;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  [key: string]: unknown;
}

// Exported so sibling services (characterSpells.ts, characterItems.ts,
// resourcePools.ts) that also mutate character sub-resources can reuse the
// exact same "fetch the character, then check membership+ownership-or-DM"
// sequence rather than re-deriving it — see PLAN.md §4.3's tradeoff #3 on
// why ownership checks are inline per-service rather than centralized in
// middleware (resource-id-keyed routes only know the campaign after loading
// the row), while still not duplicating the DB reads/logic themselves.
export async function fetchCharacterOrThrow(pool: Pool | PoolClient, characterId: number): Promise<CharacterRow> {
  const result = await pool.query<CharacterRow>(`SELECT * FROM characters WHERE id = $1`, [characterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Character');
  return row;
}

/** Layer 2+3+4 for a resource-id-keyed character route: membership, then ownership-or-DM. */
export async function authorizeCharacterMutation(
  pool: Pool,
  actorId: number,
  character: CharacterRow,
): Promise<CampaignRole> {
  const role = await requireMembership(pool, character.campaign_id, actorId);
  requireOwnerOrDm(role, character.owner_user_id, actorId);
  return role;
}

// NPCs are subject to the same combat hp_visibility banding as monster
// instances when read by a player (see services/hpVisibility.ts) — PCs are
// always shown exact, matching PLAN.md §5.3's "exact for PCs" default and
// the fact that there's no mechanism (or reason) to hide a player's own
// party's HP from other players.
// NPCs are also the only characters subject to entity_field_reveals
// redaction (AC/speed/senses/languages/notes) — same "PCs are always fully
// visible to the whole party" reasoning as the HP skip just below, so this
// reuses the identical `row.is_pc` branch rather than a separate check.
export async function listCharacters(pool: Pool, campaignId: number, role: CampaignRole) {
  const result = await pool.query<CharacterRow>(`SELECT * FROM characters WHERE campaign_id = $1 ORDER BY name ASC`, [campaignId]);
  if (role === 'dm') return result.rows.map((row) => ({ ...row, hp_band: null }));
  return Promise.all(
    result.rows.map(async (row) => {
      if (row.is_pc) return { ...row, hp_band: null };
      const visibility = await resolveHpVisibility(pool, { characterId: row.id as number });
      const hpRedacted = redactHpFields(row as unknown as { hp_current: number; hp_max: number; hp_temp: number } & CharacterRow, visibility);
      const revealState = await resolveReveals(pool, campaignId, 'character', { characterId: row.id as number });
      return redactEntityFields(hpRedacted, 'character', revealState);
    }),
  );
}

export async function getCharacter(pool: Pool, actorId: number, characterId: number) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  const role = await requireMembership(pool, character.campaign_id, actorId); // any role may read
  if (role === 'dm' || character.is_pc) return { ...character, hp_band: null };
  const visibility = await resolveHpVisibility(pool, { characterId });
  const hpRedacted = redactHpFields(character as unknown as { hp_current: number; hp_max: number; hp_temp: number } & CharacterRow, visibility);
  const revealState = await resolveReveals(pool, character.campaign_id, 'character', { characterId });
  return redactEntityFields(hpRedacted, 'character', revealState);
}

export async function createCharacter(
  pool: Pool,
  actorId: number,
  campaignId: number,
  role: CampaignRole,
  input: CreateCharacterInput,
) {
  let isPc = input.isPc;
  let ownerUserId = input.ownerUserId ?? null;

  if (role === 'player') {
    // Players only ever create their own PCs — never NPCs, never on someone else's behalf.
    if (isPc === false) {
      throw new AppError('FORBIDDEN_ROLE', 'Players cannot create NPCs');
    }
    if (ownerUserId !== null && ownerUserId !== actorId) {
      throw new AppError('FORBIDDEN_NOT_OWNER', 'Players can only create characters owned by themselves');
    }
    isPc = true;
    ownerUserId = actorId;
  } else {
    // DM: PCs need an explicit owning player; NPCs must not have one.
    if (isPc && ownerUserId === null) {
      throw new AppError('VALIDATION_ERROR', 'ownerUserId is required when isPc is true');
    }
    if (!isPc) {
      ownerUserId = null;
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, race_id, subrace_id, background_id,
          alignment, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current, hp_temp,
          hit_dice_remaining, exhaustion_level, senses, languages, notes,
          damage_resistances, damage_vulnerabilities, damage_immunities)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING *`,
      [
        campaignId, isPc, ownerUserId, actorId, input.name, input.raceId ?? null, input.subraceId ?? null,
        input.backgroundId ?? null, input.alignment ?? null, input.str, input.dex, input.con, input.int,
        input.wis, input.cha, input.armorClass, input.speed, input.hpMax, input.hpCurrent ?? input.hpMax,
        input.hpTemp, input.hitDiceRemaining ? JSON.stringify(input.hitDiceRemaining) : null,
        input.exhaustionLevel, input.senses ?? null, input.languages ?? null, input.notes ?? null,
        input.damageResistances, input.damageVulnerabilities, input.damageImmunities,
      ],
    );
    return result.rows[0];
  } catch (err) {
    if (isCheckViolation(err)) {
      throw new AppError('VALIDATION_ERROR', 'Character data violates a database constraint', { cause: String(err) });
    }
    throw err;
  }
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  isPc: 'is_pc',
  ownerUserId: 'owner_user_id',
  raceId: 'race_id',
  subraceId: 'subrace_id',
  backgroundId: 'background_id',
  alignment: 'alignment',
  str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha',
  armorClass: 'armor_class',
  speed: 'speed',
  hpMax: 'hp_max',
  hpCurrent: 'hp_current',
  hpTemp: 'hp_temp',
  exhaustionLevel: 'exhaustion_level',
  senses: 'senses',
  languages: 'languages',
  notes: 'notes',
  damageResistances: 'damage_resistances',
  damageVulnerabilities: 'damage_vulnerabilities',
  damageImmunities: 'damage_immunities',
};

export interface UpdateCharacterResult {
  character: Record<string, unknown>;
  // Set only when this character is in armor_class_mode='auto' AND the
  // post-patch recompute actually changed the stored AC (e.g. a dex change).
  // Null otherwise (manual mode, or an auto-mode patch that happened not to
  // move the computed value). Route layer broadcasts PARTICIPANT_AC_CHANGED
  // per sync target only when this is non-null.
  armorClassSync: { character: Record<string, unknown>; encounterSyncs: ArmorClassEncounterSync[] } | null;
}

export async function updateCharacter(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: UpdateCharacterInput,
): Promise<UpdateCharacterResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  const role = await authorizeCharacterMutation(pool, actorId, character);

  const patch: Record<string, unknown> = { ...input };
  if (role === 'player') {
    // Ownership/NPC-vs-PC status is a campaign-settings concern, not something
    // a player edits on their own sheet — silently drop rather than error, so
    // a client that round-trips the full object doesn't get spuriously blocked.
    delete patch.isPc;
    delete patch.ownerUserId;
  }
  if ('hitDiceRemaining' in patch) {
    // JSONB column needs an explicit column + serialization; handled separately below.
    delete patch.hitDiceRemaining;
  }

  // Cheap pre-transaction bail-out for a genuinely empty patch — mirrors the
  // old early-return exactly (dropping armorClass below can only ever SHRINK
  // this set, never grow it, so a patch that's already empty here stays
  // empty regardless of armor_class_mode and never needs the transaction/lock
  // below at all).
  const hasAnyUpdatableField =
    Object.entries(patch).some(([key, value]) => value !== undefined && UPDATABLE_COLUMNS[key]) ||
    input.hitDiceRemaining !== undefined;
  if (!hasAnyUpdatableField) return { character, armorClassSync: null };

  // Needs a transaction now that a dex (or other auto-relevant) change can
  // trigger an AC recompute-and-write-back in the same atomic unit as the
  // column update itself (PLAN.md §3.5) — previously a single pool.query().
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-derive armor_class_mode from a FRESH, LOCKED read taken INSIDE this
    // transaction, rather than trusting the `character` snapshot fetched
    // before it (pre-merge review finding: a concurrent
    // PATCH /armor-class-mode could commit in the gap between that snapshot
    // and this transaction's BEGIN, letting a client-supplied armorClass in
    // THIS request slip past the "auto is authoritative" drop below and get
    // written verbatim — not just transiently, since nothing would ever
    // correct it until some other auto-relevant mutation happened to trigger
    // a recompute). FOR UPDATE also serializes against
    // recomputeAndApplyCharacterArmorClass's own FOR UPDATE lock on the same
    // row, so two concurrent requests can't interleave their reads of it.
    const lockedRes = await client.query<{ armor_class_mode: 'auto' | 'manual' }>(
      `SELECT armor_class_mode FROM characters WHERE id = $1 FOR UPDATE`,
      [characterId],
    );
    const autoArmorClass = lockedRes.rows[0]?.armor_class_mode === 'auto';
    if (autoArmorClass && 'armorClass' in patch) {
      delete patch.armorClass;
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const column = UPDATABLE_COLUMNS[key];
      if (!column) continue;
      sets.push(`${column} = $${i++}`);
      values.push(value);
    }
    if (input.hitDiceRemaining !== undefined) {
      sets.push(`hit_dice_remaining = $${i++}`);
      values.push(input.hitDiceRemaining ? JSON.stringify(input.hitDiceRemaining) : null);
    }

    // The armorClass-drop above can leave `sets` empty (e.g. a patch that
    // was ONLY `{armorClass: ...}` against an auto-mode character) — nothing
    // left to write, so just release the lock and return the current row.
    if (sets.length === 0) {
      const current = await client.query(`SELECT * FROM characters WHERE id = $1`, [characterId]);
      await client.query('COMMIT');
      return { character: current.rows[0], armorClassSync: null };
    }

    sets.push(`updated_at = now()`);
    values.push(characterId);

    const result = await client.query(`UPDATE characters SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
    let updated = result.rows[0];

    let armorClassSync: UpdateCharacterResult['armorClassSync'] = null;
    if (autoArmorClass) {
      const acResult = await recomputeAndApplyCharacterArmorClass(client, characterId);
      updated = acResult.character;
      if (acResult.changed) {
        armorClassSync = { character: acResult.character, encounterSyncs: acResult.encounterSyncs };
      }
    }

    await client.query('COMMIT');
    return { character: updated, armorClassSync };
  } catch (err) {
    await client.query('ROLLBACK');
    if (isCheckViolation(err)) {
      throw new AppError('VALIDATION_ERROR', 'Character data violates a database constraint', { cause: String(err) });
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteCharacter(pool: Pool, actorId: number, characterId: number): Promise<void> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);
  await pool.query(`DELETE FROM characters WHERE id = $1`, [characterId]);
}

// One character can (rarely) be a live combat_participants row in more than
// one encounter at once (the unique index is per-encounter, not global), so
// this returns an array — the sockets layer broadcasts HP_CHANGED once per
// affected encounter. Each such row's sync_seq is bumped in the SAME
// transaction as the HP update itself (PLAN.md §5.2), not as a follow-up
// query that could observe a different snapshot.
export interface EncounterHpSyncTarget {
  encounter_id: number;
  campaign_id: number;
  sync_seq: number;
  participant_id: number;
  hp_visibility: 'exact' | 'banded' | 'hidden';
}

export interface ApplyHpDeltaResult {
  character: Record<string, unknown>;
  encounterSyncs: EncounterHpSyncTarget[];
}

export async function applyHpDelta(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: HpDeltaInput,
): Promise<ApplyHpDeltaResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<HpState>(
      `SELECT hp_current, hp_max, hp_temp FROM characters WHERE id = $1 FOR UPDATE`,
      [characterId],
    );
    const { hpCurrent, hpTemp } = applyHpDeltaWithTempAbsorption(locked.rows[0], input);

    const result = await client.query(
      `UPDATE characters
       SET hp_current = $1,
           hp_temp = $2,
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [hpCurrent, hpTemp, characterId],
    );

    const encounterSyncs = await client.query<EncounterHpSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.character_id = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id, cp.hp_visibility`,
      [characterId],
    );

    await client.query('COMMIT');
    return { character: result.rows[0], encounterSyncs: encounterSyncs.rows };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// REFACTOR-PLAN.md §6 / docs/rules/attacks-and-damage.md §2.3 — a sibling to
// applyHpDelta above, not a replacement: this is the one that actually
// applies resistance/vulnerability/immunity, by rolling the damage dice
// SERVER-SIDE (same RNG primitive as diceRolls.ts's rollDice — "the RNG
// lives here and only here" extended to damage, not just d20s) rather than
// trusting a client-computed final delta, which would let a client simply
// skip a target's resistance. Heals/temp-HP grants/manual DM corrections
// keep using the plain applyHpDelta above unchanged.
export interface ApplyDamageResult {
  character: Record<string, unknown>;
  encounterSyncs: EncounterHpSyncTarget[];
  diceRoll: { diceTotal: number; rolls: number[] };
  rawTotal: number;
  appliedDamage: number;
  breakdown: {
    diceTotal: number;
    modifier: number;
    resistanceApplied: boolean;
    vulnerabilityApplied: boolean;
    immune: boolean;
  };
}

export async function applyDamage(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: ApplyDamageInput,
): Promise<ApplyDamageResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<
      HpState & { damage_resistances: string[]; damage_vulnerabilities: string[]; damage_immunities: string[] }
    >(
      `SELECT hp_current, hp_max, hp_temp, damage_resistances, damage_vulnerabilities, damage_immunities
       FROM characters WHERE id = $1 FOR UPDATE`,
      [characterId],
    );
    const row = locked.rows[0]!;

    // Dice doubling is a rolling-time concern (docs/rules/
    // attacks-and-damage.md §1.2/§2.2) — roll double the dice count when
    // this was a critical hit, never double the flat modifier.
    const diceCount = input.isCritical ? input.diceCount * 2 : input.diceCount;
    const rolls = Array.from({ length: diceCount }, () => rollDie(input.diceSides));
    const diceTotal = rolls.reduce((sum, r) => sum + r, 0);

    const applied = computeAppliedDamage(
      { rolledDiceTotal: diceTotal, modifier: input.modifier, damageType: input.damageType ?? null, isCritical: input.isCritical },
      { resistances: row.damage_resistances, vulnerabilities: row.damage_vulnerabilities, immunities: row.damage_immunities },
    );

    const { hpCurrent, hpTemp } = applyHpDeltaWithTempAbsorption(row, { delta: -applied.appliedDamage, tempDelta: 0 });

    const result = await client.query(
      `UPDATE characters SET hp_current = $1, hp_temp = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [hpCurrent, hpTemp, characterId],
    );

    const encounterSyncs = await client.query<EncounterHpSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.character_id = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id, cp.hp_visibility`,
      [characterId],
    );

    if (input.encounterId !== undefined) {
      await client.query(
        `INSERT INTO dice_rolls
           (campaign_id, user_id, character_id, encounter_id, roll_type, roll_context,
            d20_rolls, keep, dice_sides, dice_count, modifier, result_total, visible_to_players)
         VALUES ($1,$2,$3,$4,'damage',$5,$6,'normal',$7,$8,$9,$10,true)`,
        [
          character.campaign_id, actorId, characterId, input.encounterId,
          input.rollContext ?? null, rolls, input.diceSides, diceCount, input.modifier, diceTotal + input.modifier,
        ],
      );
    }

    await client.query('COMMIT');
    return {
      character: result.rows[0],
      encounterSyncs: encounterSyncs.rows,
      diceRoll: { diceTotal, rolls },
      rawTotal: applied.rawTotal,
      appliedDamage: applied.appliedDamage,
      breakdown: applied.breakdown,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---- Bulk read sub-resources ----
//
// Added alongside the existing replace-all PUT endpoints below: those PUTs
// already return the freshly-replaced list, but there was no way to read the
// current list on initial page load (e.g. opening a character sheet) without
// performing a write first. Same read authorization as getCharacter (any
// campaign member may view another member's sheet) — ownership is only
// enforced on the mutating PUTs via authorizeCharacterMutation.

export async function getClasses(pool: Pool, actorId: number, characterId: number) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireMembership(pool, character.campaign_id, actorId);
  const result = await pool.query(`SELECT * FROM character_classes WHERE character_id = $1`, [characterId]);
  return result.rows;
}

export async function getSkillProficiencies(pool: Pool, actorId: number, characterId: number) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireMembership(pool, character.campaign_id, actorId);
  const result = await pool.query(`SELECT * FROM character_skill_proficiencies WHERE character_id = $1`, [characterId]);
  return result.rows;
}

export async function getSavingThrowProficiencies(pool: Pool, actorId: number, characterId: number) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireMembership(pool, character.campaign_id, actorId);
  const result = await pool.query(
    `SELECT * FROM character_saving_throw_proficiencies WHERE character_id = $1`,
    [characterId],
  );
  return result.rows;
}

// ---- Bulk replace-all sub-resources ----

export async function replaceClasses(pool: Pool, actorId: number, characterId: number, input: ReplaceClassesInput) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  // Multiclass prerequisite check (5e's real rule: 13+ in the relevant
  // ability of EVERY class the character will end up with, old and new
  // alike) — only applies once this write results in more than one distinct
  // class. Since this is a bulk replace-all, "distinct classes in the final
  // input > 1" is exactly "multiclassed after this write"; a plain
  // single-class write (final count == 1, e.g. starting play, or leveling up
  // the one class you have) is never checked, per the task brief.
  await validateMulticlassPrerequisites(pool, character, input.map((row) => row.classId));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM character_classes WHERE character_id = $1`, [characterId]);
    for (const row of input) {
      await client.query(
        `INSERT INTO character_classes (character_id, class_id, subclass_id, level) VALUES ($1, $2, $3, $4)`,
        [characterId, row.classId, row.subclassId ?? null, row.level],
      );
    }
    // Spell-slot resource pools are a COMPUTED CACHE derived from
    // character_classes (PLAN.md §3.2) — recompute in the SAME transaction
    // as the class replace so the two never observably diverge.
    await recomputeSpellSlots(client, characterId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await pool.query(`SELECT * FROM character_classes WHERE character_id = $1`, [characterId]);
  return result.rows;
}

export async function replaceSkillProficiencies(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: ReplaceSkillProficienciesInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM character_skill_proficiencies WHERE character_id = $1`, [characterId]);
    for (const row of input) {
      await client.query(
        `INSERT INTO character_skill_proficiencies (character_id, skill_id, level) VALUES ($1, $2, $3)`,
        [characterId, row.skillId, row.level],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await pool.query(`SELECT * FROM character_skill_proficiencies WHERE character_id = $1`, [characterId]);
  return result.rows;
}

export async function replaceSavingThrowProficiencies(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: ReplaceSavingThrowProficienciesInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM character_saving_throw_proficiencies WHERE character_id = $1`, [characterId]);
    for (const row of input) {
      await client.query(
        `INSERT INTO character_saving_throw_proficiencies (character_id, ability_score_id) VALUES ($1, $2)`,
        [characterId, row.abilityScoreId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await pool.query(
    `SELECT * FROM character_saving_throw_proficiencies WHERE character_id = $1`,
    [characterId],
  );
  return result.rows;
}

// ---- Exhaustion (kept as its own explicit endpoint, not folded into the
// general PATCH /:id — per the task brief, exhaustion is DM/environmental-
// effect-driven, not a player self-service field, so it needs its own
// DM-only gate rather than riding along with updateCharacter's owner-or-DM
// rule) ----

export async function updateExhaustion(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: ExhaustionInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  const role = await requireMembership(pool, character.campaign_id, actorId);
  requireDm(role);

  const result = await pool.query(
    `UPDATE characters SET exhaustion_level = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [input.level, characterId],
  );
  return result.rows[0];
}

// ---- Armor class mode toggle (Phase 3.5) — PATCH /characters/:id/armor-class-mode.
//
// Route/shape mirrors updateExhaustion's dedicated-endpoint pattern above,
// but the authorization is the DM-or-owning-player rule
// (authorizeCharacterMutation), not DM-only: unlike exhaustion (a DM/
// environmental-effect concern), a player choosing to let their own PC's AC
// track its equipped armor automatically is a self-service sheet decision.
export async function updateArmorClassMode(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: UpdateArmorClassModeInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  if (input.mode === 'manual') {
    // Switching to manual just flips the mode column — armor_class is left
    // at whatever its last value was, no forced reset.
    const result = await pool.query(
      `UPDATE characters SET armor_class_mode = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [input.mode, characterId],
    );
    return { character: result.rows[0], armorClassSync: null as { encounterSyncs: ArmorClassEncounterSync[] } | null };
  }

  // Switching TO 'auto' triggers an immediate recompute-and-write-back in
  // the same transaction as the mode flip.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE characters SET armor_class_mode = $1, updated_at = now() WHERE id = $2`, [input.mode, characterId]);
    const acResult = await recomputeAndApplyCharacterArmorClass(client, characterId);
    await client.query('COMMIT');
    return {
      character: acResult.character,
      armorClassSync: acResult.changed ? { encounterSyncs: acResult.encounterSyncs } : null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
