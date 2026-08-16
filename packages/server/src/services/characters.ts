import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm, requireOwnerOrDm, requireControllerOrDm, getMembership, type CampaignRole } from './authz.js';
import { applyHpDeltaWithTempAbsorption, type HpState } from './hp.js';
import { isCheckViolation } from './dbErrors.js';
import { recomputeSpellSlots, validateMulticlassPrerequisites } from './spellSlots.js';
import { recomputeAndApplyCharacterArmorClass, type ArmorClassEncounterSync } from './armorClass.js';
import { computeAppliedDamage } from './damage.js';
import { rollDie, deriveIsCriticalFromAttackRoll } from './diceRolls.js';
import { criticalDiceCount } from './diceEngine.js';
import { findUserByEmail } from './users.js';
import { resolveVisibilitySync } from './visibility.js';
import { computeConcentrationDc, findActiveConcentrationEffect } from './concentration.js';
import type {
  AssignCharacterOwnerInput,
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
  id: string;
  campaign_id: string;
  is_pc: boolean;
  owner_user_id: string | null;
  // Iteration 2 "Character ownership vs. control" — NULL defers to
  // owner_user_id (see requireControllerOrDm in services/authz.ts).
  controller_user_id: string | null;
  gm_notes: string | null;
  // DM hide/reveal for NPCs (role_split, services/visibility.ts) — only ever
  // meaningful for is_pc = false; requireCharacterVisible below always treats
  // a PC as visible regardless of this column's value.
  visible_to_players: boolean;
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
export async function fetchCharacterOrThrow(pool: Pool | PoolClient, characterId: string): Promise<CharacterRow> {
  const result = await pool.query<CharacterRow>(`SELECT * FROM characters WHERE id = $1`, [characterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Character');
  return row;
}

/** Layer 2+3+4 for a resource-id-keyed character route: membership, then ownership-or-DM. */
export async function authorizeCharacterMutation(
  pool: Pool,
  actorId: string,
  character: CharacterRow,
): Promise<CampaignRole> {
  const role = await requireMembership(pool, character.campaign_id, actorId);
  requireOwnerOrDm(role, character.owner_user_id, actorId);
  return role;
}

/**
 * Iteration 2 "Character ownership vs. control" — sibling of
 * authorizeCharacterMutation for "act right now" endpoints (spend HP,
 * resource pools, roll dice as this character) as opposed to sheet-editing
 * endpoints (update/delete/duplicate, spells/items/attacks replace,
 * armor-class-mode — those stay on authorizeCharacterMutation/ownership,
 * per the plan's explicit split: ownership gates the sheet, control gates
 * acting). Delegating control never grants sheet-edit rights.
 */
export async function authorizeCharacterAction(
  pool: Pool,
  actorId: string,
  character: CharacterRow,
): Promise<CampaignRole> {
  const role = await requireMembership(pool, character.campaign_id, actorId);
  requireControllerOrDm(role, character.controller_user_id, character.owner_user_id, actorId);
  return role;
}

// DM hide/reveal for NPCs — the same reusable role_split layer locations/
// factions use (services/visibility.ts's resolveVisibilitySync), applied
// here to a single already-fetched row rather than a list query (see that
// module's own header comment on when to use which). A PC (is_pc = true) is
// always visible, full stop — only an NPC can be hidden. 404s (not 403) on a
// hidden NPC, matching notes.ts's "don't confirm existence of hidden content
// to an unauthorized viewer" precedent.
function requireCharacterVisible(character: CharacterRow, actorId: string, role: CampaignRole): void {
  if (character.is_pc) return;
  const visible = resolveVisibilitySync(
    { mode: 'role_split', ownerUserId: character.owner_user_id, visibleToPlayers: character.visible_to_players },
    actorId,
    role,
  );
  if (!visible) throw notFound('Character');
}

/**
 * Layer 2+3 for a resource-id-keyed character READ route (get the sheet, or
 * list/get a sub-resource: items, spells, feats, attacks, resource pools,
 * currency, effects, control-delegation history): membership, then the NPC
 * hide/reveal check above. Sibling of authorizeCharacterMutation (which
 * additionally enforces ownership, for WRITES) — every read-only character
 * service exported across this file and its siblings (characterItems.ts,
 * characterSpells.ts, characterFeats.ts, characterAttacks.ts,
 * resourcePools.ts, characterCurrency.ts, effects.ts, characterControl.ts)
 * calls this instead of a bare requireMembership, so a hidden NPC's entire
 * sheet 404s the same way from every one of those endpoints, enforced in
 * this one place rather than re-derived per file.
 */
export async function requireCharacterReadAccess(pool: Pool, actorId: string, character: CharacterRow): Promise<CampaignRole> {
  const role = await requireMembership(pool, character.campaign_id, actorId);
  requireCharacterVisible(character, actorId, role);
  return role;
}

// HP and every other character field are always visible to the whole
// campaign now (hide/reveal was removed) — this is a plain read for every
// role, `role` is kept only because callers already have it from the
// membership check and other sibling functions share the signature shape.
// Iteration 2's one concrete GM-only field (gm_notes) — stripped from every
// read a non-DM viewer receives, regardless of ownership (an owning player
// still doesn't see the DM's private notes on their own character). Phase 3
// "NPC 'what they want' field" added npc_motivation as a second GM-only
// field with the exact same visibility rule — extended here rather than a
// second near-identical redaction function.
export function redactGmNotes<T extends { gm_notes?: unknown; npc_motivation?: unknown }>(character: T, role: CampaignRole): T {
  if (resolveVisibilitySync({ mode: 'gm_only' }, null, role)) return character;
  return { ...character, gm_notes: undefined, npc_motivation: undefined };
}

// Blocker fix: every function below that returns a character row as a side
// effect of a mutation (not just the two read paths above) MUST also redact
// — a non-DM caller mutating their own character (HP, an item toggle, an
// armor-class-mode flip, ...) was previously getting the raw row back,
// gm_notes included, even though they can never read it via GET. Centralized
// here so a future mutation can't reintroduce the leak by forgetting to call
// redactGmNotes directly.

// DM hide/reveal for NPCs (role_split) — filtered in SQL, never a post-fetch
// JS pass, matching this codebase's existing "list-endpoint filtering
// belongs in the query" convention (see assets.ts's listAssets, notes.ts's
// listNotes, services/locations.ts's listLocations). A PC row always passes
// (is_pc = true); an NPC passes only when revealed or owned by the actor
// (owner_user_id is normally null for an NPC, but the OR costs nothing and
// keeps this in sync with requireCharacterVisible's pure-JS equivalent for a
// single row).
export async function listCharacters(pool: Pool, campaignId: string, actorId: string, role: CampaignRole) {
  const values: unknown[] = [campaignId];
  let where = 'campaign_id = $1';
  if (role !== 'dm') {
    where += ' AND (is_pc = true OR visible_to_players = true OR owner_user_id = $2)';
    values.push(actorId);
  }

  const result = await pool.query<CharacterRow>(`SELECT * FROM characters WHERE ${where} ORDER BY name ASC`, values);
  return result.rows.map((row) => redactGmNotes(row, role));
}

export async function getCharacter(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  const role = await requireCharacterReadAccess(pool, actorId, character);
  return redactGmNotes(character, role);
}

async function insertCharacterRow(
  client: Pool | PoolClient,
  campaignId: string,
  isPc: boolean,
  ownerUserId: string | null,
  actorId: string,
  input: CreateCharacterInput,
) {
  try {
    const result = await client.query<CharacterRow>(
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
    return result.rows[0]!;
  } catch (err) {
    if (isCheckViolation(err)) {
      throw new AppError('VALIDATION_ERROR', 'Character data violates a database constraint', { cause: String(err) });
    }
    throw err;
  }
}

export async function createCharacter(
  pool: Pool,
  actorId: string,
  campaignId: string,
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

    // Per-player character-creation permission/limit (DM-settable, see
    // services/campaigns.ts's updateMember). Locking the caller's OWN
    // campaign_members row serializes concurrent create requests from the
    // same player — a second request blocks on FOR UPDATE until the first
    // transaction commits, so its own COUNT afterward always sees the
    // first request's new row; this is what closes the "two rapid creates
    // both pass the count check" race, not the COUNT query alone.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const memberRes = await client.query<{ can_create_characters: boolean; max_characters: number | null }>(
        `SELECT can_create_characters, max_characters FROM campaign_members
         WHERE campaign_id = $1 AND user_id = $2 FOR UPDATE`,
        [campaignId, actorId],
      );
      const member = memberRes.rows[0];
      if (member && !member.can_create_characters) {
        throw new AppError('FORBIDDEN_ROLE', 'The DM has disabled character creation for you in this campaign');
      }
      if (member && member.max_characters !== null) {
        const countRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::int AS count FROM characters WHERE campaign_id = $1 AND owner_user_id = $2`,
          [campaignId, actorId],
        );
        if (Number(countRes.rows[0]!.count) >= member.max_characters) {
          throw new AppError(
            'CHARACTER_LIMIT_REACHED',
            `You have reached your character limit (${member.max_characters}) for this campaign`,
          );
        }
      }
      const character = await insertCharacterRow(client, campaignId, isPc, ownerUserId, actorId, input);
      await client.query('COMMIT');
      return character;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Iteration 2: a spectator falls through past the 'player' branch above
  // with no explicit case of its own — without this check it would silently
  // hit the DM path below and be allowed to create arbitrary characters,
  // which is exactly the "any non-player role is treated as DM" bug this
  // guard closes now that CampaignRole has a third value.
  if (role === 'spectator') {
    throw new AppError('FORBIDDEN_ROLE', 'Spectators cannot create characters');
  }

  // DM: a PC may be created unassigned (owner attached later by email, see
  // assignCharacterToPlayer) — characters_check no longer forces a
  // non-null owner on every PC (1784269776666_relax-characters-owner-check.ts).
  // NPCs must never have an owner, regardless of what was passed in. No
  // per-player limit applies to the DM.
  if (!isPc) {
    ownerUserId = null;
  }
  return insertCharacterRow(pool, campaignId, isPc, ownerUserId, actorId, input);
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
  // Iteration 2's one concrete GM-only field — DM-settable only, see the
  // role check in updateCharacter dropping it for non-DM patches.
  gmNotes: 'gm_notes',
  // Phase 3 "NPC 'what they want' field" — same DM-only treatment as gmNotes.
  npcMotivation: 'npc_motivation',
  // DM hide/reveal for NPCs — same DM-only treatment as gmNotes/npcMotivation.
  visibleToPlayers: 'visible_to_players',
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
  actorId: string,
  characterId: string,
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
  if (role !== 'dm') {
    delete patch.gmNotes;
    delete patch.npcMotivation;
    delete patch.visibleToPlayers;
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
  if (!hasAnyUpdatableField) return { character: redactGmNotes(character, role), armorClassSync: null };

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
      return { character: redactGmNotes(current.rows[0], role), armorClassSync: null };
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
    return { character: redactGmNotes(updated, role), armorClassSync };
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

// DM-only: assign a PC to a player by email (the counterpart to campaign
// import — see campaignImport.ts — now creating every character unassigned,
// and to updateCharacter's raw ownerUserId field, which takes a user_id
// directly with no membership check). Validates the target is an existing
// account AND already a member of this character's campaign — a gap
// campaignImport.ts's own comment used to flag as missing before this
// existed.
export async function assignCharacterToPlayer(
  pool: Pool,
  actorId: string,
  characterId: string,
  input: AssignCharacterOwnerInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  const role = await requireMembership(pool, character.campaign_id, actorId);
  requireDm(role);

  if (!character.is_pc) {
    throw new AppError('VALIDATION_ERROR', 'Cannot assign an owner to an NPC');
  }

  const user = await findUserByEmail(pool, input.email);
  if (!user) throw new AppError('NOT_FOUND', 'No user with that email exists');

  const targetRole = await getMembership(pool, character.campaign_id, user.id);
  if (!targetRole) {
    throw new AppError('VALIDATION_ERROR', 'That user is not a member of this campaign');
  }
  if (targetRole === 'spectator') {
    throw new AppError('VALIDATION_ERROR', 'Spectators cannot own characters');
  }

  // Reassigning ownership also clears any stale control delegation — the
  // new owner is the default controller until a fresh delegation says
  // otherwise, same "ownership change resets control" rule
  // services/characterControl.ts documents for its own revoke path.
  const result = await pool.query<CharacterRow>(
    `UPDATE characters SET owner_user_id = $1, controller_user_id = NULL WHERE id = $2 RETURNING *`,
    [user.id, characterId],
  );
  return result.rows[0]!;
}

export async function deleteCharacter(pool: Pool, actorId: string, characterId: string): Promise<void> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);
  await pool.query(`DELETE FROM characters WHERE id = $1`, [characterId]);
}

// Copies every column off the source row (same "read the row, drop id/
// timestamps, re-insert" approach as catalogHomebrew.ts's
// duplicateCatalogRow) rather than hand-listing columns, so this doesn't
// drift out of sync as the table gains fields. Same authorization as
// update/delete: owner-or-DM. The copy is always a fresh, full-HP, living
// character regardless of the source's current state.
export async function duplicateCharacter(pool: Pool, actorId: string, characterId: string) {
  const source = await fetchCharacterOrThrow(pool, characterId);
  const role = await authorizeCharacterMutation(pool, actorId, source);

  // controller_user_id excluded — a duplicated character is a brand-new
  // resource nobody has delegated control of yet, regardless of whether the
  // source currently has an active delegation. gm_notes excluded too: a
  // player-owner duplicating their own PC (server allows it) must never have
  // the DM's private notes silently copied onto the new row — the response
  // redaction below stops the read leak, this stops it from persisting into
  // a fresh row in the first place.
  const omit = new Set(['id', 'created_at', 'updated_at', 'controller_user_id', 'gm_notes']);
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const [col, val] of Object.entries(source)) {
    if (omit.has(col) || col.endsWith('_legacy')) continue;
    columns.push(col);
    if (col === 'name') values.push(`${String(val)} (Copy)`);
    else if (col === 'hp_current') values.push(source.hp_max);
    else if (col === 'hp_temp') values.push(0);
    else if (col === 'is_alive') values.push(true);
    else if (col === 'created_by_user_id') values.push(actorId);
    else values.push(val);
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(
    `INSERT INTO characters (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values,
  );
  return redactGmNotes(result.rows[0], role);
}

// One character can (rarely) be a live combat_participants row in more than
// one encounter at once (the unique index is per-encounter, not global), so
// this returns an array — the sockets layer broadcasts HP_CHANGED once per
// affected encounter. Each such row's sync_seq is bumped in the SAME
// transaction as the HP update itself (PLAN.md §5.2), not as a follow-up
// query that could observe a different snapshot.
export interface EncounterHpSyncTarget {
  encounter_id: string;
  campaign_id: string;
  sync_seq: number;
  participant_id: string;
}

export interface ApplyHpDeltaResult {
  character: Record<string, unknown>;
  encounterSyncs: EncounterHpSyncTarget[];
}

export async function applyHpDelta(
  pool: Pool,
  actorId: string,
  characterId: string,
  input: HpDeltaInput,
): Promise<ApplyHpDeltaResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  // Control-gated, not ownership-gated — spending HP is "acting right now,"
  // not sheet-editing. See authorizeCharacterAction's own comment.
  const role = await authorizeCharacterAction(pool, actorId, character);

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
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
      [characterId],
    );

    await client.query('COMMIT');
    return { character: redactGmNotes(result.rows[0], role), encounterSyncs: encounterSyncs.rows };
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
  // Phase 2 "concentration-broken save prompt" — set only when this damage
  // actually landed (appliedDamage > 0) AND the character was concentrating
  // on something. The route broadcasts CONCENTRATION_CHECK_PROMPTED from
  // this; resolving the save (roll + DM removing the effect on failure)
  // happens through the existing dice-rolls/DELETE-effect endpoints, not
  // here.
  concentrationCheck: { effectId: string; effectDefinitionId: string; effectName: string; dc: number } | null;
}

export async function applyDamage(
  pool: Pool,
  actorId: string,
  characterId: string,
  input: ApplyDamageInput,
): Promise<ApplyDamageResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  // Control-gated, not ownership-gated — same reasoning as applyHpDelta above.
  const role = await authorizeCharacterAction(pool, actorId, character);

  // M3: re-derived from the actual stored roll, never trusted from
  // input.isCritical — see deriveIsCriticalFromAttackRoll's own comment.
  const isCritical = await deriveIsCriticalFromAttackRoll(pool, character.campaign_id, input.attackRollId);

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
    const diceCount = criticalDiceCount(input.diceCount, isCritical);
    const rolls = Array.from({ length: diceCount }, () => rollDie(input.diceSides));
    const diceTotal = rolls.reduce((sum, r) => sum + r, 0);

    const applied = computeAppliedDamage(
      { rolledDiceTotal: diceTotal, modifier: input.modifier, damageType: input.damageType ?? null, isCritical },
      { resistances: row.damage_resistances, vulnerabilities: row.damage_vulnerabilities, immunities: row.damage_immunities },
    );

    const { hpCurrent, hpTemp } = applyHpDeltaWithTempAbsorption(row, { delta: -applied.appliedDamage, tempDelta: 0 });

    // Phase 2 "HP/damage undo" — snapshot the PRE-damage values so
    // undoLastDamage can restore exactly this application, same "snapshot
    // before you overwrite" idiom as combat_participants.last_action_
    // economy_snapshot (applyActionEconomy, above in this file).
    const hpSnapshot = { hp_current: row.hp_current, hp_temp: row.hp_temp };

    const result = await client.query(
      `UPDATE characters SET hp_current = $1, hp_temp = $2, last_hp_snapshot = $4::jsonb, updated_at = now() WHERE id = $3 RETURNING *`,
      [hpCurrent, hpTemp, characterId, JSON.stringify(hpSnapshot)],
    );

    const encounterSyncs = await client.query<EncounterHpSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.character_id = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
      [characterId],
    );

    if (input.encounterId !== undefined) {
      await client.query(
        `INSERT INTO dice_rolls
           (campaign_id, user_id, character_id, encounter_id, roll_type, roll_context,
            d20_rolls, keep, dice_sides, dice_count, modifier, result_total, is_critical)
         VALUES ($1,$2,$3,$4,'damage',$5,$6,'normal',$7,$8,$9,$10,$11)`,
        [
          character.campaign_id, actorId, characterId, input.encounterId,
          input.rollContext ?? null, rolls, input.diceSides, diceCount, input.modifier, diceTotal + input.modifier,
          isCritical,
        ],
      );
    }

    const concentrationEffect =
      applied.appliedDamage > 0 ? await findActiveConcentrationEffect(client, { characterId, monsterInstanceId: null }) : null;

    await client.query('COMMIT');
    return {
      character: redactGmNotes(result.rows[0], role),
      encounterSyncs: encounterSyncs.rows,
      diceRoll: { diceTotal, rolls },
      rawTotal: applied.rawTotal,
      appliedDamage: applied.appliedDamage,
      breakdown: applied.breakdown,
      concentrationCheck: concentrationEffect
        ? {
            effectId: concentrationEffect.id,
            effectDefinitionId: concentrationEffect.effect_definition_id,
            effectName: concentrationEffect.name,
            dc: computeConcentrationDc(applied.appliedDamage),
          }
        : null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface UndoLastDamageResult {
  character: Record<string, unknown>;
  encounterSyncs: EncounterHpSyncTarget[];
}

// Phase 2 "HP/damage undo" — DM-only, same "undo is a rewind tool, not a
// player self-action" split as undoActionEconomy (services/encounters.ts),
// even though applyDamage itself allows the controller too. Restores
// exactly the pre-damage hp_current/hp_temp captured in last_hp_snapshot;
// does NOT restore a concentration effect a failed save may have removed in
// the meantime — undoing HP and re-granting a lost concentration effect are
// two different "oops" scenarios, and only the first one is in scope here.
export async function undoLastDamage(pool: Pool, actorId: string, characterId: string): Promise<UndoLastDamageResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  const role = await requireMembership(pool, character.campaign_id, actorId);
  requireDm(role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<{ last_hp_snapshot: { hp_current: number; hp_temp: number } | null }>(
      `SELECT last_hp_snapshot FROM characters WHERE id = $1 FOR UPDATE`,
      [characterId],
    );
    const snapshot = locked.rows[0]?.last_hp_snapshot;
    if (!snapshot) throw new AppError('CONFLICT', 'Nothing to undo for that character');

    const result = await client.query(
      `UPDATE characters SET hp_current = $1, hp_temp = $2, last_hp_snapshot = NULL, updated_at = now() WHERE id = $3 RETURNING *`,
      [snapshot.hp_current, snapshot.hp_temp, characterId],
    );

    const encounterSyncs = await client.query<EncounterHpSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.character_id = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
      [characterId],
    );

    await client.query('COMMIT');
    return { character: redactGmNotes(result.rows[0], role), encounterSyncs: encounterSyncs.rows };
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

export async function getClasses(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireCharacterReadAccess(pool, actorId, character);
  const result = await pool.query(`SELECT * FROM character_classes WHERE character_id = $1`, [characterId]);
  return result.rows;
}

export async function getSkillProficiencies(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireCharacterReadAccess(pool, actorId, character);
  const result = await pool.query(`SELECT * FROM character_skill_proficiencies WHERE character_id = $1`, [characterId]);
  return result.rows;
}

export async function getSavingThrowProficiencies(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireCharacterReadAccess(pool, actorId, character);
  const result = await pool.query(
    `SELECT * FROM character_saving_throw_proficiencies WHERE character_id = $1`,
    [characterId],
  );
  return result.rows;
}

// ---- Bulk replace-all sub-resources ----

export async function replaceClasses(pool: Pool, actorId: string, characterId: string, input: ReplaceClassesInput) {
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
  actorId: string,
  characterId: string,
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
  actorId: string,
  characterId: string,
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
  actorId: string,
  characterId: string,
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
  actorId: string,
  characterId: string,
  input: UpdateArmorClassModeInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  const role = await authorizeCharacterMutation(pool, actorId, character);

  if (input.mode === 'manual') {
    // Switching to manual just flips the mode column — armor_class is left
    // at whatever its last value was, no forced reset.
    const result = await pool.query(
      `UPDATE characters SET armor_class_mode = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [input.mode, characterId],
    );
    return {
      character: redactGmNotes(result.rows[0], role),
      armorClassSync: null as { encounterSyncs: ArmorClassEncounterSync[] } | null,
    };
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
      character: redactGmNotes(acResult.character, role),
      armorClassSync: acResult.changed ? { encounterSyncs: acResult.encounterSyncs } : null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
