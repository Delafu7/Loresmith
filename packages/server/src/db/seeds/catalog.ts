// SRD catalog seed — pulls races/subraces/classes/subclasses/class_levels/
// class_features/backgrounds/feats/ability_scores/skills/languages/alignments
// for BOTH the 2014 and 2024 rules editions directly out of the dnd5e-srd
// skill's JSON data files (no shelling out to its Python query.py — reading
// the JSON straight from Node is simpler and keeps this pipeline
// Python-free).
//
// Catalog vs. instance discipline: everything in this file is edition-scoped
// reference data, shared across all campaigns and never touched by gameplay
// mutations. It is safe to re-run (every insert is an upsert keyed on the
// table's real unique constraint).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// packages/server/src/db/seeds -> repo root is 5 levels up.
const SRD_DATA_ROOT = path.resolve(__dirname, '../../../../../.opencode/skills/dnd5e-srd/data');

type Edition = '2014' | '2024';
const EDITIONS: Edition[] = ['2014', '2024'];

function loadJson<T = any>(edition: Edition, filename: string): T[] {
  const p = path.join(SRD_DATA_ROOT, edition, filename);
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Some categories are named differently between editions (2024 renamed
// "race" -> "species", added weapon-mastery-properties, etc). This table
// tells us which file backs a given logical category per edition.
const RACE_FILE: Record<Edition, string> = {
  '2014': '5e-SRD-Races.json',
  '2024': '5e-SRD-Species.json',
};
const SUBRACE_FILE: Record<Edition, string> = {
  '2014': '5e-SRD-Subraces.json',
  '2024': '5e-SRD-Subspecies.json',
};

// classes.spellcasting_type + primary ability hardcoded per the 12 SRD base
// classes (same 12 in both editions). 2024's own class JSON already carries
// `primary_ability`, so that's used when present; this map is the fallback
// for 2014, which has no such field, and is always used for
// spellcasting_type since neither edition's class JSON states it directly.
const SPELLCASTING_TYPE: Record<string, 'full' | 'half' | 'third' | 'pact' | 'none'> = {
  barbarian: 'none', bard: 'full', cleric: 'full', druid: 'full', fighter: 'none',
  monk: 'none', paladin: 'half', ranger: 'half', rogue: 'none', sorcerer: 'full',
  warlock: 'pact', wizard: 'full',
};
const PRIMARY_ABILITY_FALLBACK: Record<string, string> = {
  barbarian: 'str', bard: 'cha', cleric: 'wis', druid: 'wis', fighter: 'str',
  monk: 'dex', paladin: 'str', ranger: 'dex', rogue: 'dex', sorcerer: 'cha',
  warlock: 'cha', wizard: 'int',
};

function metersToFeet(m: number): number {
  // The dnd5e-srd skill's data has been converted from feet to meters
  // (5 ft. = 1.5 m). Convert back to feet for `races.speed INT` — every SRD
  // speed value survives this round-trip as a clean integer (25/30/35 ft.).
  return Math.round(m * (10 / 3));
}

function sizeOf(entry: any): string {
  if (typeof entry.size === 'string') return entry.size;
  // 2024 Tiefling has no fixed `size` — it's a player choice (`size_options`)
  // between Small and Medium. Store a readable summary rather than nulling
  // out a NOT NULL column.
  const options = entry.size_options?.from?.options;
  if (Array.isArray(options) && options.length > 0) {
    return options.map((o: any) => o.size).filter(Boolean).join(' or ');
  }
  return 'Medium';
}

function traitsOf(entry: any): unknown[] {
  return entry.traits ?? entry.racial_traits ?? [];
}

function abilityBonusesOf(entry: any): unknown[] {
  return entry.ability_bonuses ?? [];
}

function prerequisiteTextOf(entry: any): string | null {
  if (typeof entry.prerequisite === 'string') return entry.prerequisite;
  if (Array.isArray(entry.prerequisites) && entry.prerequisites.length > 0) {
    return entry.prerequisites
      .map((p: any) => `${(p.ability_score?.name ?? p.ability_score?.index ?? '').toUpperCase()} ${p.minimum_score}`)
      .join(', ');
  }
  return null;
}

function featureLevelOf(entry: any): number {
  if (typeof entry.level === 'number') return entry.level;
  // 2024 features carry level as {index:"barbarian-3", name:"Barbarian 3"}
  const idx: string = entry.level?.index ?? '';
  const parsed = parseInt(idx.split('-').pop() ?? '', 10);
  return Number.isNaN(parsed) ? 1 : parsed;
}

function featureDescriptionOf(entry: any): string {
  if (typeof entry.description === 'string') return entry.description;
  if (Array.isArray(entry.desc)) return entry.desc.join('\n\n');
  return '';
}

export async function seedCatalog(client: Client): Promise<void> {
  console.log('\n[catalog] Seeding SRD reference data for editions 2014 + 2024...');

  // ---- Edition-invariant lookups (no edition_scope column) ----
  const abilityMap = await seedAbilityScores(client);
  const skillMap = await seedSkills(client, abilityMap);
  await seedAlignments(client);
  await seedLanguages(client);

  // ---- Edition-scoped catalog (each edition gets its own row set) ----
  const raceMap = await seedRacesAndSubraces(client);
  const { classMap, subclassMap } = await seedClassesAndSubclasses(client, abilityMap);
  await seedClassLevels(client, classMap);
  await seedClassFeatures(client, classMap, subclassMap);
  const featMap = await seedFeats(client);
  await seedBackgrounds(client, skillMap, featMap);

  // ---- Phase 2 additions ----
  await seedConditions(client);
  const { schoolMap, damageTypeMap } = await seedMagicSchoolsAndDamageTypes(client);
  await seedSpells(client, schoolMap, abilityMap, classMap);
  await seedItems(client, damageTypeMap);
  await seedClassMulticlassPrerequisites(client, abilityMap, classMap);
  await seedMulticlassSpellSlotTable(client);
  await seedEffectDefinitions(client);

  console.log('[catalog] Done.');
  void raceMap; // used by demo seed via re-query, kept for clarity of return chain
}

async function seedAbilityScores(client: Client): Promise<Map<string, number>> {
  const rows = loadJson('2014', '5e-SRD-Ability-Scores.json');
  const map = new Map<string, number>();
  for (const r of rows) {
    const res = await client.query(
      `INSERT INTO ability_scores (index_key, name, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (index_key) DO UPDATE SET name = EXCLUDED.name, full_name = EXCLUDED.full_name
       RETURNING id`,
      [r.index, r.name, r.full_name],
    );
    map.set(r.index, res.rows[0].id);
  }
  console.log(`  ability_scores: ${map.size}`);
  return map;
}

async function seedSkills(client: Client, abilityMap: Map<string, number>): Promise<Map<string, number>> {
  const rows = loadJson('2014', '5e-SRD-Skills.json');
  const map = new Map<string, number>();
  for (const r of rows) {
    const abilityId = abilityMap.get(r.ability_score.index);
    if (!abilityId) throw new Error(`Unknown ability score '${r.ability_score.index}' for skill '${r.index}'`);
    const res = await client.query(
      `INSERT INTO skills (index_key, name, ability_score_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (index_key) DO UPDATE SET name = EXCLUDED.name, ability_score_id = EXCLUDED.ability_score_id
       RETURNING id`,
      [r.index, r.name, abilityId],
    );
    map.set(r.index, res.rows[0].id);
  }
  console.log(`  skills: ${map.size}`);
  return map;
}

async function seedAlignments(client: Client): Promise<void> {
  const rows = loadJson('2014', '5e-SRD-Alignments.json');
  for (const r of rows) {
    await client.query(
      `INSERT INTO alignments (index_key, name) VALUES ($1, $2)
       ON CONFLICT (index_key) DO UPDATE SET name = EXCLUDED.name`,
      [r.index, r.name],
    );
  }
  console.log(`  alignments: ${rows.length}`);
}

async function seedLanguages(client: Client): Promise<void> {
  const merged = new Map<string, { name: string; editions: Set<Edition> }>();
  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Languages.json');
    for (const r of rows) {
      const entry = merged.get(r.index) ?? { name: r.name, editions: new Set<Edition>() };
      entry.editions.add(edition);
      merged.set(r.index, entry);
    }
  }
  for (const [index_key, { name, editions }] of merged) {
    const scope = editions.size === 2 ? 'both' : [...editions][0];
    await client.query(
      `INSERT INTO languages (index_key, name, edition_scope) VALUES ($1, $2, $3)
       ON CONFLICT (index_key) DO UPDATE SET name = EXCLUDED.name, edition_scope = EXCLUDED.edition_scope`,
      [index_key, name, scope],
    );
  }
  console.log(`  languages: ${merged.size}`);
}

async function seedRacesAndSubraces(client: Client): Promise<Map<string, number>> {
  // key: `${edition}:${race_index}` -> races.id
  const raceMap = new Map<string, number>();
  let raceCount = 0;
  let subraceCount = 0;

  for (const edition of EDITIONS) {
    const rows = loadJson(edition, RACE_FILE[edition]);
    for (const r of rows) {
      const res = await client.query(
        `INSERT INTO races (index_key, name, edition_scope, speed, size, ability_bonuses, traits, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (index_key, edition_scope) DO UPDATE SET
           name = EXCLUDED.name, speed = EXCLUDED.speed, size = EXCLUDED.size,
           ability_bonuses = EXCLUDED.ability_bonuses, traits = EXCLUDED.traits
         RETURNING id`,
        [
          r.index, r.name, edition, metersToFeet(r.speed), sizeOf(r),
          JSON.stringify(abilityBonusesOf(r)), JSON.stringify(traitsOf(r)),
          edition === '2014' ? 'SRD 5.1 (2014 rules)' : 'SRD 5.2 (2024 rules)',
        ],
      );
      raceMap.set(`${edition}:${r.index}`, res.rows[0].id);
      raceCount++;
    }
  }

  for (const edition of EDITIONS) {
    const rows = loadJson(edition, SUBRACE_FILE[edition]);
    for (const r of rows) {
      const parentIndex = r.race?.index ?? r.species?.index;
      const raceId = raceMap.get(`${edition}:${parentIndex}`);
      if (!raceId) throw new Error(`Unknown parent race '${parentIndex}' for subrace '${r.index}' (${edition})`);
      await client.query(
        `INSERT INTO subraces (race_id, index_key, name, ability_bonuses, traits)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (race_id, index_key) DO UPDATE SET
           name = EXCLUDED.name, ability_bonuses = EXCLUDED.ability_bonuses, traits = EXCLUDED.traits`,
        [raceId, r.index, r.name, JSON.stringify(abilityBonusesOf(r)), JSON.stringify(traitsOf(r))],
      );
      subraceCount++;
    }
  }

  console.log(`  races: ${raceCount}, subraces: ${subraceCount}`);
  return raceMap;
}

async function seedClassesAndSubclasses(
  client: Client,
  abilityMap: Map<string, number>,
): Promise<{ classMap: Map<string, number>; subclassMap: Map<string, number> }> {
  const classMap = new Map<string, number>(); // `${edition}:${class_index}` -> id
  const subclassMap = new Map<string, number>(); // `${edition}:${class_index}:${subclass_index}` -> id
  let classCount = 0;
  let subclassCount = 0;

  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Classes.json');
    for (const r of rows) {
      const primaryAbilityIndex = r.primary_ability?.ability_scores?.[0]?.index ?? PRIMARY_ABILITY_FALLBACK[r.index];
      const primaryAbilityId = primaryAbilityIndex ? abilityMap.get(primaryAbilityIndex) ?? null : null;
      const savingThrowIds = (r.saving_throws ?? []).map((s: any) => abilityMap.get(s.index)).filter(Boolean);
      const spellcastingType = SPELLCASTING_TYPE[r.index] ?? 'none';

      const res = await client.query(
        `INSERT INTO classes (index_key, name, edition_scope, hit_die, primary_ability_id, spellcasting_type, saving_throw_proficiency_ids, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (index_key, edition_scope) DO UPDATE SET
           name = EXCLUDED.name, hit_die = EXCLUDED.hit_die, primary_ability_id = EXCLUDED.primary_ability_id,
           spellcasting_type = EXCLUDED.spellcasting_type, saving_throw_proficiency_ids = EXCLUDED.saving_throw_proficiency_ids
         RETURNING id`,
        [
          r.index, r.name, edition, r.hit_die, primaryAbilityId, spellcastingType, savingThrowIds,
          edition === '2014' ? 'SRD 5.1 (2014 rules)' : 'SRD 5.2 (2024 rules)',
        ],
      );
      classMap.set(`${edition}:${r.index}`, res.rows[0].id);
      classCount++;
    }
  }

  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Subclasses.json');
    for (const r of rows) {
      const classId = classMap.get(`${edition}:${r.class.index}`);
      if (!classId) throw new Error(`Unknown class '${r.class.index}' for subclass '${r.index}' (${edition})`);
      const res = await client.query(
        `INSERT INTO subclasses (class_id, index_key, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (class_id, index_key) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [classId, r.index, r.name],
      );
      subclassMap.set(`${edition}:${r.class.index}:${r.index}`, res.rows[0].id);
      subclassCount++;
    }
  }

  console.log(`  classes: ${classCount}, subclasses: ${subclassCount}`);
  return { classMap, subclassMap };
}

async function seedClassLevels(client: Client, classMap: Map<string, number>): Promise<void> {
  let count = 0;
  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Levels.json');
    for (const r of rows) {
      // The Levels.json file mixes true per-class-level rows with a second
      // kind of entry that carries a `subclass` field (e.g. barbarian-3
      // appears twice: once as the general class level, once again scoped
      // to the Berserker subclass with no `prof_bonus`). Those subclass
      // rows belong to `class_features` (already captured from
      // Features.json) — skip them here to avoid a null prof_bonus and a
      // duplicate-level collision on the (class_id, level) unique key.
      if (r.subclass) continue;
      const classId = classMap.get(`${edition}:${r.class.index}`);
      if (!classId) throw new Error(`Unknown class '${r.class.index}' for level row (${edition})`);
      await client.query(
        `INSERT INTO class_levels (class_id, level, proficiency_bonus, features_unlocked, spell_slots)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (class_id, level) DO UPDATE SET
           proficiency_bonus = EXCLUDED.proficiency_bonus, features_unlocked = EXCLUDED.features_unlocked,
           spell_slots = EXCLUDED.spell_slots`,
        [
          classId, r.level, r.prof_bonus,
          JSON.stringify(r.features ?? []),
          r.spellcasting ? JSON.stringify(r.spellcasting) : null,
        ],
      );
      count++;
    }
  }
  console.log(`  class_levels: ${count}`);
}

async function seedClassFeatures(
  client: Client,
  classMap: Map<string, number>,
  subclassMap: Map<string, number>,
): Promise<void> {
  // class_features has no natural unique key (PLAN.md §3.2 doesn't give it
  // one), so a plain INSERT loop isn't safe to re-run. This function is the
  // sole writer of the table, so make it idempotent by fully repopulating
  // it every time rather than appending.
  await client.query('DELETE FROM class_features');

  let count = 0;
  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Features.json');
    for (const r of rows) {
      const classId = classMap.get(`${edition}:${r.class.index}`);
      if (!classId) throw new Error(`Unknown class '${r.class.index}' for feature '${r.index}' (${edition})`);
      const subclassId = r.subclass ? subclassMap.get(`${edition}:${r.class.index}:${r.subclass.index}`) ?? null : null;
      await client.query(
        `INSERT INTO class_features (class_id, subclass_id, level, name, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [classId, subclassId, featureLevelOf(r), r.name, featureDescriptionOf(r)],
      );
      count++;
    }
  }
  console.log(`  class_features: ${count}`);
}

async function seedFeats(client: Client): Promise<Map<string, number>> {
  const featMap = new Map<string, number>(); // `${edition}:${feat_index}` -> id
  let count = 0;
  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Feats.json');
    for (const r of rows) {
      const description = typeof r.description === 'string' ? r.description : (r.desc ?? []).join('\n\n');
      const res = await client.query(
        `INSERT INTO feats (index_key, name, edition_scope, prerequisite, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (index_key, edition_scope) DO UPDATE SET
           name = EXCLUDED.name, prerequisite = EXCLUDED.prerequisite, description = EXCLUDED.description
         RETURNING id`,
        [r.index, r.name, edition, prerequisiteTextOf(r), description],
      );
      featMap.set(`${edition}:${r.index}`, res.rows[0].id);
      count++;
    }
  }
  // Documented, not a bug: 2014 SRD has essentially no general feats (the
  // dnd5e-srd skill ships exactly one, Grappler) — feats were an optional
  // PHB variant rule in 2014, not core SRD content. 2024 has 17.
  console.log(`  feats: ${count} (2014 is expected to be minimal per the SRD skill's own notes)`);
  return featMap;
}

async function seedBackgrounds(
  client: Client,
  skillMap: Map<string, number>,
  featMap: Map<string, number>,
): Promise<void> {
  let count = 0;
  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Backgrounds.json');
    for (const r of rows) {
      const proficiencyEntries: any[] = r.starting_proficiencies ?? r.proficiencies ?? [];
      const skillIds = proficiencyEntries
        .filter((p) => typeof p.index === 'string' && p.index.startsWith('skill-'))
        .map((p) => skillMap.get(p.index.replace(/^skill-/, '')))
        .filter(Boolean);

      const abilityBonusChoices = r.ability_scores ? JSON.stringify(r.ability_scores) : null;
      const grantedFeatId = r.feat ? featMap.get(`${edition}:${r.feat.index}`) ?? null : null;

      const description = r.feature
        ? `${r.feature.name}: ${(r.feature.desc ?? []).join(' ')}`
        : null;

      await client.query(
        `INSERT INTO backgrounds (index_key, name, edition_scope, skill_proficiency_ids, ability_bonus_choices, granted_feat_id, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (index_key, edition_scope) DO UPDATE SET
           name = EXCLUDED.name, skill_proficiency_ids = EXCLUDED.skill_proficiency_ids,
           ability_bonus_choices = EXCLUDED.ability_bonus_choices, granted_feat_id = EXCLUDED.granted_feat_id,
           description = EXCLUDED.description`,
        [r.index, r.name, edition, skillIds, abilityBonusChoices, grantedFeatId, description],
      );
      count++;
    }
  }
  console.log(`  backgrounds: ${count}`);
}

// ===================== Phase 2 additions =====================

function conditionDescriptionOf(entry: any): string {
  if (typeof entry.description === 'string') return entry.description;
  if (Array.isArray(entry.desc)) return entry.desc.join('\n\n');
  return '';
}

// `conditions` (flavor text only, per PLAN.md §3.1/§3.4) — sourced from the
// dnd5e-srd skill's own data, same file per edition. Unlike `languages`,
// the 2014 and 2024 text genuinely differs (2024 rewrote every condition in
// a different format), so this seeds one row per (index_key, edition)
// rather than merging into edition_scope='both'.
async function seedConditions(client: Client): Promise<void> {
  let count = 0;
  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Conditions.json');
    for (const r of rows) {
      await client.query(
        `INSERT INTO conditions (index_key, name, description, edition_scope)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (index_key, edition_scope) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description`,
        [r.index, r.name, conditionDescriptionOf(r), edition],
      );
      count++;
    }
  }
  console.log(`  conditions: ${count}`);
}

// Edition-invariant lookups with no dnd5e-srd skill data backing them (the
// skill has no such JSON files) — hardcoded from the fixed SRD list, same
// treatment `spells`/`items`/`monsters` get for being app-owned.
const MAGIC_SCHOOLS: Array<{ index: string; name: string; description: string }> = [
  { index: 'abjuration', name: 'Abjuration', description: 'A school of magic that includes protective spells: barriers, wards, banishment, and dispelling other magic.' },
  { index: 'conjuration', name: 'Conjuration', description: 'A school of magic that involves the transportation of objects and creatures from one location to another, and the creation of objects and effects out of nothing.' },
  { index: 'divination', name: 'Divination', description: 'A school of magic that reveals information, whether in the form of secrets long forgotten, glimpses of the future, or insight into the location of hidden things.' },
  { index: 'enchantment', name: 'Enchantment', description: 'A school of magic that affects the mind of others, influencing or controlling their behavior.' },
  { index: 'evocation', name: 'Evocation', description: 'A school of magic that manipulates magical energy to produce a desired effect, often channeling raw elemental power into dramatic and destructive results.' },
  { index: 'illusion', name: 'Illusion', description: 'A school of magic that deceives the senses or minds of others, causing them to see, hear, or remember things that are not real (or that are real, but not present).' },
  { index: 'necromancy', name: 'Necromancy', description: 'A school of magic that manipulates the energies of life and death, often to harm the living or bolster the undead.' },
  { index: 'transmutation', name: 'Transmutation', description: 'A school of magic that changes the properties of a creature, object, or condition.' },
];

const DAMAGE_TYPES: Array<{ index: string; name: string; description: string }> = [
  { index: 'acid', name: 'Acid', description: 'The corrosive spray of a black dragon’s breath and the dissolving enzymes secreted by a black pudding deal acid damage.' },
  { index: 'bludgeoning', name: 'Bludgeoning', description: 'Blunt force attacks — hammers, falling, constriction — deal bludgeoning damage.' },
  { index: 'cold', name: 'Cold', description: 'The infernal chill radiating from an ice devil’s spear and the frigid blast of a white dragon’s breath deal cold damage.' },
  { index: 'fire', name: 'Fire', description: 'Red dragons breathe fire, and many spells conjure flames to deal fire damage.' },
  { index: 'force', name: 'Force', description: 'Force damage is pure magical energy focused into a damaging form. Most eldritch blasts and magic missiles deal this damage.' },
  { index: 'lightning', name: 'Lightning', description: 'A lightning bolt spell and a blue dragon’s breath deal lightning damage.' },
  { index: 'necrotic', name: 'Necrotic', description: 'Necrotic damage, dealt by certain undead and spells that channel the power of death, withers matter and even the soul.' },
  { index: 'piercing', name: 'Piercing', description: 'Puncturing and impaling attacks, including spears and monsters’ bites, deal piercing damage.' },
  { index: 'poison', name: 'Poison', description: 'Venomous stings and the toxic gas of a green dragon’s breath deal poison damage.' },
  { index: 'psychic', name: 'Psychic', description: 'Mental abilities such as a mind flayer’s psionic blast deal psychic damage.' },
  { index: 'radiant', name: 'Radiant', description: 'Radiant damage, dealt by a cleric’s flame strike spell or an angel’s smiting weapon, sears the flesh like fire and overloads the spirit with power.' },
  { index: 'slashing', name: 'Slashing', description: 'Swords, axes, and monsters’ claws deal slashing damage.' },
  { index: 'thunder', name: 'Thunder', description: 'A concussive burst of sound, such as the effect of a thunderwave spell, deals thunder damage.' },
];

async function seedMagicSchoolsAndDamageTypes(
  client: Client,
): Promise<{ schoolMap: Map<string, number>; damageTypeMap: Map<string, number> }> {
  const schoolMap = new Map<string, number>();
  for (const s of MAGIC_SCHOOLS) {
    const res = await client.query(
      `INSERT INTO magic_schools (index_key, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (index_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id`,
      [s.index, s.name, s.description],
    );
    schoolMap.set(s.index, res.rows[0].id);
  }
  console.log(`  magic_schools: ${schoolMap.size}`);

  const damageTypeMap = new Map<string, number>();
  for (const d of DAMAGE_TYPES) {
    const res = await client.query(
      `INSERT INTO damage_types (index_key, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (index_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id`,
      [d.index, d.name, d.description],
    );
    damageTypeMap.set(d.index, res.rows[0].id);
  }
  console.log(`  damage_types: ${damageTypeMap.size}`);

  return { schoolMap, damageTypeMap };
}

// App-owned catalog (no SRD-skill spell data by design — see CLAUDE.md).
// A starter list spanning cantrips through 3rd level, covering the four
// classes called out in the task brief (Cleric, Wizard, Paladin, Warlock)
// plus incidental Bard/Sorcerer/Druid/Ranger access where the real 5e spell
// lists overlap, so `spell_classes` demonstrates genuine many-to-many reuse
// rather than one row per spell.
interface SpellSeed {
  slug: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  v: boolean;
  s: boolean;
  m: boolean;
  materialDescription?: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  save?: string; // ability index
  attack?: 'melee' | 'ranged';
  damageAtLevel?: Record<string, string>;
  description: string;
  higherLevel?: string;
  classes: string[]; // class index_keys
}

const SPELLS: SpellSeed[] = [
  // ---- Cantrips (level 0) ----
  { slug: 'guidance', name: 'Guidance', level: 0, school: 'divination', castingTime: '1 action', range: 'Touch', v: true, s: true, m: false, duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, description: 'You touch one willing creature. Once before the spell ends, the target can roll a d4 and add the number to one ability check of its choice.', classes: ['cleric', 'druid'] },
  { slug: 'sacred-flame', name: 'Sacred Flame', level: 0, school: 'evocation', castingTime: '1 action', range: '60 feet', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, save: 'dex', damageAtLevel: { '1': '1d8', '5': '2d8', '11': '3d8', '17': '4d8' }, description: 'Flame-like radiance descends on a creature you can see within range. The target must succeed on a Dexterity saving throw or take radiant damage. The target gains no benefit from cover for this saving throw.', classes: ['cleric'] },
  { slug: 'spare-the-dying', name: 'Spare the Dying', level: 0, school: 'necromancy', castingTime: '1 action', range: 'Touch', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, description: 'You touch a living creature that has 0 hit points. The creature becomes stable. This spell has no effect on undead or constructs.', classes: ['cleric'] },
  { slug: 'thaumaturgy', name: 'Thaumaturgy', level: 0, school: 'transmutation', castingTime: '1 action', range: '30 feet', v: true, s: false, m: false, duration: 'Up to 1 minute', concentration: false, ritual: false, description: 'You manifest a minor wonder, a sign of supernatural power, within range: your voice booms, flames flicker, the ground trembles, or a similar minor effect occurs.', classes: ['cleric'] },
  { slug: 'light', name: 'Light', level: 0, school: 'evocation', castingTime: '1 action', range: 'Touch', v: true, s: false, m: true, materialDescription: 'a firefly or phosphorescent moss', duration: '1 hour', concentration: false, ritual: false, description: 'You touch one object that is no larger than 10 feet in any dimension. Until the spell ends, the object sheds bright light in a 20-foot radius.', classes: ['cleric', 'wizard', 'bard', 'sorcerer'] },
  { slug: 'mage-hand', name: 'Mage Hand', level: 0, school: 'conjuration', castingTime: '1 action', range: '30 feet', v: true, s: true, m: false, duration: '1 minute', concentration: false, ritual: false, description: 'A spectral, floating hand appears at a point you choose within range. The hand lasts for the duration and can manipulate objects, open unlocked doors/containers, and carry up to 10 pounds.', classes: ['wizard', 'bard', 'sorcerer', 'warlock'] },
  { slug: 'prestidigitation', name: 'Prestidigitation', level: 0, school: 'transmutation', castingTime: '1 action', range: '10 feet', v: true, s: true, m: false, duration: 'Up to 1 hour', concentration: false, ritual: false, description: 'This spell is a minor magical trick that novice spellcasters use for practice: create a harmless sensory effect, light or snuff a candle, clean or soil an object, chill/warm/flavor nonliving material, or make a mark appear.', classes: ['wizard', 'bard', 'sorcerer', 'warlock'] },
  { slug: 'fire-bolt', name: 'Fire Bolt', level: 0, school: 'evocation', castingTime: '1 action', range: '120 feet', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, attack: 'ranged', damageAtLevel: { '1': '1d10', '5': '2d10', '11': '3d10', '17': '4d10' }, description: 'You hurl a mote of fire at a creature or object within range. On a hit, the target takes fire damage. A flammable object hit by this spell ignites if it isn’t being worn or carried.', classes: ['wizard', 'sorcerer'] },
  { slug: 'ray-of-frost', name: 'Ray of Frost', level: 0, school: 'evocation', castingTime: '1 action', range: '60 feet', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, attack: 'ranged', damageAtLevel: { '1': '1d8', '5': '2d8', '11': '3d8', '17': '4d8' }, description: 'A frigid beam of blue-white light streaks toward a creature within range. On a hit, it takes cold damage and its speed is reduced by 10 feet until the start of your next turn.', classes: ['wizard', 'sorcerer'] },
  { slug: 'eldritch-blast', name: 'Eldritch Blast', level: 0, school: 'evocation', castingTime: '1 action', range: '120 feet', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, attack: 'ranged', damageAtLevel: { '1': '1d10' }, description: 'A beam of crackling energy streaks toward a creature within range. On a hit, the target takes force damage. The spell creates more than one beam at higher character levels (2 at level 5, 3 at level 11, 4 at level 17).', classes: ['warlock'] },
  { slug: 'minor-illusion', name: 'Minor Illusion', level: 0, school: 'illusion', castingTime: '1 action', range: '30 feet', v: false, s: true, m: true, materialDescription: 'a bit of fleece', duration: '1 minute', concentration: false, ritual: false, description: 'You create a sound or an image of an object within range that lasts for the duration. The illusion also ends if you dismiss it as an action or cast this spell again.', classes: ['wizard', 'bard', 'sorcerer', 'warlock'] },

  // ---- Level 1 ----
  { slug: 'bless', name: 'Bless', level: 1, school: 'enchantment', castingTime: '1 action', range: '30 feet', v: true, s: true, m: true, materialDescription: 'a sprinkling of holy water', duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, description: 'You bless up to three creatures of your choice within range. Whenever a target makes an attack roll or a saving throw before the spell ends, the target can add 1d4 to the attack roll or saving throw.', higherLevel: 'When you cast this spell using a spell slot of 2nd level or higher, you can target one additional creature for each slot level above 1st.', classes: ['cleric', 'paladin'] },
  { slug: 'cure-wounds', name: 'Cure Wounds', level: 1, school: 'evocation', castingTime: '1 action', range: 'Touch', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, damageAtLevel: { '1': '1d8' }, description: 'A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier. This spell has no effect on undead or constructs.', higherLevel: 'When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d8 for each slot level above 1st.', classes: ['cleric', 'paladin', 'druid', 'bard'] },
  { slug: 'guiding-bolt', name: 'Guiding Bolt', level: 1, school: 'evocation', castingTime: '1 action', range: '120 feet', v: true, s: true, m: false, duration: '1 round', concentration: false, ritual: false, attack: 'ranged', damageAtLevel: { '1': '4d6' }, description: 'A flash of light streaks toward a creature of your choice within range. On a hit, the target takes radiant damage, and the next attack roll made against it before the end of your next turn has advantage.', higherLevel: 'When you cast this spell using a spell slot of 2nd level or higher, the damage increases by 1d6 for each slot level above 1st.', classes: ['cleric'] },
  { slug: 'shield-of-faith', name: 'Shield of Faith', level: 1, school: 'abjuration', castingTime: '1 bonus action', range: '60 feet', v: true, s: true, m: true, materialDescription: 'a small parchment with a bit of holy text written on it', duration: 'Concentration, up to 10 minutes', concentration: true, ritual: false, description: 'A shimmering field appears and surrounds a creature of your choice within range, granting it a +2 bonus to AC for the duration.', classes: ['cleric', 'paladin'] },
  { slug: 'healing-word', name: 'Healing Word', level: 1, school: 'evocation', castingTime: '1 bonus action', range: '60 feet', v: true, s: false, m: false, duration: 'Instantaneous', concentration: false, ritual: false, damageAtLevel: { '1': '1d4' }, description: 'A creature of your choice that you can see within range regains hit points equal to 1d4 + your spellcasting ability modifier.', higherLevel: 'When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d4 for each slot level above 1st.', classes: ['cleric', 'druid', 'bard'] },
  { slug: 'command', name: 'Command', level: 1, school: 'enchantment', castingTime: '1 action', range: '60 feet', v: true, s: false, m: false, duration: '1 round', concentration: false, ritual: false, save: 'wis', description: 'You speak a one-word command to a creature you can see within range. The target must succeed on a Wisdom saving throw or follow the command on its next turn (flee, drop, grovel, halt, or approach you).', classes: ['cleric', 'paladin'] },
  { slug: 'detect-magic', name: 'Detect Magic', level: 1, school: 'divination', castingTime: '1 action', range: 'Self', v: true, s: true, m: false, duration: 'Concentration, up to 10 minutes', concentration: true, ritual: true, description: 'For the duration, you sense the presence of magic within 30 feet of you. If you sense magic in this way, you can use your action to see a faint aura around any visible creature or object in the area that bears magic.', classes: ['cleric', 'wizard', 'paladin', 'bard', 'sorcerer', 'druid', 'ranger'] },
  { slug: 'magic-missile', name: 'Magic Missile', level: 1, school: 'evocation', castingTime: '1 action', range: '120 feet', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, damageAtLevel: { '1': '3x1d4+1' }, description: 'You create three glowing darts of magical force. Each dart hits a creature of your choice that you can see within range, dealing 1d4 + 1 force damage.', higherLevel: 'When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.', classes: ['wizard', 'sorcerer'] },
  { slug: 'shield', name: 'Shield', level: 1, school: 'abjuration', castingTime: '1 reaction', range: 'Self', v: true, s: true, m: false, duration: '1 round', concentration: false, ritual: false, description: 'An invisible barrier of magical force appears and protects you. Until the start of your next turn, you have a +5 bonus to AC and you take no damage from magic missile.', classes: ['wizard', 'sorcerer'] },
  { slug: 'mage-armor', name: 'Mage Armor', level: 1, school: 'abjuration', castingTime: '1 action', range: 'Touch', v: true, s: true, m: true, materialDescription: 'a piece of cured leather', duration: '8 hours', concentration: false, ritual: false, description: 'You touch a willing creature who isn’t wearing armor, and a protective magical force surrounds it until the spell ends. The target’s base AC becomes 13 + its Dexterity modifier.', classes: ['wizard', 'sorcerer'] },
  { slug: 'sleep', name: 'Sleep', level: 1, school: 'enchantment', castingTime: '1 action', range: '90 feet', v: true, s: true, m: true, materialDescription: 'a pinch of fine sand, rose petals, or a cricket', duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, damageAtLevel: { '1': '5d8' }, description: 'This spell sends creatures into a magical slumber. Roll 5d8; the total is how many hit points of creatures this spell can affect, starting with the creature with the lowest current hit points.', classes: ['wizard', 'bard', 'sorcerer'] },
  { slug: 'identify', name: 'Identify', level: 1, school: 'divination', castingTime: '1 minute', range: 'Touch', v: true, s: true, m: true, materialDescription: 'a pearl worth at least 100 gp and an owl feather', duration: 'Instantaneous', concentration: false, ritual: true, description: 'You choose one object that you must touch throughout the casting. If it is a magic item or some other magic-imbued object, you learn its properties and how to use them.', classes: ['wizard', 'bard'] },
  { slug: 'hex', name: 'Hex', level: 1, school: 'enchantment', castingTime: '1 bonus action', range: '90 feet', v: true, s: true, m: true, materialDescription: 'the petrified eye of a newt', duration: 'Concentration, up to 1 hour', concentration: true, ritual: false, damageAtLevel: { '1': '1d6' }, description: 'You place a curse on a creature that you can see within range. Until the spell ends, you deal an extra 1d6 necrotic damage to the target whenever you hit it with an attack, and the target has disadvantage on ability checks with an ability score of your choice.', classes: ['warlock'] },
  { slug: 'armor-of-agathys', name: 'Armor of Agathys', level: 1, school: 'abjuration', castingTime: '1 action', range: 'Self', v: true, s: true, m: true, materialDescription: 'a piece of white fur', duration: '1 hour', concentration: false, ritual: false, damageAtLevel: { '1': '5' }, description: 'A protective magical force surrounds you, manifesting as a spectral frost that covers you and your gear. You gain 5 temporary hit points. If a creature hits you with a melee attack while you have these hit points, the creature takes 5 cold damage.', classes: ['warlock'] },
  { slug: 'charm-person', name: 'Charm Person', level: 1, school: 'enchantment', castingTime: '1 action', range: '30 feet', v: true, s: true, m: false, duration: '1 hour', concentration: false, ritual: false, save: 'wis', description: 'You attempt to charm a humanoid you can see within range. It must make a Wisdom saving throw, and does so with advantage if you or your companions are fighting it. If it fails, it is charmed by you until the spell ends.', classes: ['wizard', 'bard', 'sorcerer', 'warlock', 'druid'] },
  { slug: 'compelled-duel', name: 'Compelled Duel', level: 1, school: 'enchantment', castingTime: '1 bonus action', range: '30 feet', v: true, s: false, m: false, duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, save: 'wis', description: 'You attempt to compel a creature into a duel. One creature that you can see must make a Wisdom saving throw or be compelled by your identity for the duration; it has disadvantage on attack rolls against creatures other than you.', classes: ['paladin'] },

  // ---- Level 2 ----
  { slug: 'spiritual-weapon', name: 'Spiritual Weapon', level: 2, school: 'evocation', castingTime: '1 bonus action', range: '60 feet', v: true, s: true, m: false, duration: '1 minute', concentration: false, ritual: false, attack: 'melee', damageAtLevel: { '1': '1d8' }, description: 'You create a floating, spectral weapon within range that lasts for the duration or until you cast this spell again. As a bonus action on your turn, you can move the weapon up to 20 feet and repeat the attack.', higherLevel: 'The damage increases by 1d8 for every two slot levels above 2nd.', classes: ['cleric'] },
  { slug: 'lesser-restoration', name: 'Lesser Restoration', level: 2, school: 'abjuration', castingTime: '1 action', range: 'Touch', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, description: 'You touch a creature and can end either one disease or one condition afflicting it: blinded, deafened, paralyzed, or poisoned.', classes: ['cleric', 'paladin', 'druid', 'bard', 'ranger'] },
  { slug: 'aid', name: 'Aid', level: 2, school: 'abjuration', castingTime: '1 action', range: '30 feet', v: true, s: true, m: true, materialDescription: 'a tiny strip of white cloth', duration: '8 hours', concentration: false, ritual: false, description: 'Your spell bolsters your allies with toughness and resolve. Choose up to three creatures within range. Each target’s hit point maximum and current hit points increase by 5 for the duration.', higherLevel: 'When you cast this spell using a spell slot of 3rd level or higher, each target’s hit points increase by an additional 5 for each slot level above 2nd.', classes: ['cleric', 'paladin'] },
  { slug: 'misty-step', name: 'Misty Step', level: 2, school: 'conjuration', castingTime: '1 bonus action', range: 'Self', v: false, s: false, m: false, duration: 'Instantaneous', concentration: false, ritual: false, description: 'Briefly surrounded by silvery mist, you teleport up to 30 feet to an unoccupied space that you can see.', classes: ['wizard', 'sorcerer', 'warlock'] },
  { slug: 'scorching-ray', name: 'Scorching Ray', level: 2, school: 'evocation', castingTime: '1 action', range: '120 feet', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, attack: 'ranged', damageAtLevel: { '1': '3x2d6' }, description: 'You create three rays of fire and hurl them at targets within range. You can hurl them at one target or several.', higherLevel: 'When you cast this spell using a slot of 3rd level or higher, you create one additional ray for each slot level above 2nd.', classes: ['wizard', 'sorcerer'] },
  { slug: 'invisibility', name: 'Invisibility', level: 2, school: 'illusion', castingTime: '1 action', range: 'Touch', v: true, s: true, m: true, materialDescription: 'an eyelash encased in gum arabic', duration: 'Concentration, up to 1 hour', concentration: true, ritual: false, description: 'A creature you touch becomes invisible until the spell ends. The spell ends early if the target attacks or casts a spell.', classes: ['wizard', 'bard', 'sorcerer', 'warlock'] },
  { slug: 'hold-person', name: 'Hold Person', level: 2, school: 'enchantment', castingTime: '1 action', range: '60 feet', v: true, s: true, m: true, materialDescription: 'a small, straight piece of iron', duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, save: 'wis', description: 'Choose a humanoid that you can see within range. The target must succeed on a Wisdom saving throw or be paralyzed for the duration.', higherLevel: 'When you cast this spell using a slot of 3rd level or higher, you can target one additional humanoid for each slot level above 2nd.', classes: ['wizard', 'cleric', 'bard', 'warlock'] },
  { slug: 'zone-of-truth', name: 'Zone of Truth', level: 2, school: 'enchantment', castingTime: '1 action', range: '60 feet', v: true, s: true, m: false, duration: '10 minutes', concentration: false, ritual: false, save: 'cha', description: 'You create a magical zone that guards against deception in a 15-foot-radius sphere centered on a point within range. A creature that enters the area for the first time must succeed on a Charisma saving throw or be unable to speak a deliberate lie.', classes: ['cleric', 'paladin', 'bard'] },
  { slug: 'suggestion', name: 'Suggestion', level: 2, school: 'enchantment', castingTime: '1 action', range: '30 feet', v: true, s: false, m: true, materialDescription: 'a snake’s tongue and a bit of honeycomb', duration: 'Concentration, up to 8 hours', concentration: true, ritual: false, save: 'wis', description: 'You suggest a course of activity to a creature you can see. Creatures that can’t be charmed are immune. The target must succeed on a Wisdom saving throw or pursue the suggested course of action.', classes: ['wizard', 'bard', 'warlock'] },

  // ---- Level 3 ----
  { slug: 'spirit-guardians', name: 'Spirit Guardians', level: 3, school: 'conjuration', castingTime: '1 action', range: 'Self (15-foot radius)', v: true, s: true, m: true, materialDescription: 'a holy symbol', duration: 'Concentration, up to 10 minutes', concentration: true, ritual: false, save: 'wis', damageAtLevel: { '3': '3d8' }, description: 'You call forth spirits to protect you. They flit around you to a distance of 15 feet for the duration. Each creature of your choice that enters the area for the first time on a turn must make a Wisdom saving throw or take radiant or necrotic damage (your choice).', higherLevel: 'The damage increases by 1d8 for each slot level above 3rd.', classes: ['cleric'] },
  { slug: 'revivify', name: 'Revivify', level: 3, school: 'necromancy', castingTime: '1 action', range: 'Touch', v: true, s: true, m: true, materialDescription: 'diamonds worth 300 gp, which the spell consumes', duration: 'Instantaneous', concentration: false, ritual: false, description: 'You touch a creature that has died within the last minute. That creature returns to life with 1 hit point. This spell can’t return to life a creature that has died of old age, nor can it restore any missing body parts.', classes: ['cleric', 'paladin'] },
  { slug: 'fireball', name: 'Fireball', level: 3, school: 'evocation', castingTime: '1 action', range: '150 feet', v: true, s: true, m: true, materialDescription: 'a tiny ball of bat guano and sulfur', duration: 'Instantaneous', concentration: false, ritual: false, save: 'dex', damageAtLevel: { '3': '8d6' }, description: 'A bright streak flashes from your pointing finger to a point you choose within range and then blossoms with a low roar into an explosion of flame. Each creature in a 20-foot-radius sphere must make a Dexterity saving throw, taking fire damage on a failed save, or half as much on a success.', higherLevel: 'The damage increases by 1d6 for each slot level above 3rd.', classes: ['wizard', 'sorcerer'] },
  { slug: 'counterspell', name: 'Counterspell', level: 3, school: 'abjuration', castingTime: '1 reaction', range: '60 feet', v: false, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, description: 'You attempt to interrupt a creature in the process of casting a spell. If the creature is casting a spell of 3rd level or lower, its spell fails and has no effect. Otherwise, make an ability check to determine whether the spell is interrupted.', classes: ['wizard', 'sorcerer', 'warlock'] },
  { slug: 'fly', name: 'Fly', level: 3, school: 'transmutation', castingTime: '1 action', range: 'Touch', v: true, s: true, m: true, materialDescription: 'a wing feather from any bird', duration: 'Concentration, up to 10 minutes', concentration: true, ritual: false, description: 'You touch a willing creature. The target gains a flying speed of 60 feet for the duration.', classes: ['wizard', 'sorcerer', 'warlock'] },
  { slug: 'dispel-magic', name: 'Dispel Magic', level: 3, school: 'abjuration', castingTime: '1 action', range: '120 feet', v: true, s: true, m: false, duration: 'Instantaneous', concentration: false, ritual: false, description: 'Choose one creature, object, or magical effect within range. Any spell of 3rd level or lower on the target ends. For each spell of higher level, make an ability check to determine whether it ends.', classes: ['cleric', 'wizard', 'paladin', 'bard', 'sorcerer', 'warlock'] },
  { slug: 'haste', name: 'Haste', level: 3, school: 'transmutation', castingTime: '1 action', range: '30 feet', v: true, s: true, m: true, materialDescription: 'a shaving of licorice root', duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, description: 'Choose a willing creature that you can see within range. Until the spell ends, the target’s speed is doubled, it gains a +2 bonus to AC, has advantage on Dexterity saving throws, and gains an additional action on its turn.', classes: ['wizard', 'sorcerer'] },
  { slug: 'hypnotic-pattern', name: 'Hypnotic Pattern', level: 3, school: 'illusion', castingTime: '1 action', range: '120 feet', v: false, s: true, m: true, materialDescription: 'a glowing stick of incense or a crystal vial filled with phosphorescent material', duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, save: 'wis', description: 'You create a twisting pattern of colors that weaves through the air. Each creature in a 30-foot cube who can see the pattern must make a Wisdom saving throw or become charmed by you, incapacitated, and have a speed of 0.', classes: ['wizard', 'bard', 'warlock'] },
];

async function seedSpells(
  client: Client,
  schoolMap: Map<string, number>,
  abilityMap: Map<string, number>,
  classMap: Map<string, number>,
): Promise<Map<string, number>> {
  const spellMap = new Map<string, number>(); // slug -> id (edition_scope='both' for all of these)
  for (const s of SPELLS) {
    const schoolId = schoolMap.get(s.school);
    if (!schoolId) throw new Error(`Unknown magic school '${s.school}' for spell '${s.slug}'`);
    const saveAbilityId = s.save ? abilityMap.get(s.save) ?? null : null;
    const res = await client.query(
      `INSERT INTO spells
         (slug, name, edition_scope, level, school_id, casting_time, range, component_v, component_s, component_m,
          material_description, duration, concentration, ritual, saving_throw_ability_id, attack_type,
          damage_at_level, description, higher_level_description, source)
       VALUES ($1,$2,'both',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (slug, edition_scope) DO UPDATE SET
         name = EXCLUDED.name, level = EXCLUDED.level, school_id = EXCLUDED.school_id,
         casting_time = EXCLUDED.casting_time, range = EXCLUDED.range,
         component_v = EXCLUDED.component_v, component_s = EXCLUDED.component_s, component_m = EXCLUDED.component_m,
         material_description = EXCLUDED.material_description, duration = EXCLUDED.duration,
         concentration = EXCLUDED.concentration, ritual = EXCLUDED.ritual,
         saving_throw_ability_id = EXCLUDED.saving_throw_ability_id, attack_type = EXCLUDED.attack_type,
         damage_at_level = EXCLUDED.damage_at_level, description = EXCLUDED.description,
         higher_level_description = EXCLUDED.higher_level_description
       RETURNING id`,
      [
        s.slug, s.name, s.level, schoolId, s.castingTime, s.range, s.v, s.s, s.m,
        s.materialDescription ?? null, s.duration, s.concentration, s.ritual, saveAbilityId, s.attack ?? null,
        s.damageAtLevel ? JSON.stringify(s.damageAtLevel) : null, s.description, s.higherLevel ?? null,
        'SRD 5.1/5.2 (edition-invariant spell mechanics)',
      ],
    );
    const spellId = res.rows[0].id;
    spellMap.set(s.slug, spellId);

    for (const classIndex of s.classes) {
      // Each class row is edition-scoped (2014 and 2024 both exist per
      // class), and this spell list is written for both — link every
      // matching class row across both editions.
      for (const edition of EDITIONS) {
        const classId = classMap.get(`${edition}:${classIndex}`);
        if (!classId) throw new Error(`Unknown class '${classIndex}' (${edition}) for spell '${s.slug}'`);
        await client.query(
          `INSERT INTO spell_classes (spell_id, class_id, subclass_id)
           VALUES ($1, $2, NULL)
           ON CONFLICT (spell_id, COALESCE(class_id,-1), COALESCE(subclass_id,-1)) DO NOTHING`,
          [spellId, classId],
        );
      }
    }
  }
  console.log(`  spells: ${SPELLS.length}, spell_classes: ${SPELLS.reduce((n, s) => n + s.classes.length * EDITIONS.length, 0)}`);
  return spellMap;
}

// App-owned catalog (no SRD-skill item data by design). A starter equipment
// list: a few weapons, armor pieces, a shield, common adventuring gear, a
// consumable, and one true magic item — enough to equip Brenna Ironhide
// (Fighter) and browse a small bestiary-adjacent gear list.
interface ItemSeed {
  slug: string;
  name: string;
  itemType: 'weapon' | 'armor' | 'shield' | 'tool' | 'adventuring_gear' | 'magic_item' | 'consumable' | 'mount' | 'vehicle';
  rarity: 'mundane' | 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary' | 'artifact';
  weightLb?: number;
  costCp?: number;
  armorClassBase?: number;
  armorClassFormula?: string;
  // Phase 3.5: structured AC fields (PLAN.md §3.5) that REPLACE the informal
  // properties.category/str_requirement/stealth_disadvantage keys this seed
  // used to stash on armor/shield rows — see the 5 armor/shield ITEMS rows
  // below for the only rows that set these.
  armorCategory?: 'light' | 'medium' | 'heavy';
  dexModifierRule?: 'full' | 'max_2' | 'none';
  strRequirement?: number;
  stealthDisadvantage?: boolean;
  damageDice?: string;
  damageType?: string;
  requiresAttunement?: boolean;
  properties?: Record<string, unknown>;
  description: string;
}

const ITEMS: ItemSeed[] = [
  { slug: 'dagger', name: 'Dagger', itemType: 'weapon', rarity: 'mundane', weightLb: 1, costCp: 200, damageDice: '1d4', damageType: 'piercing', properties: { finesse: true, light: true, thrown: { normal: 20, long: 60 } }, description: 'A simple, easily concealed blade.' },
  { slug: 'shortsword', name: 'Shortsword', itemType: 'weapon', rarity: 'mundane', weightLb: 2, costCp: 1000, damageDice: '1d6', damageType: 'piercing', properties: { finesse: true, light: true }, description: 'A light, quick martial melee weapon.' },
  { slug: 'longsword', name: 'Longsword', itemType: 'weapon', rarity: 'mundane', weightLb: 3, costCp: 1500, damageDice: '1d8', damageType: 'slashing', properties: { versatile: '1d10' }, description: 'A versatile martial melee weapon; can be wielded with one or two hands.' },
  { slug: 'mace', name: 'Mace', itemType: 'weapon', rarity: 'mundane', weightLb: 4, costCp: 500, damageDice: '1d6', damageType: 'bludgeoning', properties: {}, description: 'A simple bludgeoning weapon favored by clerics who forgo edged weapons.' },
  { slug: 'shortbow', name: 'Shortbow', itemType: 'weapon', rarity: 'mundane', weightLb: 2, costCp: 2500, damageDice: '1d6', damageType: 'piercing', properties: { ammunition: { normal: 80, long: 320 }, two_handed: true }, description: 'A simple ranged weapon requiring arrows.' },
  // armorClassBase is set on ALL FIVE rows below (not just Shield) —
  // computeArmorClass (services/armorClass.ts) reads armor_class_base
  // unconditionally, so light/medium armor needs a real numeric base too,
  // not just the legacy display-only armorClassFormula string.
  { slug: 'leather-armor', name: 'Leather Armor', itemType: 'armor', rarity: 'mundane', weightLb: 10, costCp: 1000, armorClassBase: 11, armorClassFormula: '11 + Dex modifier', armorCategory: 'light', dexModifierRule: 'full', description: 'The breastplate and shoulder protectors of this armor are made of leather that has been stiffened by being boiled in oil.' },
  { slug: 'studded-leather-armor', name: 'Studded Leather Armor', itemType: 'armor', rarity: 'mundane', weightLb: 13, costCp: 4500, armorClassBase: 12, armorClassFormula: '12 + Dex modifier', armorCategory: 'light', dexModifierRule: 'full', description: 'Made from tough but flexible leather, studded leather is reinforced with close-set rivets or spikes.' },
  { slug: 'scale-mail', name: 'Scale Mail', itemType: 'armor', rarity: 'mundane', weightLb: 45, costCp: 5000, armorClassBase: 14, armorClassFormula: '14 + Dex modifier (max 2)', armorCategory: 'medium', dexModifierRule: 'max_2', stealthDisadvantage: true, description: 'This armor consists of a coat and leggings of leather covered with overlapping pieces of metal, much like the scales of a fish.' },
  { slug: 'chain-mail', name: 'Chain Mail', itemType: 'armor', rarity: 'mundane', weightLb: 55, costCp: 7500, armorClassBase: 16, armorCategory: 'heavy', dexModifierRule: 'none', strRequirement: 13, stealthDisadvantage: true, description: 'Made of interlocking metal rings, chain mail includes a layer of quilted fabric worn underneath to prevent chafing and to cushion the impact of blows.' },
  { slug: 'shield', name: 'Shield', itemType: 'shield', rarity: 'mundane', weightLb: 6, costCp: 1000, armorClassBase: 2, armorClassFormula: '+2 AC', description: 'A shield is made from wood or metal and is carried in one hand. Wielding a shield increases your Armor Class by 2.' },
  { slug: 'backpack', name: 'Backpack', itemType: 'adventuring_gear', rarity: 'mundane', weightLb: 5, costCp: 200, description: 'A sturdy pack for carrying gear, holding up to 1 cubic foot/30 pounds of gear.' },
  { slug: 'bedroll', name: 'Bedroll', itemType: 'adventuring_gear', rarity: 'mundane', weightLb: 7, costCp: 100, description: 'A simple bedroll for sleeping outdoors.' },
  { slug: 'rope-hempen-50-feet', name: 'Rope, Hempen (50 feet)', itemType: 'adventuring_gear', rarity: 'mundane', weightLb: 10, costCp: 100, description: 'Rope has 2 hit points and can be burst with a DC 17 Strength check.' },
  { slug: 'torch', name: 'Torch', itemType: 'adventuring_gear', rarity: 'mundane', weightLb: 1, costCp: 1, description: 'A torch burns for 1 hour, providing bright light in a 20-foot radius and dim light for an additional 20 feet.' },
  { slug: 'rations-1-day', name: 'Rations (1 day)', itemType: 'adventuring_gear', rarity: 'mundane', weightLb: 2, costCp: 50, description: 'Dry foodstuffs sufficient to sustain a creature for one day.' },
  { slug: 'potion-of-healing', name: 'Potion of Healing', itemType: 'consumable', rarity: 'common', weightLb: 0.5, costCp: 5000, properties: { heal_dice: '2d4+2' }, description: 'A character who drinks the magical red fluid in this vial regains 2d4 + 2 hit points. Drinking or administering a potion takes an action.' },
  { slug: 'ring-of-protection', name: 'Ring of Protection', itemType: 'magic_item', rarity: 'rare', weightLb: 0, requiresAttunement: true, properties: { bonus_ac: 1, bonus_saving_throws: 1 }, description: 'You gain a +1 bonus to AC and saving throws while wearing this ring.' },
];

async function seedItems(client: Client, damageTypeMap: Map<string, number>): Promise<Map<string, number>> {
  const itemMap = new Map<string, number>();
  for (const i of ITEMS) {
    const damageTypeId = i.damageType ? damageTypeMap.get(i.damageType) ?? null : null;
    const res = await client.query(
      `INSERT INTO items
         (slug, name, edition_scope, item_type, rarity, weight_lb, cost_cp, armor_class_base, armor_class_formula,
          damage_dice, damage_type_id, requires_attunement, properties, description, source,
          armor_category, dex_modifier_rule, str_requirement, stealth_disadvantage)
       VALUES ($1,$2,'both',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (slug, edition_scope) DO UPDATE SET
         name = EXCLUDED.name, item_type = EXCLUDED.item_type, rarity = EXCLUDED.rarity,
         weight_lb = EXCLUDED.weight_lb, cost_cp = EXCLUDED.cost_cp, armor_class_base = EXCLUDED.armor_class_base,
         armor_class_formula = EXCLUDED.armor_class_formula, damage_dice = EXCLUDED.damage_dice,
         damage_type_id = EXCLUDED.damage_type_id, requires_attunement = EXCLUDED.requires_attunement,
         properties = EXCLUDED.properties, description = EXCLUDED.description, source = EXCLUDED.source,
         armor_category = EXCLUDED.armor_category, dex_modifier_rule = EXCLUDED.dex_modifier_rule,
         str_requirement = EXCLUDED.str_requirement, stealth_disadvantage = EXCLUDED.stealth_disadvantage
       RETURNING id`,
      [
        i.slug, i.name, i.itemType, i.rarity, i.weightLb ?? null, i.costCp ?? null,
        i.armorClassBase ?? null, i.armorClassFormula ?? null, i.damageDice ?? null, damageTypeId,
        i.requiresAttunement ?? false, i.properties ? JSON.stringify(i.properties) : null, i.description,
        'SRD 5.1/5.2 (edition-invariant equipment)',
        i.armorCategory ?? null, i.dexModifierRule ?? null, i.strRequirement ?? null, i.stealthDisadvantage ?? false,
      ],
    );
    itemMap.set(i.slug, res.rows[0].id);
  }
  console.log(`  items: ${itemMap.size}`);
  return itemMap;
}

// SRD-validation amendment (PLAN.md §3.4 item 1): real 5e multiclass ability
// prerequisites, identical across both editions (the 2024 PHB's own
// "Multiclassing" section — see the dnd5e-srd skill's
// references/2024/character-creation.md — still requires 13+ in the
// relevant class(es)' primary ability/abilities).
//
// `requirement_group`: rows sharing the same group are OR'd (any one
// satisfies that group); a class's distinct groups are AND'd (every group
// needs at least one satisfied row). Every SRD class prerequisite is a plain
// AND across single-ability groups *except* Fighter, whose real rule is
// "Strength 13 OR Dexterity 13" — those two rows share group 0 instead of
// getting one each. Found and fixed per the Phase 2 SRD-validation review
// (previously stored as STR-only, wrongly blocking valid DEX-based Fighters
// from multiclassing).
const MULTICLASS_PREREQS: Record<string, Array<{ ability: string; minimum: number; group: number }>> = {
  barbarian: [{ ability: 'str', minimum: 13, group: 0 }],
  bard: [{ ability: 'cha', minimum: 13, group: 0 }],
  cleric: [{ ability: 'wis', minimum: 13, group: 0 }],
  druid: [{ ability: 'wis', minimum: 13, group: 0 }],
  fighter: [
    { ability: 'str', minimum: 13, group: 0 }, // STR 13 OR DEX 13 (same group)
    { ability: 'dex', minimum: 13, group: 0 },
  ],
  monk: [{ ability: 'dex', minimum: 13, group: 0 }, { ability: 'wis', minimum: 13, group: 1 }],
  paladin: [{ ability: 'str', minimum: 13, group: 0 }, { ability: 'cha', minimum: 13, group: 1 }],
  ranger: [{ ability: 'dex', minimum: 13, group: 0 }, { ability: 'wis', minimum: 13, group: 1 }],
  rogue: [{ ability: 'dex', minimum: 13, group: 0 }],
  sorcerer: [{ ability: 'cha', minimum: 13, group: 0 }],
  warlock: [{ ability: 'cha', minimum: 13, group: 0 }],
  wizard: [{ ability: 'int', minimum: 13, group: 0 }],
};

async function seedClassMulticlassPrerequisites(
  client: Client,
  abilityMap: Map<string, number>,
  classMap: Map<string, number>,
): Promise<void> {
  let count = 0;
  for (const edition of EDITIONS) {
    for (const [classIndex, prereqs] of Object.entries(MULTICLASS_PREREQS)) {
      const classId = classMap.get(`${edition}:${classIndex}`);
      if (!classId) throw new Error(`Unknown class '${classIndex}' (${edition}) for multiclass prerequisite`);
      for (const p of prereqs) {
        const abilityId = abilityMap.get(p.ability);
        if (!abilityId) throw new Error(`Unknown ability '${p.ability}' for multiclass prerequisite (${classIndex})`);
        await client.query(
          `INSERT INTO class_multiclass_prerequisites (class_id, ability_score_id, minimum_score, requirement_group)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (class_id, ability_score_id) DO UPDATE SET minimum_score = EXCLUDED.minimum_score, requirement_group = EXCLUDED.requirement_group`,
          [classId, abilityId, p.minimum, p.group],
        );
        count++;
      }
    }
  }
  console.log(`  class_multiclass_prerequisites: ${count}`);
}

// SRD-validation amendment (PLAN.md §3.4 item 2): the standard 5e multiclass
// spell slot table — identical to a single full caster's own progression.
// Indexes by COMBINED caster level: full casters count their class level
// 1:1, half-casters (Paladin/Ranger) count level÷2 rounded down,
// third-casters (Eldritch Knight/Arcane Trickster) count level÷3 rounded
// down. Pact Magic (Warlock) is deliberately EXCLUDED from this table and
// this sum — Warlocks keep a wholly separate short-rest-recharging slot
// progression (their own `class_levels.spell_slots`), per RAW. See the demo
// seed's multiclass PC for a worked example of both pools coexisting.
const MULTICLASS_SPELL_SLOT_TABLE: Array<Record<string, number>> = [
  { 1: 2 }, { 1: 3 }, { 1: 4, 2: 2 }, { 1: 4, 2: 3 }, { 1: 4, 2: 3, 3: 2 },
  { 1: 4, 2: 3, 3: 3 }, { 1: 4, 2: 3, 3: 3, 4: 1 }, { 1: 4, 2: 3, 3: 3, 4: 2 },
  { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 }, { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 },
  { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 }, { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 },
  { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 }, { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1 },
  { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 }, { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1 },
  { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1 },
  { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 1, 7: 1, 8: 1, 9: 1 },
  { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 1, 8: 1, 9: 1 },
  { 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1 },
];

async function seedMulticlassSpellSlotTable(client: Client): Promise<void> {
  for (let level = 1; level <= 20; level++) {
    const slots = MULTICLASS_SPELL_SLOT_TABLE[level - 1];
    await client.query(
      `INSERT INTO multiclass_spell_slot_table (combined_caster_level, spell_slots)
       VALUES ($1, $2)
       ON CONFLICT (combined_caster_level) DO UPDATE SET spell_slots = EXCLUDED.spell_slots`,
      [level, JSON.stringify(slots)],
    );
  }
  console.log(`  multiclass_spell_slot_table: 20`);
}

// `effect_definitions` (PLAN.md §3.2/§3.4) — one mechanical template per SRD
// condition (linked to the matching `conditions` catalog row) plus a couple
// of spell-driven templates that aren't one of the 15 official conditions.
// Links to the 2024-edition `conditions` rows: `effect_definitions` has no
// `edition_scope` column of its own (it's meant as a shared mechanical
// catalog), and 2024 is this seed's more actively-used demo edition — see
// the demo campaign, which is `srd_edition = '2024'`.
//
// Exhaustion is the one condition that doesn't fit a duration countdown at
// all (it's a 0-6 level tracked via `stack_count`, not `duration_value`) —
// `stacking_rule = 'stack'` flags that explicitly, matching §3.4 item 4.
const CONDITION_EFFECT_DURATIONS: Record<string, { durationType: string; durationValue: number | null; stackingRule: 'none' | 'stack' | 'refresh' }> = {
  blinded: { durationType: 'until_removed', durationValue: null, stackingRule: 'refresh' },
  charmed: { durationType: 'until_removed', durationValue: null, stackingRule: 'refresh' },
  deafened: { durationType: 'until_removed', durationValue: null, stackingRule: 'refresh' },
  exhaustion: { durationType: 'special', durationValue: null, stackingRule: 'stack' },
  frightened: { durationType: 'until_removed', durationValue: null, stackingRule: 'refresh' },
  grappled: { durationType: 'until_removed', durationValue: null, stackingRule: 'refresh' },
  incapacitated: { durationType: 'until_removed', durationValue: null, stackingRule: 'none' },
  invisible: { durationType: 'until_removed', durationValue: null, stackingRule: 'refresh' },
  paralyzed: { durationType: 'until_removed', durationValue: null, stackingRule: 'none' },
  petrified: { durationType: 'until_removed', durationValue: null, stackingRule: 'none' },
  poisoned: { durationType: 'until_removed', durationValue: null, stackingRule: 'refresh' },
  prone: { durationType: 'until_removed', durationValue: null, stackingRule: 'none' },
  restrained: { durationType: 'until_removed', durationValue: null, stackingRule: 'refresh' },
  stunned: { durationType: 'until_removed', durationValue: null, stackingRule: 'none' },
  unconscious: { durationType: 'until_removed', durationValue: null, stackingRule: 'none' },
};

const SPELL_EFFECT_DEFINITIONS: Array<{
  name: string; description: string; durationType: string; durationValue: number | null;
  concentration: boolean; stackingRule: 'none' | 'stack' | 'refresh';
}> = [
  { name: 'Bless', description: 'Target adds 1d4 to attack rolls and saving throws.', durationType: 'minutes', durationValue: 1, concentration: true, stackingRule: 'refresh' },
  { name: 'Hex', description: 'Extra 1d6 necrotic damage on hit, plus disadvantage on ability checks with a chosen ability.', durationType: 'hours', durationValue: 1, concentration: true, stackingRule: 'refresh' },
];

async function seedEffectDefinitions(client: Client): Promise<void> {
  let count = 0;
  for (const [conditionIndex, cfg] of Object.entries(CONDITION_EFFECT_DURATIONS)) {
    const conditionRes = await client.query(
      `SELECT id, name FROM conditions WHERE index_key = $1 AND edition_scope = '2024'`,
      [conditionIndex],
    );
    if (conditionRes.rows.length === 0) throw new Error(`Unknown condition '${conditionIndex}' (2024) for effect_definitions`);
    const { id: conditionId, name } = conditionRes.rows[0];

    const existing = await client.query(
      `SELECT id FROM effect_definitions WHERE condition_id = $1 AND is_homebrew = false`,
      [conditionId],
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE effect_definitions SET default_duration_type = $2, stacking_rule = $3 WHERE id = $1`,
        [existing.rows[0].id, cfg.durationType, cfg.stackingRule],
      );
    } else {
      await client.query(
        `INSERT INTO effect_definitions
           (condition_id, name, description, default_duration_type, default_duration_value, concentration, stacking_rule)
         VALUES ($1, $2, $3, $4, $5, false, $6)`,
        [conditionId, name, `Mechanical template for the ${name} condition.`, cfg.durationType, cfg.durationValue, cfg.stackingRule],
      );
    }
    count++;
  }

  for (const s of SPELL_EFFECT_DEFINITIONS) {
    const existing = await client.query(
      `SELECT id FROM effect_definitions WHERE name = $1 AND condition_id IS NULL AND is_homebrew = false`,
      [s.name],
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE effect_definitions SET description = $2, default_duration_type = $3, default_duration_value = $4,
           concentration = $5, stacking_rule = $6 WHERE id = $1`,
        [existing.rows[0].id, s.description, s.durationType, s.durationValue, s.concentration, s.stackingRule],
      );
    } else {
      await client.query(
        `INSERT INTO effect_definitions
           (condition_id, name, description, default_duration_type, default_duration_value, concentration, stacking_rule)
         VALUES (NULL, $1, $2, $3, $4, $5, $6)`,
        [s.name, s.description, s.durationType, s.durationValue, s.concentration, s.stackingRule],
      );
    }
    count++;
  }

  console.log(`  effect_definitions: ${count}`);
}
