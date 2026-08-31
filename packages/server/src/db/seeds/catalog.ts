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

// docs/roadmap/dnd-2024-gap-analysis.md P1-3 (SB-01/SB-02) — the third-party
// community dataset this seed otherwise reads verbatim (`.opencode/skills/
// dnd5e-srd/data/`) is missing Aasimar as a species entirely, and its 2024
// Dragonborn entry lists only 2 of the 5 traits the official 2024 PHB text
// names. Both gaps are fixed here by hand-authoring the missing content
// directly from this repo's OWN authoritative source — `docs/players-
// handbook-2024/Chapter 4- Character Origins/chapter4-characterOrigins.md`
// (lines 465-550 for Aasimar/Dragonborn) — rather than editing the
// third-party JSON file itself, which would blur its provenance as a
// verifiable copy of that dataset. This is a deliberate, narrow exception
// to the "seed data comes from the SRD JSON" rule for exactly these two
// gaps; it does not resolve Open Question 1 (catalog provenance) more
// broadly.
//
// 2024-only: Aasimar isn't a core species in the 2014 PHB's race list
// either (it was a later supplement, not core SRD), so no 2014 entry exists
// or is expected — matches this project's "2014 isn't independently
// re-verified" convention (dnd-2024-gap-analysis.md "Not doing / out of
// scope").
const DRAGONBORN_2024_TRAIT_SUPPLEMENT = [
  { name: 'Draconic Ancestry', index: 'draconic-ancestry' },
  { name: 'Breath Weapon', index: 'breath-weapon' },
  { name: 'Damage Resistance', index: 'damage-resistance' },
];

const AASIMAR_2024_SPECIES = {
  index: 'aasimar',
  name: 'Aasimar',
  speedFt: 30,
  size: 'Medium or Small',
  traits: [
    { name: 'Celestial Resistance', index: 'celestial-resistance' },
    { name: 'Darkvision (60 ft.)', index: 'darkvision-60' },
    { name: 'Healing Hands', index: 'healing-hands' },
    { name: 'Light Bearer', index: 'light-bearer' },
    { name: 'Celestial Revelation', index: 'celestial-revelation' },
  ],
};

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
  await seedWeaponMasteryCounts(client, classMap);
  await seedClassFeatures(client, classMap, subclassMap);
  const featMap = await seedFeats(client);
  await seedBackgrounds(client, skillMap, featMap);

  // ---- Phase 2 additions ----
  await seedConditions(client);
  const { schoolMap, damageTypeMap } = await seedMagicSchoolsAndDamageTypes(client);
  await seedSpells(client, schoolMap, abilityMap, classMap);
  await seedWeaponMasteryProperties(client);
  await seedItems(client, damageTypeMap);
  await seedClassMulticlassPrerequisites(client, abilityMap, classMap);
  await seedMulticlassSpellSlotTable(client);
  await seedEffectDefinitions(client);
  await seedBastionFacilityCatalog(client);

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
      // P1-3/SB-02 — the third-party JSON's 2024 Dragonborn entry is missing
      // 3 of its 5 official traits (see DRAGONBORN_2024_TRAIT_SUPPLEMENT's
      // comment); merge them in here rather than trusting the source file
      // alone for this one row.
      const traits =
        edition === '2024' && r.index === 'dragonborn'
          ? [...traitsOf(r), ...DRAGONBORN_2024_TRAIT_SUPPLEMENT]
          : traitsOf(r);
      const res = await client.query(
        `INSERT INTO races (index_key, name, edition_scope, speed, size, ability_bonuses, traits, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (index_key, edition_scope) DO UPDATE SET
           name = EXCLUDED.name, speed = EXCLUDED.speed, size = EXCLUDED.size,
           ability_bonuses = EXCLUDED.ability_bonuses, traits = EXCLUDED.traits
         RETURNING id`,
        [
          r.index, r.name, edition, metersToFeet(r.speed), sizeOf(r),
          JSON.stringify(abilityBonusesOf(r)), JSON.stringify(traits),
          edition === '2014' ? 'SRD 5.1 (2014 rules)' : 'SRD 5.2 (2024 rules)',
        ],
      );
      raceMap.set(`${edition}:${r.index}`, res.rows[0].id);
      raceCount++;
    }
  }

  // P1-3/SB-01 — Aasimar, entirely absent from the third-party dataset (see
  // AASIMAR_2024_SPECIES's comment); same upsert statement as the loop
  // above, so a reseed stays idempotent, just fed hand-authored PHB data
  // instead of a JSON row.
  {
    const a = AASIMAR_2024_SPECIES;
    const res = await client.query(
      `INSERT INTO races (index_key, name, edition_scope, speed, size, ability_bonuses, traits, source)
       VALUES ($1, $2, '2024', $3, $4, $5, $6, $7)
       ON CONFLICT (index_key, edition_scope) DO UPDATE SET
         name = EXCLUDED.name, speed = EXCLUDED.speed, size = EXCLUDED.size,
         ability_bonuses = EXCLUDED.ability_bonuses, traits = EXCLUDED.traits
       RETURNING id`,
      [a.index, a.name, a.speedFt, a.size, JSON.stringify([]), JSON.stringify(a.traits), 'PHB 2024 (hand-authored, not in the SRD JSON dataset)'],
    );
    raceMap.set(`2024:${a.index}`, res.rows[0].id);
    raceCount++;
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

// docs/roadmap/dnd-2024-gap-analysis.md P1-5 (CS-01, Open Question 1) — the
// third-party SRD JSON dataset has exactly 1 subclass per class for ALL 12
// classes (confirmed by direct inspection of 5e-SRD-Subclasses.json — this
// isn't a seeding gap, the source data itself stops at 1 per class), against
// an official 4-per-class structure. Scoped, per the user's explicit
// decision (docs/roadmap/progress.md), to ONLY the 6 classes this repo can
// actually verify against a real source — Barbarian/Bard/Cleric/Druid/
// Fighter/Monk, whose full class+subclass text exists in docs/players-
// handbook-2024/Chapter 3- Character Classes/chapter3-characterClasses.md
// (confirmed by reading the file end-to-end: it ends immediately after
// Monk's content, with no "continued" file anywhere in this repo). The
// other 6 classes (Paladin/Ranger/Rogue/Sorcerer/Warlock/Wizard) have ZERO
// source text in this project at all and are deliberately left at their
// existing 1 subclass each — completing them would mean either accepting
// unverified content or authoring from memory with no citable source,
// both explicitly rejected.
//
// Each of these 6 classes' third-party-JSON subclass (Berserker, Lore,
// Life, Land, Champion, Open Hand) is already one of the PHB's 4 canonical
// options and is left untouched; only the 3 MISSING canonical subclasses
// per class are hand-authored here, from the PHB text above. Same meters
// convention as P1-3/P1-4 (5 ft = 1.5 m, 10 ft = 3 m, etc.) and the same
// "You gain the following benefits." / `**Name.**` paragraph format.
interface SupplementalSubclassFeature {
  level: number;
  name: string;
  description: string;
}

interface SupplementalSubclass {
  classIndex: string;
  index: string;
  name: string;
  features: SupplementalSubclassFeature[];
}

const SUPPLEMENTAL_2024_SUBCLASSES: SupplementalSubclass[] = [
  // ================= Barbarian (has Path of the Berserker) =================
  {
    classIndex: 'barbarian', index: 'path-of-the-wild-heart', name: 'Path of the Wild Heart',
    features: [
      {
        level: 3, name: 'Animal Speaker',
        description: 'You can cast the Beast Sense and Speak with Animals spells but only as Rituals. Wisdom is your spellcasting ability for them.',
      },
      {
        level: 3, name: 'Rage of the Wilds',
        description:
          'Your Rage taps into the primal power of animals. Whenever you activate your Rage, you gain one of the following options of your choice.\n\n' +
          '**Bear.** While your Rage is active, you have Resistance to every damage type except Force, Necrotic, Psychic, and Radiant.\n\n' +
          '**Eagle.** When you activate your Rage, you can take the Disengage and Dash actions as part of that Bonus Action. While your Rage is active, you can take a Bonus Action to take both of those actions.\n\n' +
          '**Wolf.** While your Rage is active, your allies have Advantage on attack rolls against any enemy of yours within 1.5 m of you.',
      },
      {
        level: 6, name: 'Aspect of the Wilds',
        description:
          'You gain one of the following options of your choice. Whenever you finish a Long Rest, you can change your choice.\n\n' +
          '**Owl.** You have Darkvision with a range of 18 m. If you already have Darkvision, its range increases by 18 m.\n\n' +
          '**Panther.** You have a Climb Speed equal to your Speed.\n\n' +
          '**Salmon.** You have a Swim Speed equal to your Speed.',
      },
      {
        level: 10, name: 'Nature Speaker',
        description: 'You can cast the Commune with Nature spell but only as a Ritual. Wisdom is your spellcasting ability for it.',
      },
      {
        level: 14, name: 'Power of the Wilds',
        description:
          'Whenever you activate your Rage, you gain one of the following options of your choice.\n\n' +
          "**Falcon.** While your Rage is active, you have a Fly Speed equal to your Speed if you aren't wearing any armor.\n\n" +
          '**Lion.** While your Rage is active, any of your enemies within 1.5 m of you have Disadvantage on attack rolls against targets other than you or another Barbarian who has this option active.\n\n' +
          '**Ram.** While your Rage is active, you can cause a Large or smaller creature to have the Prone condition when you hit it with a melee attack.',
      },
    ],
  },
  {
    classIndex: 'barbarian', index: 'path-of-the-world-tree', name: 'Path of the World Tree',
    features: [
      {
        level: 3, name: 'Vitality of the Tree',
        description:
          'Your Rage taps into the life force of the World Tree. You gain the following benefits.\n\n' +
          '**Vitality Surge.** When you activate your Rage, you gain a number of Temporary Hit Points equal to your Barbarian level.\n\n' +
          '**Life-Giving Force.** At the start of each of your turns while your Rage is active, you can choose another creature within 3 m of yourself to gain Temporary Hit Points. To determine the number of Temporary Hit Points, roll a number of d6s equal to your Rage Damage bonus, and add them together. If any of these Temporary Hit Points remain when your Rage ends, they vanish.',
      },
      {
        level: 6, name: 'Branches of the Tree',
        description:
          'Whenever a creature you can see starts its turn within 9 m of you while your Rage is active, you can take a Reaction to summon spectral branches of the World Tree around it. The target must succeed on a Strength saving throw (DC 8 plus your Strength modifier and Proficiency Bonus) or be teleported to an unoccupied space you can see within 1.5 m of yourself or in the nearest unoccupied space you can see. After the target teleports, you can reduce its Speed to 0 until the end of the current turn.',
      },
      {
        level: 10, name: 'Battering Roots',
        description:
          'During your turn, your reach is 3 m greater with any Melee weapon that has the Heavy or Versatile property, as tendrils of the World Tree extend from you. When you hit with such a weapon on your turn, you can activate the Push or Topple mastery property in addition to a different mastery property you’re using with that weapon.',
      },
      {
        level: 14, name: 'Travel along the Tree',
        description:
          'When you activate your Rage and as a Bonus Action while your Rage is active, you can teleport up to 18 m to an unoccupied space you can see.\n\n' +
          'In addition, once per Rage, you can increase the range of that teleport to 45 m. When you do so, you can also bring up to six willing creatures who are within 3 m of you. Each creature teleports to an unoccupied space of your choice within 3 m of your destination space.',
      },
    ],
  },
  {
    classIndex: 'barbarian', index: 'path-of-the-zealot', name: 'Path of the Zealot',
    features: [
      {
        level: 3, name: 'Divine Fury',
        description:
          'You can channel divine power into your strikes. On each of your turns while your Rage is active, the first creature you hit with a weapon or an Unarmed Strike takes extra damage equal to 1d6 plus half your Barbarian level (round down). The extra damage is Necrotic or Radiant; you choose the type each time you deal the damage.',
      },
      {
        level: 3, name: 'Warrior of the Gods',
        description:
          'A divine entity helps ensure you can continue the fight. You have a pool of four d12s that you can spend to heal yourself. As a Bonus Action, you can expend dice from the pool, roll them, and regain a number of Hit Points equal to the roll’s total.\n\n' +
          'Your pool regains all expended dice when you finish a Long Rest.\n\n' +
          'The pool’s maximum number of dice increases by one when you reach Barbarian levels 6 (5 dice), 12 (6 dice), and 17 (7 dice).',
      },
      {
        level: 6, name: 'Fanatical Focus',
        description:
          'Once per active Rage, if you fail a saving throw, you can reroll it with a bonus equal to your Rage Damage bonus, and you must use the new roll.',
      },
      {
        level: 10, name: 'Zealous Presence',
        description:
          'As a Bonus Action, you unleash a battle cry infused with divine energy. Up to ten other creatures of your choice within 18 m of you gain Advantage on attack rolls and saving throws until the start of your next turn.\n\n' +
          "Once you use this feature, you can't use it again until you finish a Long Rest unless you expend a use of your Rage (no action required) to restore your use of it.",
      },
      {
        level: 14, name: 'Rage of the Gods',
        description:
          "When you activate your Rage, you can assume the form of a divine warrior. This form lasts for 1 minute or until you drop to 0 Hit Points. Once you use this feature, you can't do so again until you finish a Long Rest.\n\n" +
          'While in this form, you gain the benefits below.\n\n' +
          '**Flight.** You have a Fly Speed equal to your Speed and can hover.\n\n' +
          '**Resistance.** You have Resistance to Necrotic, Psychic, and Radiant damage.\n\n' +
          '**Revivification.** When a creature within 9 m of you would drop to 0 Hit Points, you can take a Reaction to expend a use of your Rage to instead change the target’s Hit Points to a number equal to your Barbarian level.',
      },
    ],
  },

  // ================= Bard (has College of Lore) =================
  {
    classIndex: 'bard', index: 'college-of-dance', name: 'College of Dance',
    features: [
      {
        level: 3, name: 'Dazzling Footwork',
        description:
          "While you aren't wearing armor or wielding a Shield, you gain the following benefits.\n\n" +
          '**Dance Virtuoso.** You have Advantage on any Charisma (Performance) check you make that involves you dancing.\n\n' +
          '**Unarmored Defense.** Your base Armor Class equals 10 plus your Dexterity and Charisma modifiers.\n\n' +
          '**Agile Strikes.** When you expend a use of your Bardic Inspiration as part of an action, a Bonus Action, or a Reaction, you can make one Unarmed Strike as part of that action, Bonus Action, or Reaction.\n\n' +
          "**Bardic Damage.** You can use Dexterity instead of Strength for the attack rolls of your Unarmed Strikes. When you deal damage with an Unarmed Strike, you can deal Bludgeoning damage equal to a roll of your Bardic Inspiration die plus your Dexterity modifier, instead of the strike's normal damage. This roll doesn't expend the die.",
      },
      {
        level: 6, name: 'Inspiring Movement',
        description:
          'When an enemy you can see ends its turn within 1.5 m of you, you can take a Reaction and expend one use of your Bardic Inspiration to move up to half your Speed. Then one ally of your choice within 9 m of you can also move up to half their Speed using their Reaction.\n\n' +
          "None of this feature's movement provokes Opportunity Attacks.",
      },
      {
        level: 6, name: 'Tandem Footwork',
        description:
          "When you roll Initiative, you can expend one use of your Bardic Inspiration if you don't have the Incapacitated condition. When you do so, roll your Bardic Inspiration die; you and each ally within 9 m of you who can see or hear you gains a bonus to Initiative equal to the number rolled.",
      },
      {
        level: 14, name: 'Leading Evasion',
        description:
          'When you are subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw and only half damage if you fail. If any creatures within 1.5 m of you are making the same Dexterity saving throw, you can share this benefit with them for that save.\n\n' +
          "You can't use this feature if you have the Incapacitated condition.",
      },
    ],
  },
  {
    classIndex: 'bard', index: 'college-of-glamour', name: 'College of Glamour',
    features: [
      {
        level: 3, name: 'Beguiling Magic',
        description:
          'You always have the Charm Person and Mirror Image spells prepared.\n\n' +
          'In addition, immediately after you cast an Enchantment or Illusion spell using a spell slot, you can cause a creature you can see within 18 m of yourself to make a Wisdom saving throw against your spell save DC. On a failed save, the target has the Charmed or Frightened condition (your choice) for 1 minute. The target repeats the save at the end of each of its turns, ending the effect on itself on a success.\n\n' +
          "Once you use this benefit, you can't use it again until you finish a Long Rest. You can also restore your use of it by expending one use of your Bardic Inspiration (no action required).",
      },
      {
        level: 3, name: 'Mantle of Inspiration',
        description:
          'You can weave fey magic into a song or dance to fill others with vigor. As a Bonus Action, you can expend a use of Bardic Inspiration, rolling a Bardic Inspiration die. When you do so, choose a number of other creatures within 18 m of yourself, up to a number equal to your Charisma modifier (minimum of one creature). Each of those creatures gains a number of Temporary Hit Points equal to two times the number rolled on the Bardic Inspiration die, and then each can use its Reaction to move up to its Speed without provoking Opportunity Attacks.',
      },
      {
        level: 6, name: 'Mantle of Majesty',
        description:
          'You always have the Command spell prepared.\n\n' +
          "As a Bonus Action, you cast Command without expending a spell slot, and you take on an unearthly appearance for 1 minute or until your Concentration ends. During this time, you can cast Command as a Bonus Action without expending a spell slot.\n\n" +
          'Any creature Charmed by you automatically fails its saving throw against the Command you cast with this feature.\n\n' +
          "Once you use this feature, you can't use it again until you finish a Long Rest. You can also restore your use of it by expending a level 3+ spell slot (no action required).",
      },
      {
        level: 14, name: 'Unbreakable Majesty',
        description:
          'As a Bonus Action, you can assume a magically majestic presence for 1 minute or until you have the Incapacitated condition. For the duration, whenever any creature hits you with an attack roll for the first time on a turn, the attacker must succeed on a Charisma saving throw against your spell save DC, or the attack misses instead, as the creature recoils from your majesty.\n\n' +
          "Once you assume this majestic presence, you can't do so again until you finish a Short or Long Rest.",
      },
    ],
  },
  {
    classIndex: 'bard', index: 'college-of-valor', name: 'College of Valor',
    features: [
      {
        level: 3, name: 'Combat Inspiration',
        description:
          'You can use your wit to turn the tide of battle. A creature that has a Bardic Inspiration die from you can use it for one of the following effects.\n\n' +
          '**Defense.** When the creature is hit by an attack roll, that creature can use its Reaction to roll the Bardic Inspiration die and add the number rolled to its AC against that attack, potentially causing the attack to miss.\n\n' +
          '**Offense.** Immediately after the creature hits a target with an attack roll, the creature can roll the Bardic Inspiration die and add the number rolled to the attack’s damage against the target.',
      },
      {
        level: 3, name: 'Martial Training',
        description:
          'You gain proficiency with Martial weapons and training with Medium armor and Shields.\n\n' +
          'In addition, you can use a Simple or Martial weapon as a Spellcasting Focus to cast spells from your Bard spell list.',
      },
      {
        level: 6, name: 'Extra Attack',
        description:
          'You can attack twice instead of once whenever you take the Attack action on your turn.\n\n' +
          'In addition, you can cast one of your cantrips that has a casting time of an action in place of one of those attacks.',
      },
      {
        level: 14, name: 'Battle Magic',
        description: 'After you cast a spell that has a casting time of an action, you can make one attack with a weapon as a Bonus Action.',
      },
    ],
  },

  // ================= Cleric (has Life Domain) =================
  {
    classIndex: 'cleric', index: 'light-domain', name: 'Light Domain',
    features: [
      {
        level: 3, name: 'Light Domain Spells',
        description:
          'Your connection to this divine domain ensures you always have certain spells ready, once you reach the needed Cleric level: level 3 — Burning Hands, Faerie Fire, Scorching Ray, See Invisibility; level 5 — Daylight, Fireball; level 7 — Arcane Eye, Wall of Fire; level 9 — Flame Strike, Scrying.',
      },
      {
        level: 3, name: 'Radiance of the Dawn',
        description:
          'As a Magic action, you present your Holy Symbol and expend a use of your Channel Divinity to emit a flash of light in a 9 m Emanation originating from yourself. Any magical Darkness—such as that created by the Darkness spell—in that area is dispelled. Additionally, each creature of your choice in that area must make a Constitution saving throw, taking Radiant damage equal to 2d10 plus your Cleric level on a failed save or half as much damage on a successful one.',
      },
      {
        level: 3, name: 'Warding Flare',
        description:
          'When a creature that you can see within 9 m of yourself makes an attack roll, you can take a Reaction to impose Disadvantage on the attack roll, causing light to flare before it hits or misses.\n\n' +
          'You can use this feature a number of times equal to your Wisdom modifier (minimum of once). You regain all expended uses when you finish a Long Rest.',
      },
      {
        level: 6, name: 'Improved Warding Flare',
        description:
          'You regain all expended uses of your Warding Flare when you finish a Short or Long Rest.\n\n' +
          'In addition, whenever you use Warding Flare, you can give the target of the triggering attack a number of Temporary Hit Points equal to 2d6 plus your Wisdom modifier.',
      },
      {
        level: 17, name: 'Corona of Light',
        description:
          'As a Magic action, you cause yourself to emit an aura of sunlight that lasts for 1 minute or until you dismiss it (no action required). You emit Bright Light in an 18 m radius and Dim Light for an additional 9 m. Your enemies in the Bright Light have Disadvantage on saving throws against your Radiance of the Dawn and any spell that deals Fire or Radiant damage.\n\n' +
          'You can use this feature a number of times equal to your Wisdom modifier (minimum of once), and you regain all expended uses when you finish a Long Rest.',
      },
    ],
  },
  {
    classIndex: 'cleric', index: 'trickery-domain', name: 'Trickery Domain',
    features: [
      {
        level: 3, name: 'Blessing of the Trickster',
        description:
          'As a Magic action, you can choose yourself or a willing creature within 9 m of yourself to have Advantage on Dexterity (Stealth) checks. This blessing lasts until you finish a Long Rest or you use this feature again.',
      },
      {
        level: 3, name: 'Trickery Domain Spells',
        description:
          'Your connection to this divine domain ensures you always have certain spells ready, once you reach the needed Cleric level: level 3 — Charm Person, Disguise Self, Invisibility, Pass without Trace; level 5 — Hypnotic Pattern, Nondetection; level 7 — Confusion, Dimension Door; level 9 — Dominate Person, Modify Memory.',
      },
      {
        level: 3, name: 'Invoke Duplicity',
        description:
          "As a Bonus Action, you can expend one use of your Channel Divinity to create a perfect visual illusion of yourself in an unoccupied space you can see within 9 m of yourself. The illusion is intangible and doesn't occupy its space. It lasts for 1 minute, but it ends early if you dismiss it (no action required) or have the Incapacitated condition. The illusion is animated and mimics your expressions and gestures. While it persists, you gain the following benefits.\n\n" +
          '**Cast Spells.** You can cast spells as though you were in the illusion’s space, but you must use your own senses.\n\n' +
          '**Distract.** When both you and your illusion are within 1.5 m of a creature that can see the illusion, you have Advantage on attack rolls against that creature, given how distracting the illusion is to the target.\n\n' +
          '**Move.** As a Bonus Action, you can move the illusion up to 9 m to an unoccupied space you can see that is within 36 m of yourself.',
      },
      {
        level: 6, name: 'Trickster’s Transposition',
        description:
          'Whenever you take the Bonus Action to create or move the illusion of your Invoke Duplicity, you can teleport, swapping places with the illusion.',
      },
      {
        level: 17, name: 'Improved Duplicity',
        description:
          'The illusion of your Invoke Duplicity has grown more powerful in the following ways.\n\n' +
          '**Shared Distraction.** When you and your allies make attack rolls against a creature within 1.5 m of the illusion, the attack rolls have Advantage.\n\n' +
          '**Healing Illusion.** When the illusion ends, you or a creature of your choice within 1.5 m of it regains a number of Hit Points equal to your Cleric level.',
      },
    ],
  },
  {
    classIndex: 'cleric', index: 'war-domain', name: 'War Domain',
    features: [
      {
        level: 3, name: 'Guided Strike',
        description:
          'When you or a creature within 9 m of you misses with an attack roll, you can expend one use of your Channel Divinity and give that roll a +10 bonus, potentially causing it to hit. When you use this feature to benefit another creature’s attack roll, you must take a Reaction to do so.',
      },
      {
        level: 3, name: 'War Domain Spells',
        description:
          'Your connection to this divine domain ensures you always have certain spells ready, once you reach the needed Cleric level: level 3 — Guiding Bolt, Magic Weapon, Shield of Faith, Spiritual Weapon; level 5 — Crusader’s Mantle, Spirit Guardians; level 7 — Fire Shield, Freedom of Movement; level 9 — Hold Monster, Steel Wind Strike.',
      },
      {
        level: 3, name: 'War Priest',
        description:
          'As a Bonus Action, you can make one attack with a weapon or an Unarmed Strike. You can use this Bonus Action a number of times equal to your Wisdom modifier (minimum of once). You regain all expended uses when you finish a Short or Long Rest.',
      },
      {
        level: 6, name: 'War God’s Blessing',
        description:
          "You can expend a use of your Channel Divinity to cast Shield of Faith or Spiritual Weapon rather than expending a spell slot. When you cast either spell in this way, the spell doesn't require Concentration. Instead the spell lasts for 1 minute, but it ends early if you cast that spell again, have the Incapacitated condition, or die.",
      },
      {
        level: 17, name: 'Avatar of Battle',
        description: 'You gain Resistance to Bludgeoning, Piercing, and Slashing damage.',
      },
    ],
  },

  // ================= Druid (has Circle of the Land) =================
  {
    classIndex: 'druid', index: 'circle-of-the-moon', name: 'Circle of the Moon',
    features: [
      {
        level: 3, name: 'Circle Forms',
        description:
          'You can channel lunar magic when you assume a Wild Shape form, granting you the benefits below.\n\n' +
          '**Challenge Rating.** The maximum Challenge Rating for the form equals your Druid level divided by 3 (round down).\n\n' +
          '**Armor Class.** Until you leave the form, your AC equals 13 plus your Wisdom modifier if that total is higher than the Beast’s AC.\n\n' +
          '**Temporary Hit Points.** You gain a number of Temporary Hit Points equal to three times your Druid level.',
      },
      {
        level: 3, name: 'Circle of the Moon Spells',
        description:
          'When you reach a Druid level specified here, you thereafter always have the listed spells prepared: level 3 — Cure Wounds, Moonbeam, Starry Wisp; level 5 — Conjure Animals; level 7 — Fount of Moonlight; level 9 — Mass Cure Wounds.\n\n' +
          'In addition, you can cast the spells from this feature while you’re in a Wild Shape form.',
      },
      {
        level: 6, name: 'Improved Circle Forms',
        description:
          'While in a Wild Shape form, you gain the following benefits.\n\n' +
          '**Lunar Radiance.** Each of your attacks in a Wild Shape form can deal its normal damage type or Radiant damage. You make this choice each time you hit with those attacks.\n\n' +
          '**Increased Toughness.** You can add your Wisdom modifier to your Constitution saving throws.',
      },
      {
        level: 10, name: 'Moonlight Step',
        description:
          'You magically transport yourself, reappearing amid a burst of moonlight. As a Bonus Action, you teleport up to 9 m to an unoccupied space you can see, and you have Advantage on the next attack roll you make before the end of this turn.\n\n' +
          'You can use this feature a number of times equal to your Wisdom modifier (minimum of once), and you regain all expended uses when you finish a Long Rest. You can also regain uses by expending a level 2+ spell slot for each use you want to restore (no action required).',
      },
      {
        level: 14, name: 'Lunar Form',
        description:
          'The power of the moon suffuses you, granting you the following benefits.\n\n' +
          '**Improved Lunar Radiance.** Once per turn, you can deal an extra 2d10 Radiant damage to a target you hit with a Wild Shape form’s attack.\n\n' +
          '**Shared Moonlight.** Whenever you use Moonlight Step, you can also teleport one willing creature. That creature must be within 3 m of you, and you teleport it to an unoccupied space you can see within 3 m of your destination space.',
      },
    ],
  },
  {
    classIndex: 'druid', index: 'circle-of-the-sea', name: 'Circle of the Sea',
    features: [
      {
        level: 3, name: 'Circle of the Sea Spells',
        description:
          'When you reach a Druid level specified here, you thereafter always have the listed spells prepared: level 3 — Fog Cloud, Gust of Wind, Ray of Frost, Shatter, Thunderwave; level 5 — Lightning Bolt, Water Breathing; level 7 — Control Water, Ice Storm; level 9 — Conjure Elemental, Hold Monster.',
      },
      {
        level: 3, name: 'Wrath of the Sea',
        description:
          'As a Bonus Action, you can expend a use of your Wild Shape to manifest a 1.5 m Emanation that takes the form of ocean spray that surrounds you for 10 minutes. It ends early if you dismiss it (no action required), manifest it again, or have the Incapacitated condition.\n\n' +
          'When you manifest the Emanation and as a Bonus Action on your subsequent turns, you can choose another creature you can see in the Emanation. The target must succeed on a Constitution saving throw against your spell save DC or take Cold damage and, if the creature is Large or smaller, be pushed up to 4.5 m away from you. To determine this damage, roll a number of d6s equal to your Wisdom modifier (minimum of one die).',
      },
      {
        level: 6, name: 'Aquatic Affinity',
        description:
          'The size of the Emanation created by your Wrath of the Sea increases to 3 m.\n\n' +
          'In addition, you gain a Swim Speed equal to your Speed.',
      },
      {
        level: 10, name: 'Stormborn',
        description:
          'Your Wrath of the Sea confers two more benefits while active, as detailed below.\n\n' +
          '**Flight.** You gain a Fly Speed equal to your Speed.\n\n' +
          '**Resistance.** You have Resistance to Cold, Lightning, and Thunder damage.',
      },
      {
        level: 14, name: 'Oceanic Gift',
        description:
          'Instead of manifesting the Emanation of Wrath of the Sea around yourself, you can manifest it around one willing creature within 18 m of yourself. That creature gains all the benefits of the Emanation and uses your spell save DC and Wisdom modifier for it.\n\n' +
          'In addition, you can manifest the Emanation around both the other creature and yourself if you expend two uses of your Wild Shape instead of one when manifesting it.',
      },
    ],
  },
  {
    classIndex: 'druid', index: 'circle-of-the-stars', name: 'Circle of the Stars',
    features: [
      {
        level: 3, name: 'Star Map',
        description:
          "You've created a star chart as part of your heavenly studies. It is a Tiny object, and you can use it as a Spellcasting Focus for your Druid spells. You determine its form by rolling on a 1d6 table (scroll, stone tablet, owlbear hide, maps bound in ebony, engraved crystal, or etched glass disk) or by choosing one.\n\n" +
          'While holding the map, you have the Guidance and Guiding Bolt spells prepared, and you can cast Guiding Bolt without expending a spell slot. You can cast it in that way a number of times equal to your Wisdom modifier (minimum of once), and you regain all expended uses when you finish a Long Rest.\n\n' +
          'If you lose the map, you can perform a 1-hour ceremony to magically create a replacement. This ceremony can be performed during a Short or Long Rest, and it destroys the previous map.',
      },
      {
        level: 3, name: 'Starry Form',
        description:
          'As a Bonus Action, you can expend a use of your Wild Shape feature to take on a starry form rather than shape-shifting.\n\n' +
          'While in your starry form, you retain your game statistics, but your body becomes luminous, and glowing lines connect your joints as on a star chart. This form sheds Bright Light in a 3 m radius and Dim Light for an additional 3 m. The form lasts for 10 minutes. It ends early if you dismiss it (no action required), have the Incapacitated condition, or use this feature again.\n\n' +
          'Whenever you assume your starry form, choose which of the following constellations glimmers on your body; your choice gives you certain benefits while in the form.\n\n' +
          '**Archer.** When you activate this form and as a Bonus Action on your subsequent turns while it lasts, you can make a ranged spell attack, hurling a luminous arrow that targets one creature within 18 m of yourself. On a hit, the attack deals Radiant damage equal to 1d8 plus your Wisdom modifier.\n\n' +
          '**Chalice.** Whenever you cast a spell using a spell slot that restores Hit Points to a creature, you or another creature within 9 m of you can regain Hit Points equal to 1d8 plus your Wisdom modifier.\n\n' +
          '**Dragon.** When you make an Intelligence or a Wisdom check or a Constitution saving throw to maintain Concentration, you can treat a roll of 9 or lower on the d20 as a 10.',
      },
      {
        level: 6, name: 'Cosmic Omen',
        description:
          'Whenever you finish a Long Rest, you can consult your Star Map for omens and roll a die. Until you finish your next Long Rest, you gain access to a special Reaction based on whether you rolled an even or an odd number on the die:\n\n' +
          '**Weal (Even).** Whenever a creature you can see within 9 m of you is about to make a D20 Test, you can take a Reaction to roll 1d6 and add the number rolled to the total.\n\n' +
          '**Woe (Odd).** Whenever a creature you can see within 9 m of you is about to make a D20 Test, you can take a Reaction to roll 1d6 and subtract the number rolled from the total.\n\n' +
          'You can use this Reaction a number of times equal to your Wisdom modifier (minimum of once), and you regain all expended uses when you finish a Long Rest.',
      },
      {
        level: 10, name: 'Twinkling Constellations',
        description:
          'The constellations of your Starry Form improve. The 1d8 of the Archer and the Chalice becomes 2d8, and while the Dragon is active, you have a Fly Speed of 6 m and can hover.\n\n' +
          'Moreover, at the start of each of your turns while in your Starry Form, you can change which constellation glimmers on your body.',
      },
      {
        level: 14, name: 'Full of Stars',
        description: 'While in your Starry Form, you become partially incorporeal, giving you Resistance to Bludgeoning, Piercing, and Slashing damage.',
      },
    ],
  },

  // ================= Fighter (has Champion) =================
  {
    classIndex: 'fighter', index: 'battle-master', name: 'Battle Master',
    features: [
      {
        level: 3, name: 'Combat Superiority',
        description:
          'Your experience on the battlefield has refined your fighting techniques. You learn maneuvers that are fueled by special dice called Superiority Dice.\n\n' +
          '**Maneuvers.** You learn three maneuvers of your choice from this subclass’s Maneuver Options feature. Many maneuvers enhance an attack in some way. You can use only one maneuver per attack.\n\n' +
          'You learn two additional maneuvers of your choice when you reach Fighter levels 7, 10, and 15. Each time you learn new maneuvers, you can also replace one maneuver you know with a different one.\n\n' +
          '**Superiority Dice.** You have four Superiority Dice, which are d8s. A Superiority Die is expended when you use it. You regain all expended Superiority Dice when you finish a Short or Long Rest.\n\n' +
          'You gain an additional Superiority Die when you reach Fighter levels 7 (five dice total) and 15 (six dice total).\n\n' +
          '**Saving Throws.** If a maneuver requires a saving throw, the DC equals 8 plus your Strength or Dexterity modifier (your choice) and Proficiency Bonus.',
      },
      {
        level: 3, name: 'Student of War',
        description:
          "You gain proficiency with one type of Artisan's Tools of your choice, and you gain proficiency in one skill of your choice from the skills available to Fighters at level 1.",
      },
      {
        level: 3, name: 'Maneuver Options',
        description:
          'The maneuvers you can learn for Combat Superiority, presented in alphabetical order.\n\n' +
          "**Ambush.** When you make a Dexterity (Stealth) check or an Initiative roll, you can expend one Superiority Die and add the die to the roll, unless you have the Incapacitated condition.\n\n" +
          '**Bait and Switch.** When you’re within 1.5 m of a creature on your turn, you can expend one Superiority Die and switch places with that creature, provided you spend at least 1.5 m of movement and the creature is willing and doesn’t have the Incapacitated condition. This movement doesn’t provoke Opportunity Attacks. Roll the Superiority Die. Until the start of your next turn, you or the other creature (your choice) gains a bonus to AC equal to the number rolled.\n\n' +
          '**Commander’s Strike.** When you take the Attack action on your turn, you can replace one of your attacks to direct one of your companions to strike. When you do so, choose a willing creature who can see or hear you and expend one Superiority Die. That creature can immediately use its Reaction to make one attack with a weapon or an Unarmed Strike, adding the Superiority Die to the attack’s damage roll on a hit.\n\n' +
          '**Commanding Presence.** When you make a Charisma (Intimidation, Performance, or Persuasion) check, you can expend one Superiority Die and add that die to the roll.\n\n' +
          '**Disarming Attack.** When you hit a creature with an attack roll, you can expend one Superiority Die to attempt to disarm the target. Add the Superiority Die roll to the attack’s damage roll. The target must succeed on a Strength saving throw or drop one object of your choice that it’s holding, with the object landing in its space.\n\n' +
          '**Distracting Strike.** When you hit a creature with an attack roll, you can expend one Superiority Die to distract the target. Add the Superiority Die roll to the attack’s damage roll. The next attack roll against the target by an attacker other than you has Advantage if the attack is made before the start of your next turn.\n\n' +
          '**Evasive Footwork.** As a Bonus Action, you can expend one Superiority Die and take the Disengage action. You also roll the die and add the number rolled to your AC until the start of your next turn.\n\n' +
          '**Feinting Attack.** As a Bonus Action, you can expend one Superiority Die to feint, choosing one creature within 1.5 m of yourself as your target. You have Advantage on your next attack roll against that target this turn. If that attack hits, add the Superiority Die to the attack’s damage roll.\n\n' +
          '**Goading Attack.** When you hit a creature with an attack roll, you can expend one Superiority Die to attempt to goad the target into attacking you. Add the Superiority Die to the attack’s damage roll. The target must succeed on a Wisdom saving throw or have Disadvantage on attack rolls against targets other than you until the end of your next turn.\n\n' +
          '**Lunging Attack.** As a Bonus Action, you can expend one Superiority Die and take the Dash action. If you move at least 1.5 m in a straight line immediately before hitting with a melee attack as part of the Attack action on this turn, you can add the Superiority Die to the attack’s damage roll.\n\n' +
          '**Maneuvering Attack.** When you hit a creature with an attack roll, you can expend one Superiority Die to maneuver one of your comrades into another position. Add the Superiority Die roll to the attack’s damage roll, and choose a willing creature who can see or hear you. That creature can use its Reaction to move up to half its Speed without provoking an Opportunity Attack from the target of your attack.\n\n' +
          '**Menacing Attack.** When you hit a creature with an attack roll, you can expend one Superiority Die to attempt to frighten the target. Add the Superiority Die to the attack’s damage roll. The target must succeed on a Wisdom saving throw or have the Frightened condition until the end of your next turn.\n\n' +
          '**Parry.** When another creature damages you with a melee attack roll, you can take a Reaction and expend one Superiority Die to reduce the damage by the number you roll on your Superiority Die plus your Strength or Dexterity modifier (your choice).\n\n' +
          '**Precision Attack.** When you miss with an attack roll, you can expend one Superiority Die, roll that die, and add it to the attack roll, potentially causing the attack to hit.\n\n' +
          '**Pushing Attack.** When you hit a creature with an attack roll using a weapon or an Unarmed Strike, you can expend one Superiority Die to attempt to drive the target back. Add the Superiority Die to the attack’s damage roll. If the target is Large or smaller, it must succeed on a Strength saving throw or be pushed up to 4.5 m directly away from you.\n\n' +
          '**Rally.** As a Bonus Action, you can expend one Superiority Die to bolster the resolve of a companion. Choose an ally of yours within 9 m of yourself who can see or hear you. That creature gains Temporary Hit Points equal to the Superiority Die roll plus half your Fighter level (round down).\n\n' +
          '**Riposte.** When a creature misses you with a melee attack roll, you can take a Reaction and expend one Superiority Die to make a melee attack roll with a weapon or an Unarmed Strike against the creature. If you hit, add the Superiority Die to the attack’s damage.\n\n' +
          '**Sweeping Attack.** When you hit a creature with a melee attack roll using a weapon or an Unarmed Strike, you can expend one Superiority Die to attempt to damage another creature. Choose another creature within 1.5 m of the original target and within your reach. If the original attack roll would hit the second creature, it takes damage equal to the number you roll on your Superiority Die. The damage is of the same type dealt by the original attack.\n\n' +
          '**Tactical Assessment.** When you make an Intelligence (History or Investigation) check or a Wisdom (Insight) check, you can expend one Superiority Die and add that die to the ability check.\n\n' +
          '**Trip Attack.** When you hit a creature with an attack roll using a weapon or an Unarmed Strike, you can expend one Superiority Die and add the die to the attack’s damage roll. If the target is Large or smaller, it must succeed on a Strength saving throw or have the Prone condition.',
      },
      {
        level: 7, name: 'Know Your Enemy',
        description:
          'As a Bonus Action, you can discern certain strengths and weaknesses of a creature you can see within 9 m of yourself; you know whether that creature has any Immunities, Resistances, or Vulnerabilities, and if the creature has any, you know what they are.\n\n' +
          "Once you use this feature, you can't do so again until you finish a Long Rest. You can also restore a use of the feature by expending one Superiority Die (no action required).",
      },
      { level: 10, name: 'Improved Combat Superiority', description: 'Your Superiority Die becomes a d10.' },
      {
        level: 15, name: 'Relentless',
        description: 'Once per turn, when you use a maneuver, you can roll 1d8 and use the number rolled instead of expending a Superiority Die.',
      },
      { level: 18, name: 'Ultimate Combat Superiority', description: 'Your Superiority Die becomes a d12.' },
    ],
  },
  {
    classIndex: 'fighter', index: 'eldritch-knight', name: 'Eldritch Knight',
    features: [
      {
        level: 3, name: 'Spellcasting',
        description:
          'You have learned to cast spells, using the standard rules for spellcasting.\n\n' +
          '**Cantrips.** You know two cantrips of your choice from the Wizard spell list (Ray of Frost and Shocking Grasp are recommended). Whenever you gain a Fighter level, you can replace one of these cantrips with another cantrip of your choice from the Wizard spell list. When you reach Fighter level 10, you learn another Wizard cantrip of your choice.\n\n' +
          "**Spell Slots.** The Eldritch Knight Spellcasting table gives your spells-prepared and spell-slot totals by Fighter level: you gain your first level 1 slots at level 3 (growing from 2 to 4 as you level), level 2 slots at level 7, level 3 slots at level 13, and level 4 slots at level 19. You regain all expended slots when you finish a Long Rest.\n\n" +
          '**Prepared Spells of Level 1+.** You prepare a list of level 1+ spells available for you to cast with this feature. To start, choose three level 1 spells from the Wizard spell list (Burning Hands, Jump, and Shield are recommended). The number of spells on your list increases as you gain Fighter levels (up to 13 at level 20), per the Eldritch Knight Spellcasting table; whenever it increases, choose additional spells from the Wizard spell list of a level for which you have spell slots.\n\n' +
          '**Changing Your Prepared Spells.** Whenever you gain a Fighter level, you can replace one spell on your list with another Wizard spell for which you have spell slots.\n\n' +
          '**Spellcasting Ability.** Intelligence is your spellcasting ability for your Wizard spells.\n\n' +
          '**Spellcasting Focus.** You can use an Arcane Focus as a Spellcasting Focus for your Wizard spells.',
      },
      {
        level: 3, name: 'War Bond',
        description:
          'You learn a ritual that creates a magical bond between yourself and one weapon. You perform the ritual over the course of 1 hour, which can be done during a Short Rest. The weapon must be within your reach throughout the ritual, at the conclusion of which you touch the weapon and forge the bond. The bond fails if another Fighter is bonded to the weapon or if the weapon is a magic item to which someone else is attuned.\n\n' +
          "Once you have bonded a weapon to yourself, you can't be disarmed of that weapon unless you have the Incapacitated condition. If it is on the same plane of existence, you can summon that weapon as a Bonus Action, causing it to teleport instantly to your hand.\n\n" +
          'You can have up to two bonded weapons, but you can summon only one at a time with a Bonus Action. If you attempt to bond with a third weapon, you must break the bond with one of the other two.',
      },
      {
        level: 7, name: 'War Magic',
        description:
          'When you take the Attack action on your turn, you can replace one of the attacks with a casting of one of your Wizard cantrips that has a casting time of an action.',
      },
      {
        level: 10, name: 'Eldritch Strike',
        description:
          'You learn how to make your weapon strikes undercut a creature’s ability to withstand your spells. When you hit a creature with an attack using a weapon, that creature has Disadvantage on the next saving throw it makes against a spell you cast before the end of your next turn.',
      },
      {
        level: 15, name: 'Arcane Charge',
        description:
          'When you use your Action Surge, you can teleport up to 9 m to an unoccupied space you can see. You can teleport before or after the additional action.',
      },
      {
        level: 18, name: 'Improved War Magic',
        description:
          'When you take the Attack action on your turn, you can replace two of the attacks with a casting of one of your level 1 or level 2 Wizard spells that has a casting time of an action.',
      },
    ],
  },
  {
    classIndex: 'fighter', index: 'psi-warrior', name: 'Psi Warrior',
    features: [
      {
        level: 3, name: 'Psionic Power',
        description:
          'You harbor a wellspring of psionic energy within yourself, represented by your Psionic Energy Dice. You have these dice/sizes by Fighter level: level 3 — four d6s; level 5 — six d8s; level 9 — eight d8s; level 11 — eight d10s; level 13 — ten d10s; level 17 — twelve d12s. You regain one expended die on a Short Rest, and all of them on a Long Rest.\n\n' +
          '**Protective Field.** When you or another creature you can see within 9 m of you takes damage, you can take a Reaction to expend one Psionic Energy Die, roll the die, and reduce the damage taken by the number rolled plus your Intelligence modifier (minimum reduction of 1).\n\n' +
          '**Psionic Strike.** Once on each of your turns, immediately after you hit a target within 9 m of yourself with an attack and deal damage to it with a weapon, you can expend one Psionic Energy Die, rolling it and dealing Force damage to the target equal to the number rolled plus your Intelligence modifier.\n\n' +
          '**Telekinetic Movement.** As a Magic action, choose one target you can see within 9 m of yourself — a loose object that is Large or smaller, or one willing creature other than you — and transport it up to 9 m to an unoccupied space you can see (a Tiny object can instead move to or from your hand). Once you take this action, you can’t do so again until you finish a Short or Long Rest unless you expend a Psionic Energy Die (no action required) to restore your use of it.',
      },
      {
        level: 7, name: 'Telekinetic Adept',
        description:
          'You have mastered new ways to use your telekinetic abilities, detailed below.\n\n' +
          "**Psi-Powered Leap.** As a Bonus Action, you gain a Fly Speed equal to twice your Speed until the end of the current turn. Once you take this Bonus Action, you can't do so again until you finish a Short or Long Rest unless you expend a Psionic Energy Die (no action required) to restore your use of it.\n\n" +
          '**Telekinetic Thrust.** When you deal damage to a target with your Psionic Strike, you can force the target to make a Strength saving throw (DC 8 plus your Intelligence modifier and Proficiency Bonus). On a failed save, you can give the target the Prone condition or transport it up to 3 m horizontally.',
      },
      {
        level: 10, name: 'Guarded Mind',
        description:
          'You have Resistance to Psychic damage. Moreover, if you start your turn with the Charmed or Frightened condition, you can expend a Psionic Energy Die (no action required) and end every effect on yourself giving you those conditions.',
      },
      {
        level: 15, name: 'Bulwark of Force',
        description:
          'You can shield yourself and others with telekinetic force. As a Bonus Action, you can choose creatures, including yourself, within 9 m of yourself, up to a number of creatures equal to your Intelligence modifier (minimum of one creature). Each of the chosen creatures has Half Cover for 1 minute or until you have the Incapacitated condition.\n\n' +
          "Once you use this feature, you can't do so again until you finish a Long Rest unless you expend a Psionic Energy Die (no action required) to restore your use of it.",
      },
      {
        level: 18, name: 'Telekinetic Master',
        description:
          'You always have the Telekinesis spell prepared. With this feature, you can cast it without a spell slot or components, and your spellcasting ability for it is Intelligence. On each of your turns while you maintain Concentration on it, including the turn when you cast it, you can make one attack with a weapon as a Bonus Action.\n\n' +
          "Once you cast the spell with this feature, you can't do so in this way again until you finish a Long Rest unless you expend a Psionic Energy Die (no action required) to restore your use of it.",
      },
    ],
  },

  // ================= Monk (has Warrior of the Open Hand) =================
  {
    classIndex: 'monk', index: 'warrior-of-mercy', name: 'Warrior of Mercy',
    features: [
      {
        level: 3, name: 'Hand of Harm',
        description:
          'Once per turn when you hit a creature with an Unarmed Strike and deal damage, you can expend 1 Focus Point to deal extra Necrotic damage equal to one roll of your Martial Arts die plus your Wisdom modifier.',
      },
      {
        level: 3, name: 'Hand of Healing',
        description:
          'As a Magic action, you can expend 1 Focus Point to touch a creature and restore a number of Hit Points equal to a roll of your Martial Arts die plus your Wisdom modifier.\n\n' +
          'When you use your Flurry of Blows, you can replace one of the Unarmed Strikes with a use of this feature without expending a Focus Point for the healing.',
      },
      {
        level: 3, name: 'Implements of Mercy',
        description: 'You gain proficiency in the Insight and Medicine skills and proficiency with the Herbalism Kit.',
      },
      {
        level: 6, name: 'Physician’s Touch',
        description:
          'Your Hand of Harm and Hand of Healing improve, as detailed below.\n\n' +
          '**Hand of Harm.** When you use Hand of Harm on a creature, you can also give that creature the Poisoned condition until the end of your next turn.\n\n' +
          '**Hand of Healing.** When you use Hand of Healing, you can also end one of the following conditions on the creature you heal: Blinded, Deafened, Paralyzed, Poisoned, or Stunned.',
      },
      {
        level: 11, name: 'Flurry of Healing and Harm',
        description:
          'When you use Flurry of Blows, you can replace each of the Unarmed Strikes with a use of Hand of Healing without expending Focus Points for the healing.\n\n' +
          'In addition, when you make an Unarmed Strike with Flurry of Blows and deal damage, you can use Hand of Harm with that strike without expending a Focus Point for Hand of Harm. You can still use Hand of Harm only once per turn.\n\n' +
          'You can use these benefits a total number of times equal to your Wisdom modifier (minimum of once). You regain all expended uses when you finish a Long Rest.',
      },
      {
        level: 17, name: 'Hand of Ultimate Mercy',
        description:
          'Your mastery of life energy opens the door to the ultimate mercy. As a Magic action, you can touch the corpse of a creature that died within the past 24 hours and expend 5 Focus Points. The creature then returns to life with a number of Hit Points equal to 4d10 plus your Wisdom modifier. If the creature died with any of the following conditions, the creature revives with the conditions removed: Blinded, Deafened, Paralyzed, Poisoned, and Stunned.\n\n' +
          "Once you use this feature, you can't use it again until you finish a Long Rest.",
      },
    ],
  },
  {
    classIndex: 'monk', index: 'warrior-of-shadow', name: 'Warrior of Shadow',
    features: [
      {
        level: 3, name: 'Shadow Arts',
        description:
          'You have learned to draw on the power of the Shadowfell, gaining the following benefits.\n\n' +
          '**Darkness.** You can expend 1 Focus Point to cast the Darkness spell without spell components. You can see within the spell’s area when you cast it with this feature. While the spell persists, you can move its area of Darkness to a space within 18 m of yourself at the start of each of your turns.\n\n' +
          '**Darkvision.** You gain Darkvision with a range of 18 m. If you already have Darkvision, its range increases by 18 m.\n\n' +
          '**Shadowy Figments.** You know the Minor Illusion spell. Wisdom is your spellcasting ability for it.',
      },
      {
        level: 6, name: 'Shadow Step',
        description:
          'While entirely within Dim Light or Darkness, you can use a Bonus Action to teleport up to 18 m to an unoccupied space you can see that is also in Dim Light or Darkness. You then have Advantage on the next melee attack you make before the end of the current turn.',
      },
      {
        level: 11, name: 'Improved Shadow Step',
        description:
          'You can draw on your Shadowfell connection to empower your teleportation. When you use your Shadow Step, you can expend 1 Focus Point to remove the requirement that you must start and end in Dim Light or Darkness for that use of the feature. As part of this Bonus Action, you can make an Unarmed Strike immediately after you teleport.',
      },
      {
        level: 17, name: 'Cloak of Shadows',
        description:
          'As a Magic action while entirely within Dim Light or Darkness, you can expend 3 Focus Points to shroud yourself with shadows for 1 minute, until you have the Incapacitated condition, or until you end your turn in Bright Light. While shrouded by these shadows, you gain the following benefits.\n\n' +
          '**Invisibility.** You have the Invisible condition.\n\n' +
          '**Partially Incorporeal.** You can move through occupied spaces as if they were Difficult Terrain. If you end your turn in such a space, you are shunted to the last unoccupied space you were in.\n\n' +
          '**Shadow Flurry.** You can use your Flurry of Blows without expending any Focus Points.',
      },
    ],
  },
  {
    classIndex: 'monk', index: 'warrior-of-the-elements', name: 'Warrior of the Elements',
    features: [
      {
        level: 3, name: 'Elemental Attunement',
        description:
          'At the start of your turn, you can expend 1 Focus Point to imbue yourself with elemental energy. The energy lasts for 10 minutes or until you have the Incapacitated condition. You gain the following benefits while this feature is active.\n\n' +
          '**Reach.** When you make an Unarmed Strike, your reach is 3 m greater than normal, as elemental energy extends from you.\n\n' +
          '**Elemental Strikes.** Whenever you hit with your Unarmed Strike, you can cause it to deal your choice of Acid, Cold, Fire, Lightning, or Thunder damage rather than its normal damage type. When you deal one of these types with it, you can also force the target to make a Strength saving throw. On a failed save, you can move the target up to 3 m toward or away from you.',
      },
      {
        level: 3, name: 'Manipulate Elements',
        description: 'You know the Elementalism spell. Wisdom is your spellcasting ability for it.',
      },
      {
        level: 6, name: 'Elemental Burst',
        description:
          'As a Magic action, you can expend 2 Focus Points to cause elemental energy to burst in a 6 m radius Sphere centered on a point within 36 m of yourself. Choose a damage type: Acid, Cold, Fire, Lightning, or Thunder.\n\n' +
          'Each creature in the Sphere must make a Dexterity saving throw. On a failed save, a creature takes damage of the chosen type equal to three rolls of your Martial Arts die. On a successful save, a creature takes half as much damage.',
      },
      {
        level: 11, name: 'Stride of the Elements',
        description: 'While your Elemental Attunement is active, you also have a Fly Speed and a Swim Speed equal to your Speed.',
      },
      {
        level: 17, name: 'Elemental Epitome',
        description:
          'While your Elemental Attunement is active, you also gain the following benefits.\n\n' +
          '**Damage Resistance.** You gain Resistance to one of the following damage types of your choice: Acid, Cold, Fire, Lightning, or Thunder. At the start of each of your turns, you can change this choice.\n\n' +
          '**Destructive Stride.** When you use your Step of the Wind, your Speed increases by 6 m until the end of the turn. For that duration, any creature of your choice takes damage equal to one roll of your Martial Arts die when you enter a space within 1.5 m of it. The damage type is your choice of Acid, Cold, Fire, Lightning, or Thunder. A creature can take this damage only once per turn.\n\n' +
          '**Empowered Strikes.** Once on each of your turns, you can deal extra damage to a target equal to one roll of your Martial Arts die when you hit it with an Unarmed Strike. The extra damage is the same type dealt by that strike.',
      },
    ],
  },
];

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
      // P1-7 (SP-03) — distinct from primary_ability_id (the multiclass
      // PREREQUISITE ability, e.g. Paladin's is STR-or-CHA): this is the
      // ability that class's Spellcasting feature actually keys off (e.g.
      // Paladin: CHA alone). Straight from this class's own SRD data, same
      // source as spellcastingType above. Absent (null) for every
      // non-caster class.
      const spellcastingAbilityIndex = r.spellcasting?.spellcasting_ability?.index;
      const spellcastingAbilityId = spellcastingAbilityIndex ? abilityMap.get(spellcastingAbilityIndex) ?? null : null;

      const res = await client.query(
        `INSERT INTO classes (index_key, name, edition_scope, hit_die, primary_ability_id, spellcasting_type, spellcasting_ability_id, saving_throw_proficiency_ids, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (index_key, edition_scope) DO UPDATE SET
           name = EXCLUDED.name, hit_die = EXCLUDED.hit_die, primary_ability_id = EXCLUDED.primary_ability_id,
           spellcasting_type = EXCLUDED.spellcasting_type, spellcasting_ability_id = EXCLUDED.spellcasting_ability_id,
           saving_throw_proficiency_ids = EXCLUDED.saving_throw_proficiency_ids
         RETURNING id`,
        [
          r.index, r.name, edition, r.hit_die, primaryAbilityId, spellcastingType, spellcastingAbilityId, savingThrowIds,
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

  // docs/roadmap/dnd-2024-gap-analysis.md P1-5 — the 18 subclasses missing
  // from the third-party JSON for the 6 classes this repo can verify (see
  // SUPPLEMENTAL_2024_SUBCLASSES's own comment for the full rationale and
  // scope boundary). Same upsert statement as the JSON-driven loop above.
  for (const s of SUPPLEMENTAL_2024_SUBCLASSES) {
    const classId = classMap.get(`2024:${s.classIndex}`);
    if (!classId) throw new Error(`Unknown class '${s.classIndex}' for supplemental subclass '${s.index}'`);
    const res = await client.query(
      `INSERT INTO subclasses (class_id, index_key, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (class_id, index_key) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [classId, s.index, s.name],
    );
    subclassMap.set(`2024:${s.classIndex}:${s.index}`, res.rows[0].id);
    subclassCount++;
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

// docs/roadmap/dnd-2024-gap-analysis.md P1-6 — `class_levels.weapon_mastery_count`:
// how many kinds of weapon a character can use the mastery property of,
// per class per level. 2024-only mechanic (2014 has no Weapon Mastery), and
// only 5 of the 12 classes ever get the feature at all — Barbarian, Fighter,
// Paladin, Ranger, Rogue (the other 7 classes' rows are left NULL, which is
// the mechanically correct answer for them, not a placeholder for missing
// data).
//
// PROVENANCE, split by class (flagged per this project's own established
// "don't blur a source's provenance" convention — see the Aasimar/feat/
// subclass supplements above):
//   - Barbarian, Fighter: sourced directly from this repo's own
//     `docs/players-handbook-2024/Chapter 3- Character Classes/
//     chapter3-characterClasses.md` (Barbarian Features table lines 510-513
//     + Weapon Mastery feature text 563-567; Fighter Features table
//     510-513/2517-2520 + feature text 2554-2558) — the two classes this
//     project's own PHB doc set actually covers for this feature.
//   - Paladin, Ranger, Rogue: this project's PHB doc set has ZERO source
//     text for these 3 classes' Weapon Mastery feature (confirmed absent,
//     same gap noted by P1-5 for their subclasses). Scoped with the user to
//     include them anyway rather than leave 3 more classes at "not
//     automatable" — sourced from general knowledge and cross-checked
//     against a live web search (2024-08-30) corroborating multiple
//     independent secondary sources (dndbeyond.com/posts/1742, the D&D
//     Beyond forums, pages.roll20.net/dnd/2024-weapon-mastery): all three
//     grant exactly 2 weapon kinds at level 1, STATIC — unlike Barbarian/
//     Fighter, none of the three ever increases this count by leveling up.
//     Confidence: moderate, NOT verified against the physical/PDF book the
//     way every other catalog entry in this file is. If this project's own
//     PHB doc set ever gains Paladin/Ranger/Rogue chapters, re-verify
//     against that text and correct this comment/table.
const WEAPON_MASTERY_THRESHOLDS: Record<string, Array<[minLevel: number, count: number]>> = {
  barbarian: [[1, 2], [4, 3], [10, 4]],
  fighter: [[1, 3], [4, 4], [10, 5], [16, 6]],
  paladin: [[1, 2]],
  ranger: [[1, 2]],
  rogue: [[1, 2]],
};

async function seedWeaponMasteryCounts(client: Client, classMap: Map<string, number>): Promise<void> {
  let count = 0;
  for (const [classIndex, thresholds] of Object.entries(WEAPON_MASTERY_THRESHOLDS)) {
    const classId = classMap.get(`2024:${classIndex}`);
    if (!classId) throw new Error(`Unknown 2024 class '${classIndex}' for weapon mastery counts`);
    for (let level = 1; level <= 20; level++) {
      let masteryCount = 0;
      for (const [minLevel, thresholdCount] of thresholds) {
        if (level >= minLevel) masteryCount = thresholdCount;
      }
      const result = await client.query(
        `UPDATE class_levels SET weapon_mastery_count = $3 WHERE class_id = $1 AND level = $2`,
        [classId, level, masteryCount],
      );
      count += result.rowCount ?? 0;
    }
  }
  console.log(`  class_levels.weapon_mastery_count: ${count} rows updated`);
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

  // docs/roadmap/dnd-2024-gap-analysis.md P1-5 — feature rows for the 18
  // supplemental subclasses above. Must live in THIS function (not just
  // seedClassesAndSubclasses) because this table is fully wiped and
  // repopulated on every seed run (see this function's own comment above) —
  // adding these rows anywhere else would have them survive the first seed
  // but vanish on the next one.
  for (const s of SUPPLEMENTAL_2024_SUBCLASSES) {
    const classId = classMap.get(`2024:${s.classIndex}`);
    const subclassId = subclassMap.get(`2024:${s.classIndex}:${s.index}`);
    if (!classId || !subclassId) throw new Error(`Unknown class/subclass '${s.classIndex}/${s.index}' for supplemental features`);
    for (const f of s.features) {
      await client.query(
        `INSERT INTO class_features (class_id, subclass_id, level, name, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [classId, subclassId, f.level, f.name, f.description],
      );
      count++;
    }
  }

  console.log(`  class_features: ${count}`);
}

// docs/roadmap/dnd-2024-gap-analysis.md P1-4 (FT-01) — the third-party SRD
// JSON dataset carries only 17 of the 75 official 2024 feats (10 Origin +
// 43 General + 10 Fighting Style + 12 Epic Boon per docs/players-handbook-
// 2024/Chapter 5- Feats — NOT the 69/37-General the gap analysis originally
// estimated; corrected here against the actual PHB text rather than
// propagating a stale count) and carries no type/category at all. Both gaps
// are fixed the same way P1-3 fixed Aasimar/Dragonborn: hand-authored
// directly from that chapter, kept OUT of the third-party JSON file itself
// to preserve its value as a verifiable upstream copy.
//
// Distances are written in meters, matching this catalog's own established
// convention (every other seeded description — spells, conditions, race
// traits — already uses meters, converted from the SRD JSON's own feet-to-
// meters authoring; see this file's other seed functions and CLAUDE.md's
// "5 ft. = 1.5 m" note). Descriptions use the same "You gain the following
// benefits." + `**Trait Name.** ...` paragraph format the JSON-sourced
// feats already use (confirmed against the live seeded `alert`/
// `boon-of-truesight` rows), so a feat's provenance is invisible to anyone
// just reading the catalog.
//
// type backfill for the 17 JSON-sourced feats (their source file has no
// category field at all): 2014's lone `grappler` row is deliberately left
// unmapped (null) — 2014 predates this categorization entirely, per the
// migration's own comment.
const FEAT_TYPE_BY_INDEX: Record<string, 'origin' | 'general' | 'fighting_style' | 'epic_boon'> = {
  alert: 'origin', 'magic-initiate': 'origin', 'savage-attacker': 'origin', skilled: 'origin',
  'ability-score-improvement': 'general', grappler: 'general',
  archery: 'fighting_style', defense: 'fighting_style', 'great-weapon-fighting': 'fighting_style', 'two-weapon-fighting': 'fighting_style',
  'boon-of-combat-prowess': 'epic_boon', 'boon-of-dimensional-travel': 'epic_boon', 'boon-of-fate': 'epic_boon',
  'boon-of-irresistible-offense': 'epic_boon', 'boon-of-spell-recall': 'epic_boon', 'boon-of-the-night-spirit': 'epic_boon',
  'boon-of-truesight': 'epic_boon',
};

interface SupplementalFeat {
  index: string;
  name: string;
  type: 'origin' | 'general' | 'fighting_style' | 'epic_boon';
  prerequisite: string | null;
  description: string;
}

const SUPPLEMENTAL_2024_FEATS: SupplementalFeat[] = [
  // ---- Origin (6 missing: alert/magic-initiate/savage-attacker/skilled already seeded) ----
  {
    index: 'crafter', name: 'Crafter', type: 'origin', prerequisite: null,
    description:
      'You gain the following benefits.\n\n' +
      "**Tool Proficiency.** You gain proficiency with three different Artisan's Tools of your choice.\n\n" +
      '**Discount.** Whenever you buy a nonmagical item, you receive a 20 percent discount on it.\n\n' +
      "**Fast Crafting.** When you finish a Long Rest, you can craft one piece of gear (a Ladder, Torch, Crossbow Bolt Case, Map or Scroll Case, Pouch, Block and Tackle, Jug, Lamp, Ball Bearings, Bucket, Caltrops, Grappling Hook, Iron Pot, Bell, Shovel, Tinderbox, Basket, Rope, Net, Tent, Club, Greatclub, or Quarterstaff), provided you have the Artisan's Tools associated with that item and proficiency with those tools. The item lasts until you finish another Long Rest, at which point it falls apart.",
  },
  {
    index: 'healer', name: 'Healer', type: 'origin', prerequisite: null,
    description:
      'You gain the following benefits.\n\n' +
      "**Battle Medic.** If you have a Healer's Kit, you can expend one use of it and tend to a creature within 1.5 m of yourself as a Utilize action. That creature can expend one of its Hit Point Dice, and you then roll that die. The creature regains a number of Hit Points equal to the roll plus your Proficiency Bonus.\n\n" +
      "**Healing Rerolls.** Whenever you roll a die to determine the number of Hit Points you restore with a spell or with this feat's Battle Medic benefit, you can reroll the die if it rolls a 1, and you must use the new roll.",
  },
  {
    index: 'lucky', name: 'Lucky', type: 'origin', prerequisite: null,
    description:
      'You gain the following benefits.\n\n' +
      '**Luck Points.** You have a number of Luck Points equal to your Proficiency Bonus and can spend the points on the benefits below. You regain your expended Luck Points when you finish a Long Rest.\n\n' +
      '**Advantage.** When you roll a d20 for a D20 Test, you can spend 1 Luck Point to give yourself Advantage on the roll.\n\n' +
      '**Disadvantage.** When a creature rolls a d20 for an attack roll against you, you can spend 1 Luck Point to impose Disadvantage on that roll.',
  },
  {
    index: 'musician', name: 'Musician', type: 'origin', prerequisite: null,
    description:
      'You gain the following benefits.\n\n' +
      '**Instrument Training.** You gain proficiency with three Musical Instruments of your choice.\n\n' +
      '**Encouraging Song.** As you finish a Short or Long Rest, you can play a song on a Musical Instrument with which you have proficiency and give Heroic Inspiration to allies who hear the song. The number of allies you can affect in this way equals your Proficiency Bonus.',
  },
  {
    index: 'tavern-brawler', name: 'Tavern Brawler', type: 'origin', prerequisite: null,
    description:
      'You gain the following benefits.\n\n' +
      "**Enhanced Unarmed Strike.** When you hit with your Unarmed Strike and deal damage, you can deal Bludgeoning damage equal to 1d4 plus your Strength modifier instead of the normal damage of an Unarmed Strike.\n\n" +
      "**Damage Rerolls.** Whenever you roll a damage die for your Unarmed Strike, you can reroll the die if it rolls a 1, and you must use the new roll.\n\n" +
      '**Improvised Weaponry.** You have proficiency with improvised weapons.\n\n' +
      '**Push.** When you hit a creature with an Unarmed Strike as part of the Attack action on your turn, you can deal damage to the target and also push it 1.5 m away from you. You can use this benefit only once per turn.',
  },
  {
    index: 'tough', name: 'Tough', type: 'origin', prerequisite: null,
    description:
      'Your Hit Point maximum increases by an amount equal to twice your character level when you gain this feat. Whenever you gain a character level thereafter, your Hit Point maximum increases by an additional 2 Hit Points.',
  },

  // ---- General (41 missing: ability-score-improvement/grappler already seeded) ----
  {
    index: 'actor', name: 'Actor', type: 'general', prerequisite: 'Level 4+, Charisma 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Charisma score by 1, to a maximum of 20.\n\n' +
      "**Impersonation.** While you're disguised as a real or fictional person, you have Advantage on Charisma (Deception or Performance) checks to convince others that you are that person.\n\n" +
      '**Mimicry.** You can mimic the sounds of other creatures, including speech. A creature that hears the mimicry must succeed on a Wisdom (Insight) check to determine the effect is faked (DC 8 plus your Charisma modifier and Proficiency Bonus).',
  },
  {
    index: 'athlete', name: 'Athlete', type: 'general', prerequisite: 'Level 4+, Strength or Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Climb Speed.** You gain a Climb Speed equal to your Speed.\n\n' +
      '**Hop Up.** When you have the Prone condition, you can right yourself with only 1.5 m of movement.\n\n' +
      '**Jumping.** You can make a running Long or High Jump after moving only 1.5 m.',
  },
  {
    index: 'charger', name: 'Charger', type: 'general', prerequisite: 'Level 4+, Strength or Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Improved Dash.** When you take the Dash action, your Speed increases by 3 m for that action.\n\n' +
      "**Charge Attack.** If you move at least 3 m in a straight line toward a target immediately before hitting it with a melee attack roll as part of the Attack action, choose one of the following effects: gain a 1d8 bonus to the attack's damage roll, or push the target up to 3 m away if it is no more than one size larger than you. You can use this benefit only once on each of your turns.",
  },
  {
    index: 'chef', name: 'Chef', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Constitution or Wisdom score by 1, to a maximum of 20.\n\n' +
      "**Cook's Utensils.** You gain proficiency with Cook's Utensils if you don't already have it.\n\n" +
      "**Replenishing Meal.** As part of a Short Rest, you can cook special food if you have ingredients and Cook's Utensils on hand. You can prepare enough of this food for a number of creatures equal to 4 plus your Proficiency Bonus. At the end of the Short Rest, any creature who eats the food and spends one or more Hit Dice to regain Hit Points regains an extra 1d8 Hit Points.\n\n" +
      "**Bolstering Treats.** With 1 hour of work or when you finish a Long Rest, you can cook a number of treats equal to your Proficiency Bonus if you have ingredients and Cook's Utensils on hand. These special treats last 8 hours after being made. A creature can use a Bonus Action to eat one of those treats to gain a number of Temporary Hit Points equal to your Proficiency Bonus.",
  },
  {
    index: 'crossbow-expert', name: 'Crossbow Expert', type: 'general', prerequisite: 'Level 4+, Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Dexterity score by 1, to a maximum of 20.\n\n' +
      "**Ignore Loading.** You ignore the Loading property of the Hand Crossbow, Heavy Crossbow, and Light Crossbow. If you're holding one of them, you can load a piece of ammunition into it even if you lack a free hand.\n\n" +
      "**Firing in Melee.** Being within 1.5 m of an enemy doesn't impose Disadvantage on your attack rolls with crossbows.\n\n" +
      "**Dual Wielding.** When you make the extra attack of the Light property, you can add your ability modifier to the damage of the extra attack if that attack is with a crossbow that has the Light property and you aren't already adding that modifier to the damage.",
  },
  {
    index: 'crusher', name: 'Crusher', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Constitution score by 1, to a maximum of 20.\n\n' +
      '**Push.** Once per turn, when you hit a creature with an attack that deals Bludgeoning damage, you can move it 1.5 m to an unoccupied space if the target is no more than one size larger than you.\n\n' +
      '**Enhanced Critical.** When you score a Critical Hit that deals Bludgeoning damage to a creature, attack rolls against that creature have Advantage until the start of your next turn.',
  },
  {
    index: 'defensive-duelist', name: 'Defensive Duelist', type: 'general', prerequisite: 'Level 4+, Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Dexterity score by 1, to a maximum of 20.\n\n' +
      "**Parry.** If you're holding a Finesse weapon and another creature hits you with a melee attack, you can take a Reaction to add your Proficiency Bonus to your Armor Class, potentially causing the attack to miss you. You gain this bonus to your AC against melee attacks until the start of your next turn.",
  },
  {
    index: 'dual-wielder', name: 'Dual Wielder', type: 'general', prerequisite: 'Level 4+, Strength or Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      "**Enhanced Dual Wielding.** When you take the Attack action on your turn and attack with a weapon that has the Light property, you can make one extra attack as a Bonus Action later on the same turn with a different weapon, which must be a Melee weapon that lacks the Two-Handed property. You don't add your ability modifier to the extra attack's damage unless that modifier is negative.\n\n" +
      '**Quick Draw.** You can draw or stow two weapons that lack the Two-Handed property when you would normally be able to draw or stow only one.',
  },
  {
    index: 'durable', name: 'Durable', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Constitution score by 1, to a maximum of 20.\n\n' +
      '**Defy Death.** You have Advantage on Death Saving Throws.\n\n' +
      '**Speedy Recovery.** As a Bonus Action, you can expend one of your Hit Point Dice, roll the die, and regain a number of Hit Points equal to the roll.',
  },
  {
    index: 'elemental-adept', name: 'Elemental Adept', type: 'general', prerequisite: 'Level 4+, Spellcasting or Pact Magic Feature',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n\n' +
      '**Energy Mastery.** Choose one of the following damage types: Acid, Cold, Fire, Lightning, or Thunder. Spells you cast ignore Resistance to damage of the chosen type. In addition, when you roll damage for a spell you cast that deals damage of that type, you can treat any 1 on a damage die as a 2.\n\n' +
      '**Repeatable.** You can take this feat more than once, but you must choose a different damage type each time for Energy Mastery.',
  },
  {
    index: 'fey-touched', name: 'Fey Touched', type: 'general', prerequisite: 'Level 4+',
    description:
      "Your exposure to the Feywild's magic grants you the following benefits.\n\n" +
      '**Ability Score Increase.** Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n\n' +
      "**Fey Magic.** Choose one level 1 spell from the Divination or Enchantment school of magic. You always have that spell and the Misty Step spell prepared. You can cast each of these spells without expending a spell slot. Once you cast either spell in this way, you can't cast that spell in this way again until you finish a Long Rest. You can also cast these spells using spell slots you have of the appropriate level. The spells' spellcasting ability is the ability increased by this feat.",
  },
  {
    index: 'great-weapon-master', name: 'Great Weapon Master', type: 'general', prerequisite: 'Level 4+, Strength 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength score by 1, to a maximum of 20.\n\n' +
      '**Heavy Weapon Mastery.** When you hit a creature with a weapon that has the Heavy property as part of the Attack action on your turn, you can cause the weapon to deal extra damage to the target. The extra damage equals your Proficiency Bonus.\n\n' +
      '**Hew.** Immediately after you score a Critical Hit with a Melee weapon or reduce a creature to 0 Hit Points with one, you can make one attack with the same weapon as a Bonus Action.',
  },
  {
    index: 'heavily-armored', name: 'Heavily Armored', type: 'general', prerequisite: 'Level 4+, Medium Armor Training',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Constitution or Strength score by 1, to a maximum of 20.\n\n' +
      '**Armor Training.** You gain training with Heavy armor.',
  },
  {
    index: 'heavy-armor-master', name: 'Heavy Armor Master', type: 'general', prerequisite: 'Level 4+, Heavy Armor Training',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Constitution or Strength score by 1, to a maximum of 20.\n\n' +
      "**Damage Reduction.** When you're hit by an attack while you're wearing Heavy armor, any Bludgeoning, Piercing, and Slashing damage dealt to you by that attack is reduced by an amount equal to your Proficiency Bonus.",
  },
  {
    index: 'inspiring-leader', name: 'Inspiring Leader', type: 'general', prerequisite: 'Level 4+, Wisdom or Charisma 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Wisdom or Charisma score by 1, to a maximum of 20.\n\n' +
      '**Bolstering Performance.** When you finish a Short or Long Rest, you can give an inspiring performance: a speech, song, or dance. When you do so, choose up to six allies (which can include yourself) within 9 m of yourself who witness the performance. The chosen creatures each gain Temporary Hit Points equal to your character level plus the modifier of the ability you increased with this feat.',
  },
  {
    index: 'keen-mind', name: 'Keen Mind', type: 'general', prerequisite: 'Level 4+, Intelligence 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Intelligence score by 1, to a maximum of 20.\n\n' +
      '**Lore Knowledge.** Choose one of the following skills: Arcana, History, Investigation, Nature, or Religion. If you lack proficiency in the chosen skill, you gain proficiency in it, and if you already have proficiency in it, you gain Expertise in it.\n\n' +
      '**Quick Study.** You can take the Study action as a Bonus Action.',
  },
  {
    index: 'lightly-armored', name: 'Lightly Armored', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Armor Training.** You gain training with Light armor and Shields.',
  },
  {
    index: 'mage-slayer', name: 'Mage Slayer', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Concentration Breaker.** When you damage a creature that is concentrating, it has Disadvantage on the saving throw it makes to maintain Concentration.\n\n' +
      "**Guarded Mind.** If you fail an Intelligence, a Wisdom, or a Charisma saving throw, you can cause yourself to succeed instead. Once you use this benefit, you can't use it again until you finish a Short or Long Rest.",
  },
  {
    index: 'martial-weapon-training', name: 'Martial Weapon Training', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Weapon Proficiency.** You gain proficiency with Martial weapons.',
  },
  {
    index: 'medium-armor-master', name: 'Medium Armor Master', type: 'general', prerequisite: 'Level 4+, Medium Armor Training',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      "**Dexterous Wearer.** While you're wearing Medium armor, you can add 3, rather than 2, to your AC if you have a Dexterity score of 16 or higher.",
  },
  {
    index: 'moderately-armored', name: 'Moderately Armored', type: 'general', prerequisite: 'Level 4+, Light Armor Training',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Armor Training.** You gain training with Medium armor.',
  },
  {
    index: 'mounted-combatant', name: 'Mounted Combatant', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength, Dexterity, or Wisdom score by 1, to a maximum of 20.\n\n' +
      '**Mounted Strike.** While mounted, you have Advantage on attack rolls against any unmounted creature within 1.5 m of your mount that is at least one size smaller than the mount.\n\n' +
      '**Leap Aside.** If your mount is subjected to an effect that allows it to make a Dexterity saving throw to take only half damage, it instead takes no damage if it succeeds on the saving throw and only half damage if it fails. For your mount to gain this benefit, you must be riding it, and neither of you can have the Incapacitated condition.\n\n' +
      "**Veer.** While mounted, you can force an attack that hits your mount to hit you instead if you don't have the Incapacitated condition.",
  },
  {
    index: 'observant', name: 'Observant', type: 'general', prerequisite: 'Level 4+, Intelligence or Wisdom 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Intelligence or Wisdom score by 1, to a maximum of 20.\n\n' +
      '**Keen Observer.** Choose one of the following skills: Insight, Investigation, or Perception. If you lack proficiency with the chosen skill, you gain proficiency in it, and if you already have proficiency in it, you gain Expertise in it.\n\n' +
      '**Quick Search.** You can take the Search action as a Bonus Action.',
  },
  {
    index: 'piercer', name: 'Piercer', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity by 1, to a maximum of 20.\n\n' +
      '**Puncture.** Once per turn, when you hit a creature with an attack that deals Piercing damage, you can reroll one of the attack’s damage dice, and you must use the new roll.\n\n' +
      '**Enhanced Critical.** When you score a Critical Hit that deals Piercing damage to a creature, you can roll one additional damage die when determining the extra Piercing damage the target takes.',
  },
  {
    index: 'poisoner', name: 'Poisoner', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Dexterity or Intelligence score by 1, to a maximum of 20.\n\n' +
      '**Potent Poison.** When you make a damage roll that deals Poison damage, it ignores Resistance to Poison damage.\n\n' +
      "**Brew Poison.** You gain proficiency with the Poisoner's Kit. With 1 hour of work using such a kit and expending 50 GP worth of materials, you can create a number of poison doses equal to your Proficiency Bonus. As a Bonus Action, you can apply a poison dose to a weapon or piece of ammunition. Once applied, the poison retains its potency for 1 minute or until you deal damage with the poisoned item, whichever is shorter. When a creature takes damage from the poisoned item, that creature must succeed on a Constitution saving throw (DC 8 plus the modifier of the ability increased by this feat and your Proficiency Bonus) or take 2d8 Poison damage and have the Poisoned condition until the end of your next turn.",
  },
  {
    index: 'polearm-master', name: 'Polearm Master', type: 'general', prerequisite: 'Level 4+, Strength or Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Dexterity or Strength score by 1, to a maximum of 20.\n\n' +
      '**Pole Strike.** Immediately after you take the Attack action and attack with a Quarterstaff, a Spear, or a weapon that has the Heavy and Reach properties, you can use a Bonus Action to make a melee attack with the opposite end of the weapon. The weapon deals Bludgeoning damage, and the weapon’s damage die for this attack is a d4.\n\n' +
      "**Reactive Strike.** While you're holding a Quarterstaff, a Spear, or a weapon that has the Heavy and Reach properties, you can take a Reaction to make one melee attack against a creature that enters the reach you have with that weapon.",
  },
  {
    index: 'resilient', name: 'Resilient', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Choose one ability in which you lack saving throw proficiency. Increase the chosen ability score by 1, to a maximum of 20.\n\n' +
      '**Saving Throw Proficiency.** You gain saving throw proficiency with the chosen ability.',
  },
  {
    index: 'ritual-caster', name: 'Ritual Caster', type: 'general', prerequisite: 'Level 4+; Intelligence, Wisdom, or Charisma 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n\n' +
      "**Ritual Spells.** Choose a number of level 1 spells equal to your Proficiency Bonus that have the Ritual tag. You always have those spells prepared, and you can cast them with any spell slots you have. The spells' spellcasting ability is the ability increased by this feat. Whenever your Proficiency Bonus increases thereafter, you can add an additional level 1 spell with the Ritual tag to the spells always prepared with this feature.\n\n" +
      "**Quick Ritual.** With this benefit, you can cast a Ritual spell that you have prepared using its regular casting time rather than the extended time for a Ritual. Doing so doesn't require a spell slot. Once you cast the spell in this way, you can't use this benefit again until you finish a Long Rest.",
  },
  {
    index: 'sentinel', name: 'Sentinel', type: 'general', prerequisite: 'Level 4+, Strength or Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Guardian.** Immediately after a creature within 1.5 m of you takes the Disengage action or hits a target other than you with an attack, you can make an Opportunity Attack against that creature.\n\n' +
      "**Halt.** When you hit a creature with an Opportunity Attack, the creature's Speed becomes 0 for the rest of the current turn.",
  },
  {
    index: 'shadow-touched', name: 'Shadow Touched', type: 'general', prerequisite: 'Level 4+',
    description:
      "Your exposure to the Shadowfell's magic grants you the following benefits.\n\n" +
      '**Ability Score Increase.** Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n\n' +
      "**Shadow Magic.** Choose one level 1 spell from the Illusion or Necromancy school of magic. You always have that spell and the Invisibility spell prepared. You can cast each of these spells without expending a spell slot. Once you cast either spell in this way, you can't cast that spell in this way again until you finish a Long Rest. You can also cast these spells using spell slots you have of the appropriate level. The spells' spellcasting ability is the ability increased by this feat.",
  },
  {
    index: 'sharpshooter', name: 'Sharpshooter', type: 'general', prerequisite: 'Level 4+, Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Bypass Cover.** Your ranged attacks with weapons ignore Half Cover and Three-Quarters Cover.\n\n' +
      "**Firing in Melee.** Being within 1.5 m of an enemy doesn't impose Disadvantage on your attack rolls with Ranged weapons.\n\n" +
      "**Long Shots.** Attacking at long range doesn't impose Disadvantage on your attack rolls with Ranged weapons.",
  },
  {
    index: 'shield-master', name: 'Shield Master', type: 'general', prerequisite: 'Level 4+, Shield Training',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength score by 1, to a maximum of 20.\n\n' +
      "**Shield Bash.** If you attack a creature within 1.5 m of you as part of the Attack action and hit with a Melee weapon, you can immediately bash the target with your Shield if it's equipped, forcing the target to make a Strength saving throw (DC 8 plus your Strength modifier and Proficiency Bonus). On a failed save, you either push the target 1.5 m from you or cause it to have the Prone condition (your choice). You can use this benefit only once on each of your turns.\n\n" +
      "**Interpose Shield.** If you're subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you can take a Reaction to take no damage if you succeed on the saving throw and are holding a Shield.",
  },
  {
    index: 'skill-expert', name: 'Skill Expert', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase one ability score of your choice by 1, to a maximum of 20.\n\n' +
      '**Skill Proficiency.** You gain proficiency in one skill of your choice.\n\n' +
      '**Expertise.** Choose one skill in which you have proficiency but lack Expertise. You gain Expertise with that skill.',
  },
  {
    index: 'skulker', name: 'Skulker', type: 'general', prerequisite: 'Level 4+, Dexterity 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Blindsight.** You have Blindsight with a range of 3 m.\n\n' +
      '**Fog of War.** You exploit the distractions of battle, gaining Advantage on any Dexterity (Stealth) check you make as part of the Hide action during combat.\n\n' +
      "**Sniper.** If you make an attack roll while hidden and the roll misses, making the attack roll doesn't reveal your location.",
  },
  {
    index: 'slasher', name: 'Slasher', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Hamstring.** Once per turn when you hit a creature with an attack that deals Slashing damage, you can reduce the Speed of that creature by 3 m until the start of your next turn.\n\n' +
      '**Enhanced Critical.** When you score a Critical Hit that deals Slashing damage to a creature, it has Disadvantage on attack rolls until the start of your next turn.',
  },
  {
    index: 'speedy', name: 'Speedy', type: 'general', prerequisite: 'Level 4+, Dexterity or Constitution 13+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Dexterity or Constitution score by 1, to a maximum of 20.\n\n' +
      '**Speed Increase.** Your Speed increases by 3 m.\n\n' +
      "**Dash over Difficult Terrain.** When you take the Dash action on your turn, Difficult Terrain doesn't cost you extra movement for the rest of that turn.\n\n" +
      '**Agile Movement.** Opportunity Attacks have Disadvantage against you.',
  },
  {
    index: 'spell-sniper', name: 'Spell Sniper', type: 'general', prerequisite: 'Level 4+, Spellcasting or Pact Magic Feature',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n\n' +
      '**Bypass Cover.** Your attack rolls for spells ignore Half Cover and Three-Quarters Cover.\n\n' +
      "**Casting in Melee.** Being within 1.5 m of an enemy doesn't impose Disadvantage on your attack rolls with spells.\n\n" +
      '**Increased Range.** When you cast a spell that has a range of at least 3 m and requires you to make an attack roll, you can increase the spell’s range by 18 m.',
  },
  {
    index: 'telekinetic', name: 'Telekinetic', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n\n' +
      "**Minor Telekinesis.** You learn the Mage Hand spell. You can cast it without Verbal or Somatic components, you can make the spectral hand Invisible, and its range and the distance it can be away from you both increase by 9 m when you cast it. The spell's spellcasting ability is the ability increased by this feat.\n\n" +
      '**Telekinetic Shove.** As a Bonus Action, you can telekinetically shove one creature you can see within 9 m of yourself. When you do so, the target must succeed on a Strength saving throw (DC 8 plus the ability modifier of the score increased by this feat and your Proficiency Bonus) or be moved 1.5 m toward or away from you.',
  },
  {
    index: 'telepathic', name: 'Telepathic', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n\n' +
      "**Telepathic Utterance.** You can speak telepathically to any creature you can see within 18 m of yourself. Your telepathic utterances are in a language you know, and the creature understands you only if it knows that language. Your communication doesn't give the creature the ability to respond to you telepathically.\n\n" +
      '**Detect Thoughts.** You always have the Detect Thoughts spell prepared. You can cast it without a spell slot or spell components, and you must finish a Long Rest before you can cast it in this way again. You can also cast it using spell slots you have of the appropriate level. Your spellcasting ability for the spell is the ability increased by this feat.',
  },
  {
    index: 'war-caster', name: 'War Caster', type: 'general', prerequisite: 'Level 4+, Spellcasting or Pact Magic Feature',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.\n\n' +
      '**Concentration.** You have Advantage on Constitution saving throws that you make to maintain Concentration.\n\n' +
      '**Reactive Spell.** When a creature provokes an Opportunity Attack from you by leaving your reach, you can take a Reaction to cast a spell at the creature rather than making an Opportunity Attack. The spell must have a casting time of one action and must target only that creature.\n\n' +
      '**Somatic Components.** You can perform the Somatic components of spells even when you have weapons or a Shield in one or both hands.',
  },
  {
    index: 'weapon-master', name: 'Weapon Master', type: 'general', prerequisite: 'Level 4+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase your Strength or Dexterity score by 1, to a maximum of 20.\n\n' +
      '**Mastery Property.** Your training with weapons allows you to use the mastery property of one kind of Simple or Martial weapon of your choice, provided you have proficiency with it. Whenever you finish a Long Rest, you can change the kind of weapon to another eligible kind.',
  },

  // ---- Fighting Style (6 missing: archery/defense/great-weapon-fighting/two-weapon-fighting already seeded) ----
  {
    index: 'blind-fighting', name: 'Blind Fighting', type: 'fighting_style', prerequisite: 'Fighting Style Feature',
    description: 'You have Blindsight with a range of 3 m.',
  },
  {
    index: 'dueling', name: 'Dueling', type: 'fighting_style', prerequisite: 'Fighting Style Feature',
    description: "When you're holding a Melee weapon in one hand and no other weapons, you gain a +2 bonus to damage rolls with that weapon.",
  },
  {
    index: 'interception', name: 'Interception', type: 'fighting_style', prerequisite: 'Fighting Style Feature',
    description:
      'When a creature you can see hits another creature within 1.5 m of you with an attack roll, you can take a Reaction to reduce the damage dealt to the target by 1d10 plus your Proficiency Bonus. You must be holding a Shield or a Simple or Martial weapon to use this Reaction.',
  },
  {
    index: 'protection', name: 'Protection', type: 'fighting_style', prerequisite: 'Fighting Style Feature',
    description:
      "When a creature you can see attacks a target other than you that is within 1.5 m of you, you can take a Reaction to interpose your Shield if you're holding one. You impose Disadvantage on the triggering attack roll and all other attack rolls against the target until the start of your next turn if you remain within 1.5 m of the target.",
  },
  {
    index: 'thrown-weapon-fighting', name: 'Thrown Weapon Fighting', type: 'fighting_style', prerequisite: 'Fighting Style Feature',
    description: 'When you hit with a ranged attack roll using a weapon that has the Thrown property, you gain a +2 bonus to the damage roll.',
  },
  {
    index: 'unarmed-fighting', name: 'Unarmed Fighting', type: 'fighting_style', prerequisite: 'Fighting Style Feature',
    description:
      "When you hit with your Unarmed Strike and deal damage, you can deal Bludgeoning damage equal to 1d6 plus your Strength modifier instead of the normal damage of an Unarmed Strike. If you aren't holding any weapons or a Shield when you make the attack roll, the d6 becomes a d8.\n\n" +
      'At the start of each of your turns, you can deal 1d4 Bludgeoning damage to one creature Grappled by you.',
  },

  // ---- Epic Boon (5 missing: combat-prowess/dimensional-travel/fate/irresistible-offense/spell-recall/the-night-spirit/truesight already seeded) ----
  {
    index: 'boon-of-energy-resistance', name: 'Boon of Energy Resistance', type: 'epic_boon', prerequisite: 'Level 19+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase one ability score of your choice by 1, to a maximum of 30.\n\n' +
      '**Energy Resistances.** You gain Resistance to two of the following damage types of your choice: Acid, Cold, Fire, Lightning, Necrotic, Poison, Psychic, Radiant, or Thunder. Whenever you finish a Long Rest, you can change your choices.\n\n' +
      "**Energy Redirection.** When you take damage of one of the types chosen for the Energy Resistances benefit, you can take a Reaction to direct damage of the same type toward another creature you can see within 18 m of yourself that isn't behind Total Cover. If you do so, that creature must succeed on a Dexterity saving throw (DC 8 plus your Constitution modifier and Proficiency Bonus) or take damage equal to 2d12 plus your Constitution modifier.",
  },
  {
    index: 'boon-of-fortitude', name: 'Boon of Fortitude', type: 'epic_boon', prerequisite: 'Level 19+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase one ability score of your choice by 1, to a maximum of 30.\n\n' +
      "**Fortified Health.** Your Hit Point maximum increases by 40. In addition, whenever you regain Hit Points, you can regain additional Hit Points equal to your Constitution modifier. Once you've regained these additional Hit Points, you can't do so again until the start of your next turn.",
  },
  {
    index: 'boon-of-recovery', name: 'Boon of Recovery', type: 'epic_boon', prerequisite: 'Level 19+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase one ability score of your choice by 1, to a maximum of 30.\n\n' +
      "**Last Stand.** When you would be reduced to 0 Hit Points, you can drop to 1 Hit Point instead and regain a number of Hit Points equal to half your Hit Point maximum. Once you use this benefit, you can't use it again until you finish a Long Rest.\n\n" +
      '**Recover Vitality.** You have a pool of ten d10s. As a Bonus Action, you can expend dice from the pool, roll those dice, and regain a number of Hit Points equal to the roll’s total. You regain all the expended dice when you finish a Long Rest.',
  },
  {
    index: 'boon-of-skill', name: 'Boon of Skill', type: 'epic_boon', prerequisite: 'Level 19+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase one ability score of your choice by 1, to a maximum of 30.\n\n' +
      '**All-Around Adept.** You gain proficiency in all skills.\n\n' +
      '**Expertise.** Choose one skill in which you lack Expertise. You gain Expertise in that skill.',
  },
  {
    index: 'boon-of-speed', name: 'Boon of Speed', type: 'epic_boon', prerequisite: 'Level 19+',
    description:
      'You gain the following benefits.\n\n' +
      '**Ability Score Increase.** Increase one ability score of your choice by 1, to a maximum of 30.\n\n' +
      '**Escape Artist.** As a Bonus Action, you can take the Disengage action, which also ends the Grappled condition on you.\n\n' +
      '**Quickness.** Your Speed increases by 9 m.',
  },
];

async function seedFeats(client: Client): Promise<Map<string, number>> {
  const featMap = new Map<string, number>(); // `${edition}:${feat_index}` -> id
  let count = 0;
  for (const edition of EDITIONS) {
    const rows = loadJson(edition, '5e-SRD-Feats.json');
    for (const r of rows) {
      const description = typeof r.description === 'string' ? r.description : (r.desc ?? []).join('\n\n');
      const res = await client.query(
        `INSERT INTO feats (index_key, name, edition_scope, prerequisite, description, type)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (index_key, edition_scope) DO UPDATE SET
           name = EXCLUDED.name, prerequisite = EXCLUDED.prerequisite, description = EXCLUDED.description, type = EXCLUDED.type
         RETURNING id`,
        [r.index, r.name, edition, prerequisiteTextOf(r), description, edition === '2024' ? (FEAT_TYPE_BY_INDEX[r.index] ?? null) : null],
      );
      featMap.set(`${edition}:${r.index}`, res.rows[0].id);
      count++;
    }
  }

  // docs/roadmap/dnd-2024-gap-analysis.md P1-4 (FT-01) — the 58 feats the
  // third-party JSON dataset is missing entirely, hand-authored from
  // docs/players-handbook-2024/Chapter 5- Feats (see
  // SUPPLEMENTAL_2024_FEATS's own comment). Same upsert statement as the
  // JSON-driven loop above, so a reseed stays idempotent.
  for (const f of SUPPLEMENTAL_2024_FEATS) {
    const res = await client.query(
      `INSERT INTO feats (index_key, name, edition_scope, prerequisite, description, type)
       VALUES ($1, $2, '2024', $3, $4, $5)
       ON CONFLICT (index_key, edition_scope) DO UPDATE SET
         name = EXCLUDED.name, prerequisite = EXCLUDED.prerequisite, description = EXCLUDED.description, type = EXCLUDED.type
       RETURNING id`,
      [f.index, f.name, f.prerequisite, f.description, f.type],
    );
    featMap.set(`2024:${f.index}`, res.rows[0].id);
    count++;
  }

  console.log(`  feats: ${count} (75 official 2024 feats + 2014's minimal Grappler-only set)`);
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

// Phase 2 "weapon mastery (2024)" — unlike MAGIC_SCHOOLS/DAMAGE_TYPES just
// below, this one DOES have real dnd5e-srd skill data backing it
// (5e-SRD-Weapon-Mastery-Properties.json, 2024 only — the mechanic doesn't
// exist in 2014), so it's read the same way races/feats/spells are rather
// than hardcoded.
interface WeaponMasteryPropertyJson {
  index: string;
  name: string;
  description: string;
}

async function seedWeaponMasteryProperties(client: Client): Promise<void> {
  const rows = loadJson<WeaponMasteryPropertyJson>('2024', '5e-SRD-Weapon-Mastery-Properties.json');
  for (const r of rows) {
    await client.query(
      `INSERT INTO weapon_mastery_properties (index_key, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (index_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
      [r.index, r.name, r.description],
    );
  }
  console.log(`  weapon mastery properties: ${rows.length}`);
}

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
        // Matches the real unique index (post-UUID-migration:
        // spell_classes_spell_id_coalesce_coalesce1_idx) which coalesces a
        // null class_id/subclass_id to the nil UUID, not the pre-migration
        // integer sentinel -1 — an integer literal here can't be compared
        // against a uuid column at all ("COALESCE types uuid and integer
        // cannot be matched").
        await client.query(
          `INSERT INTO spell_classes (spell_id, class_id, subclass_id)
           VALUES ($1, $2, NULL)
           ON CONFLICT (spell_id, COALESCE(class_id,'00000000-0000-0000-0000-000000000000'::uuid), COALESCE(subclass_id,'00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING`,
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

// Phase 2 "weapon mastery (2024)" — `properties.mastery` (a
// weapon_mastery_properties.index_key) added to all 5 seeded weapons below.
// UNLIKE every other field in this file, this mapping was NOT originally
// sourced from the dnd5e-srd skill's JSON data (which has the 8 mastery
// properties themselves but no per-weapon assignment table) — it was
// transcribed from training-data recollection and had NOT been checked
// against the real book.
//
// docs/roadmap/dnd-2024-gap-analysis.md P1-6 — now cross-checked against
// the verified weapon->mastery table in `.claude/skills/dnd-2024-rules/
// references/equipment-and-weapon-mastery.md` (sourced from this project's
// own docs/players-handbook-2024/Chapter 6, lines 241-281). dagger=Nick,
// shortsword=Vex, longsword=Sap, mace=Sap all matched; shortbow was wrong
// (seeded as 'slow', verified table says 'vex') — fixed below.
const ITEMS: ItemSeed[] = [
  { slug: 'dagger', name: 'Dagger', itemType: 'weapon', rarity: 'mundane', weightLb: 1, costCp: 200, damageDice: '1d4', damageType: 'piercing', properties: { finesse: true, light: true, thrown: { normal: 20, long: 60 }, mastery: 'nick' }, description: 'A simple, easily concealed blade.' },
  { slug: 'shortsword', name: 'Shortsword', itemType: 'weapon', rarity: 'mundane', weightLb: 2, costCp: 1000, damageDice: '1d6', damageType: 'piercing', properties: { finesse: true, light: true, mastery: 'vex' }, description: 'A light, quick martial melee weapon.' },
  { slug: 'longsword', name: 'Longsword', itemType: 'weapon', rarity: 'mundane', weightLb: 3, costCp: 1500, damageDice: '1d8', damageType: 'slashing', properties: { versatile: '1d10', mastery: 'sap' }, description: 'A versatile martial melee weapon; can be wielded with one or two hands.' },
  { slug: 'mace', name: 'Mace', itemType: 'weapon', rarity: 'mundane', weightLb: 4, costCp: 500, damageDice: '1d6', damageType: 'bludgeoning', properties: { mastery: 'sap' }, description: 'A simple bludgeoning weapon favored by clerics who forgo edged weapons.' },
  { slug: 'shortbow', name: 'Shortbow', itemType: 'weapon', rarity: 'mundane', weightLb: 2, costCp: 2500, damageDice: '1d6', damageType: 'piercing', properties: { ammunition: { normal: 80, long: 320 }, two_handed: true, mastery: 'vex' }, description: 'A simple ranged weapon requiring arrows.' },
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

// Non-condition effect templates — spell-driven ones above, plus one
// action-driven one below. "Dodge" isn't one of the 15 SRD conditions (no
// `conditions` catalog row to link via condition_id), but it's still a real
// mechanical state worth tracking as an active_effects row so a DM/player
// can see it's active and it can be auto-cleared — see services/encounters.ts's
// advanceTurn, which soft-removes any live "Dodge" effect for the
// participant whose turn is starting (docs/rules/actions.md's Dodge
// section: "until the start of your next turn", not a round countdown, so
// this can't use the generic `rounds` duration-decrement path the way a
// spell effect would).
const SPELL_EFFECT_DEFINITIONS: Array<{
  name: string; description: string; durationType: string; durationValue: number | null;
  concentration: boolean; stackingRule: 'none' | 'stack' | 'refresh';
  // docs/roadmap/dnd-2024-gap-analysis.md P1-11 — see grantsResistance's own
  // Raging entry below for the full rationale. Omitted (undefined) for
  // every template that doesn't grant a temporary resistance; the seed
  // function defaults it to '{}' either way.
  grantsResistance?: string[];
}> = [
  { name: 'Bless', description: 'Target adds 1d4 to attack rolls and saving throws.', durationType: 'minutes', durationValue: 1, concentration: true, stackingRule: 'refresh' },
  { name: 'Hex', description: 'Extra 1d6 necrotic damage on hit, plus disadvantage on ability checks with a chosen ability.', durationType: 'hours', durationValue: 1, concentration: true, stackingRule: 'refresh' },
  { name: 'Dodge', description: 'Attack rolls against this creature have disadvantage (if the attacker can see it), and it makes Dexterity saving throws with advantage — until the start of its next turn.', durationType: 'until_removed', durationValue: null, concentration: false, stackingRule: 'refresh' },
  // Hide (docs/rules/actions.md's Hide section, 2014-confirmed mechanic —
  // "a creature that can't see you"): grants advantage on this creature's
  // attacks against anyone who can't see it, disadvantage on their attacks
  // against it, and attacking gives away its location. No automatic
  // duration trigger exists for this (unlike Dodge's "start of next turn")
  // — broken by narrated events (being seen/heard, attacking), so the DM
  // removes it manually via the existing effect-remove flow, same as every
  // other until_removed condition without a mechanical end trigger.
  { name: 'Hidden', description: "Advantage on this creature's attacks against creatures that can't see it; disadvantage on their attacks against it. Ends when it's seen or heard, or when it attacks.", durationType: 'until_removed', durationValue: null, concentration: false, stackingRule: 'refresh' },
  // docs/roadmap/dnd-2024-gap-analysis.md P1-6 — Weapon Mastery templates
  // for the 3 properties that create real lingering state (Sap/Vex/Slow).
  // The other 5 properties (Cleave/Graze/Nick/Push/Topple) don't get a
  // template here: Cleave/Graze/Push are "you may immediately do X" and
  // resolve through existing endpoints (a second applyDamage call, a normal
  // token move) with no state to track; Topple's result IS the existing
  // Prone condition (applied via the effects endpoints exactly as any other
  // Prone source would be), not a new template. See services/
  // weaponMastery.ts for how these three are actually triggered — deliberately
  // "track state, don't auto-consult it" per this project's own established
  // philosophy (movement.ts/rests.ts): the advantage/disadvantage/speed
  // reduction these grant is NOT read back into rollDice or movement
  // calculations automatically, only recorded as a visible, DM/player-
  // adjudicated active_effects row. `until_removed` (not a round countdown)
  // for all three, matching Dodge/Hidden above — none of PHB's "before the
  // start/end of your next turn" windows map onto this app's existing
  // rounds-countdown duration type without a turn-boundary trigger this
  // phase doesn't build (same gap already flagged for Dodge/Hidden).
  {
    name: 'Sap (Weapon Mastery)',
    description: 'Disadvantage on this creature\'s next attack roll, before the start of the attacker\'s next turn.',
    durationType: 'until_removed', durationValue: null, concentration: false, stackingRule: 'refresh',
  },
  {
    name: 'Vex (Weapon Mastery)',
    description: 'Advantage on this creature\'s next attack roll against the target named in this effect\'s notes, before the end of its next turn.',
    durationType: 'until_removed', durationValue: null, concentration: false, stackingRule: 'refresh',
  },
  {
    name: 'Slowed (Weapon Mastery)',
    description: 'Speed reduced by 3 m (10 ft) until the start of the attacker\'s next turn. Multiple Slow hits before then don\'t reduce Speed further.',
    durationType: 'until_removed', durationValue: null, concentration: false, stackingRule: 'none',
  },
  // docs/roadmap/dnd-2024-gap-analysis.md P1-11 (CB-02) — the temporary-
  // resistance side of Rage: `grantsResistance` here is unioned with a
  // character's permanent `damage_resistances` at read time (services/
  // characters.ts's applyDamage / services/monsters.ts's
  // applyMonsterInstanceDamage), never written into those permanent
  // columns — exactly the design docs/rules/attacks-and-damage.md §2.4
  // recommended. Text verbatim from this project's own seeded Barbarian
  // "Rage" class_features row (2024, "Damage Resistance" sub-heading):
  // "You have Resistance to Bludgeoning, Piercing, and Slashing damage."
  // `until_removed` (not a round/minute countdown) matches this app's
  // existing precedent for every other class-feature-driven toggle
  // (Dodge/Hidden/the Weapon Mastery templates above) — Rage's real
  // duration rules (ends after 1 minute of inactivity, or early on
  // Unconscious/donning Heavy armor) require turn-boundary tracking this
  // phase doesn't build; the player/DM ends it manually via the existing
  // effect-remove flow, same "track state, DM adjudicates" treatment.
  {
    name: 'Raging',
    description: 'Resistance to Bludgeoning, Piercing, and Slashing damage while this Rage is active.',
    durationType: 'until_removed', durationValue: null, concentration: false, stackingRule: 'none',
    grantsResistance: ['bludgeoning', 'piercing', 'slashing'],
  },
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
    const grantsResistance = s.grantsResistance ?? [];
    const existing = await client.query(
      `SELECT id FROM effect_definitions WHERE name = $1 AND condition_id IS NULL AND is_homebrew = false`,
      [s.name],
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE effect_definitions SET description = $2, default_duration_type = $3, default_duration_value = $4,
           concentration = $5, stacking_rule = $6, grants_resistance = $7 WHERE id = $1`,
        [existing.rows[0].id, s.description, s.durationType, s.durationValue, s.concentration, s.stackingRule, grantsResistance],
      );
    } else {
      await client.query(
        `INSERT INTO effect_definitions
           (condition_id, name, description, default_duration_type, default_duration_value, concentration, stacking_rule, grants_resistance)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)`,
        [s.name, s.description, s.durationType, s.durationValue, s.concentration, s.stackingRule, grantsResistance],
      );
    }
    count++;
  }

  console.log(`  effect_definitions: ${count}`);
}

// Phase 4 "Bastion tracking" sub-phase 1 (bastion_facility_catalog) --
// hand-transcribed, same as MAGIC_SCHOOLS/DAMAGE_TYPES above, since Bastions
// have no dnd5e-srd skill data backing them at all (paid 2024 DMG content,
// no free SRD equivalent). Source: WotC's free "Unearthed Arcana 2023:
// Bastions and Cantrips" playtest PDF, corroborated against the shipped
// final book only where explicitly noted below -- see docs/rules/
// bastions.md for the full sourcing writeup, per-row confidence caveats,
// and the reasoning behind every schema/data choice made here. Every row
// gets the UA-sourced disclaimer via the column default UNLESS overridden
// (only Smithy's prerequisite is independently confirmed final).
const DEFAULT_BASTION_SOURCE_NOTE =
  'UA 2023 playtest text; not independently re-confirmed against final 2024 DMG numeric details -- see docs/rules/bastions.md';
const SMITHY_SOURCE_NOTE =
  'Prerequisite independently confirmed unchanged in the final 2024 DMG via D&D Beyond\'s Nov 2024 DMG preview post -- see docs/rules/bastions.md. Other fields (space/hirelings/BP die/benefits) remain UA-sourced only.';

interface BastionFacilitySeed {
  indexKey: string;
  name: string;
  facilityType: 'basic' | 'special';
  minLevel: number | null;
  prerequisiteText: string | null;
  defaultSpace: 'cramped' | 'roomy' | 'vast' | null;
  hirelingCount: number | null;
  orderType: 'craft' | 'empower' | 'harvest' | 'recruit' | 'research' | 'trade' | null;
  bpDie: string | null;
  benefits: Record<string, unknown> | null;
  sourceNote?: string;
}

const HOLY_FOCUS_PREREQ = 'Ability to use a Holy Symbol or Druidic Focus as a Spellcasting Focus';
const ARCANE_FOCUS_PREREQ = 'Ability to use an Arcane Focus as a Spellcasting Focus';
const FIGHTING_STYLE_OR_UNARMORED_PREREQ = 'Fighting Style feature or Unarmored Defense feature';
const EXPERTISE_PREREQ = 'Expertise in a skill';

const BASTION_BASIC_FACILITIES: BastionFacilitySeed[] = [
  'Bedroom', 'Courtyard', 'Dining Room', 'Kitchen', 'Parlor', 'Storage', 'Washroom',
].map((name) => ({
  indexKey: `bastion_${name.toLowerCase().replace(/\s+/g, '_')}`,
  name,
  facilityType: 'basic',
  minLevel: null,
  prerequisiteText: null,
  defaultSpace: null, // any size may be built/enlarged -- see the shared cost table in docs/rules/bastions.md §2
  hirelingCount: null,
  orderType: null,
  bpDie: null,
  benefits: {
    summary:
      'Flavor/roleplay only -- no orders, no Bastion Points. Any number allowed; built at any size (Cramped/Roomy/Vast) ' +
      'and enlargeable later. GP cost and time to add/enlarge are the SAME shared table across every basic facility type ' +
      '(not modeled per-row here since it does not vary by type) -- see docs/rules/bastions.md §2 for the table.',
  },
}));

const BASTION_SPECIAL_FACILITIES: BastionFacilitySeed[] = [
  {
    indexKey: 'bastion_arcane_study', name: 'Arcane Study', facilityType: 'special', minLevel: 5,
    prerequisiteText: ARCANE_FOCUS_PREREQ, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'craft', bpDie: '1d4',
    benefits: { summary: 'Long-rest at the Bastion -> cast Identify for free, 1x/7 days. Craft: an Arcane Focus, or a blank spellbook.' },
  },
  {
    indexKey: 'bastion_armory', name: 'Armory', facilityType: 'special', minLevel: 5,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'trade', bpDie: '1d4',
    benefits: {
      summary:
        'Trade: stock the Armory (100 GP + 100 GP/defender, halved with a Smithy) -> while stocked, roll d8 instead of ' +
        'd6 per die for defender losses in an Attack event; stock is consumed after any event.',
    },
  },
  {
    indexKey: 'bastion_barracks', name: 'Barracks', facilityType: 'special', minLevel: 5,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 0, orderType: 'recruit', bpDie: '1d4',
    benefits: {
      summary:
        'Houses up to 12 Bastion Defenders. Recruit: +4 defenders at no GP cost (if not already full). Multiple Barracks allowed.',
    },
  },
  {
    indexKey: 'bastion_garden', name: 'Garden', facilityType: 'special', minLevel: 5,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'harvest', bpDie: '1d4',
    benefits: {
      summary:
        'Choose a type at creation (Decorative/Food/Herb/Poison), re-typeable via a 21-day hireling task. Harvest yields: ' +
        'Decorative -> 10 bouquets/perfume (5 GP ea.); Food -> 50 GP of produce; Herb -> a Potion of Healing; Poison -> ' +
        '2 vials Antitoxin or 1 vial Basic Poison. Enlarge to Vast (2,000 GP) = 2 gardens\' worth of yield + 1 more hireling.',
    },
  },
  {
    indexKey: 'bastion_library', name: 'Library', facilityType: 'special', minLevel: 5,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'research', bpDie: '1d4',
    benefits: { summary: 'Research: pick any topic, 7 days -> learn 3 accurate facts (DM-determined).' },
  },
  {
    indexKey: 'bastion_sanctuary', name: 'Sanctuary', facilityType: 'special', minLevel: 5,
    prerequisiteText: HOLY_FOCUS_PREREQ, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'craft', bpDie: '1d4',
    benefits: {
      summary:
        'Long-rest at the Bastion -> cast Healing Word for free, 1x/7 days, at spell level = half character level ' +
        '(rounded down). Craft: a Sacred Focus (Druidic wooden staff or Holy Symbol).',
    },
  },
  {
    indexKey: 'bastion_smithy', name: 'Smithy', facilityType: 'special', minLevel: 5,
    prerequisiteText: FIGHTING_STYLE_OR_UNARMORED_PREREQ, defaultSpace: 'roomy', hirelingCount: 2, orderType: 'craft', bpDie: '1d4',
    benefits: {
      summary:
        'Craft: ammo/Simple weapons at half price, armor/adventuring gear at half price, or Martial weapons at half ' +
        'price -- plus masterwork versions (become permanent +1 items once Magic Weapon is cast on them and ends).',
    },
    sourceNote: SMITHY_SOURCE_NOTE,
  },
  {
    indexKey: 'bastion_storehouse', name: 'Storehouse', facilityType: 'special', minLevel: 5,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'trade', bpDie: '1d4',
    benefits: {
      summary:
        'Trade: procure up to 500 GP of goods (up to 2,000 GP at level 9, up to 5,000 GP at level 13), or sell stored ' +
        'goods for +10% over standard price (+20% at level 9, +50% at level 13, +100% at level 17).',
    },
  },
  {
    indexKey: 'bastion_workshop', name: 'Workshop', facilityType: 'special', minLevel: 5,
    prerequisiteText: EXPERTISE_PREREQ, defaultSpace: 'roomy', hirelingCount: 2, orderType: 'craft', bpDie: '1d4',
    benefits: {
      summary:
        'Short rest at the Bastion -> Heroic Advantage, 1x/long rest. Craft: a Tiny nonmagical object using one of 8 ' +
        'named tool proficiencies, free unless worth 10 GP or more (then half price).',
    },
  },
  {
    indexKey: 'bastion_gaming_hall', name: 'Gaming Hall', facilityType: 'special', minLevel: 9,
    prerequisiteText: null, defaultSpace: 'vast', hirelingCount: 4, orderType: 'trade', bpDie: '1d6',
    benefits: {
      summary:
        'Trade -> gambling den for 7 days, then roll d100 on a Gambling Den Winnings table (payouts scale from 3d6 GP ' +
        'up to 10d6x10 GP).',
    },
  },
  {
    indexKey: 'bastion_greenhouse', name: 'Greenhouse', facilityType: 'special', minLevel: 9,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'harvest', bpDie: '1d6',
    benefits: {
      summary:
        'One plant grows 3 magical fruits/day; eating one grants a Lesser Restoration effect; unpicked fruit loses its ' +
        'magic after 24 hours.',
    },
  },
  {
    indexKey: 'bastion_laboratory', name: 'Laboratory', facilityType: 'special', minLevel: 9,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'craft', bpDie: '1d6',
    benefits: {
      summary:
        'Craft options: a Liquid Concoction (Acid/Alchemist\'s Fire/Ink, half price), a rare Poison, or a magic Potion ' +
        '(cost/min-level scales by rarity; a hireling\'s effective crafting level is half the OWNING CHARACTER\'S level ' +
        'rounded up, but the rarity\'s min-level gate is checked against the owning character\'s own level, not the ' +
        'halved hireling stand-in -- easy to implement backwards, see docs/rules/bastions.md §2 Edge cases).',
    },
  },
  {
    indexKey: 'bastion_sacristy', name: 'Sacristy', facilityType: 'special', minLevel: 9,
    prerequisiteText: HOLY_FOCUS_PREREQ, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'craft', bpDie: '1d6',
    benefits: {
      summary:
        'Short rest at the Bastion -> regain one expended spell slot of 5th level or lower, 1x/long rest. Craft: Holy ' +
        'Water (scalable damage by extra GP spent, up to +5d6) or a temporary Sacred Item (7-day duration, from a fixed ' +
        'list: Pearl of Power, Periapt of Wound Closure, Ring of Water Walking, Sending Stones, Staff of the Adder, ' +
        'Staff of the Python, Wand of Magic Detection).',
    },
  },
  {
    indexKey: 'bastion_scriptorium', name: 'Scriptorium', facilityType: 'special', minLevel: 9,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'craft', bpDie: '1d6',
    benefits: {
      summary:
        'Craft: a Book Replica, up to 50 copies of paperwork (1 GP/copy, distributable within 10 miles), or a magic ' +
        'Scroll (cost/min-level scales by rarity; same hireling-level-vs-owner-level gating caveat as Laboratory above).',
    },
  },
  {
    indexKey: 'bastion_stable', name: 'Stable', facilityType: 'special', minLevel: 9,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'trade', bpDie: '1d6',
    benefits: {
      summary:
        'Comes with 1 Riding Horse/Camel + 2 Ponies/Mules; houses 3 Large-equivalent animals (enlargeable to 6 as Vast, ' +
        '2,000 GP). Trade: buy/sell mounts; sale profit +20% over standard (+50% at level 13, +100% at level 17).',
    },
  },
  {
    indexKey: 'bastion_teleportation_circle', name: 'Teleportation Circle', facilityType: 'special', minLevel: 9,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 0, orderType: 'recruit', bpDie: '1d6',
    benefits: {
      summary:
        'Permanent teleportation circle. Recruit -> invite a friendly Mage (or Archmage at owner level 17+); 50% chance ' +
        'they accept and stay 7 days, can be asked to cast one spell (Wizard spell of 4th level or lower for a Mage, ' +
        '8th or lower for an Archmage; Material costs paid by the owner). Guest does not defend and leaves if the ' +
        'Bastion is attacked.',
    },
  },
  {
    indexKey: 'bastion_theater', name: 'Theater', facilityType: 'special', minLevel: 9,
    prerequisiteText: null, defaultSpace: 'vast', hirelingCount: 4, orderType: 'empower', bpDie: '1d6',
    benefits: {
      summary:
        'Empower -> 14-day rehearsal + an indefinite 7-plus-day performance run. PCs can serve as Composer/Writer, ' +
        'Conductor/Director, or Performer. DC 15 CHA (Performance) check per contributor at rehearsal end; majority ' +
        'success -> each contributor gains a Theater die (d6, upgrading to d8 at level 13, d10 at level 17) usable ' +
        'once to boost a check/attack/save.',
    },
  },
  {
    indexKey: 'bastion_training_area', name: 'Training Area', facilityType: 'special', minLevel: 9,
    prerequisiteText: `${EXPERTISE_PREREQ}, ${FIGHTING_STYLE_OR_UNARMORED_PREREQ}`,
    defaultSpace: 'vast', hirelingCount: 4, orderType: 'empower', bpDie: '1d6',
    benefits: {
      summary:
        'Choose 1 Expert Trainer (Battle/Skills/Tools/Unarmed Combat Expert) from a table; swappable each turn. ' +
        'Empower -> 7 days of training (8h/day) grants the trainer\'s benefit for 7 days to any character who trained ' +
        'the whole time.',
    },
  },
  {
    indexKey: 'bastion_trophy_room', name: 'Trophy Room', facilityType: 'special', minLevel: 9,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'research', bpDie: '1d6',
    benefits: {
      summary:
        'Research: Lore (any topic, 3 accurate facts) or a Trinket Trophy (50% chance of a single-use trinket that ' +
        'casts one spell from a fixed list -- Clairvoyance, Death Ward, Find Traps, Locate Creature, Magic Weapon, ' +
        'Remove Curse, Speak with Dead -- with no components required).',
    },
  },
  {
    indexKey: 'bastion_archive', name: 'Archive', facilityType: 'special', minLevel: 13,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'research', bpDie: '1d8',
    benefits: {
      summary:
        'Holds 1 reference book (advantage on a specific Intelligence skill, per book). Research -> a Legend Lore-' +
        'equivalent info-gathering result in 7 days.',
    },
  },
  {
    indexKey: 'bastion_meditation_chamber', name: 'Meditation Chamber', facilityType: 'special', minLevel: 13,
    prerequisiteText: null, defaultSpace: 'cramped', hirelingCount: 0, orderType: 'empower', bpDie: '1d8',
    benefits: {
      summary:
        'Empower -> can issue one EXTRA order to a different special facility this turn, even one already ordered -- ' +
        'the one documented exception to "one order per facility per turn." Fortify Self: 7 continuous days meditating ' +
        '(cannot leave) -> advantage on 2 random saving throws (Fortified Saves d6 table) for the next 7 days.',
    },
  },
  {
    indexKey: 'bastion_menagerie', name: 'Menagerie', facilityType: 'special', minLevel: 13,
    prerequisiteText: null, defaultSpace: 'vast', hirelingCount: 2, orderType: 'recruit', bpDie: '1d8',
    benefits: {
      summary:
        'Houses 4 Large creatures (or Medium/Small equivalents). Recruit -> add a creature from a Menagerie Creatures ' +
        'table (named beasts with GP costs) or by CR (0=50 GP, 1/4=250, 1/2=500, up to at least CR 3=3,500 GP -- table ' +
        'may extend further; not fully captured in this transcription, do not extrapolate beyond CR 3). Housed ' +
        'creatures count as Bastion Defenders unless the player opts them out.',
    },
  },
  {
    indexKey: 'bastion_observatory', name: 'Observatory', facilityType: 'special', minLevel: 13,
    prerequisiteText: 'Ability to use a Spellcasting Focus', defaultSpace: 'roomy', hirelingCount: 1, orderType: 'empower', bpDie: '1d8',
    benefits: {
      summary:
        'Long rest at the Bastion -> cast Contact Other Plane for free, 1x/7 days. Empower -> 7 nights of stargazing, ' +
        'then roll a die: even = nothing, odd = grants a random supernatural Charm (Darkvision/Heroism/Vitality) to ' +
        'self or an ally on the same plane.',
    },
  },
  {
    indexKey: 'bastion_pub', name: 'Pub', facilityType: 'special', minLevel: 13,
    prerequisiteText: null, defaultSpace: 'roomy', hirelingCount: 1, orderType: 'research', bpDie: '1d8',
    benefits: {
      summary:
        'Research -> Information Gathering: spy-network reports on events within 10 miles, plus the location/movement ' +
        'of any familiar creature within 50 miles, over 7 days. Pub Special: 1 magical beverage on tap (a Pub Special ' +
        'table -- e.g. an Enlarge effect, Spider Climb, extended Darkvision, Necrotic resistance, Frightened immunity ' +
        '-- 24h duration, swappable between turns). Enlarge to Vast (2,000 GP) -> 2 beverages on tap + 3 more ' +
        'hirelings (4 total).',
    },
  },
  {
    indexKey: 'bastion_reliquary', name: 'Reliquary', facilityType: 'special', minLevel: 13,
    prerequisiteText: HOLY_FOCUS_PREREQ, defaultSpace: 'cramped', hirelingCount: 1, orderType: 'harvest', bpDie: '1d8',
    benefits: {
      summary:
        'Long rest at the Bastion -> cast Greater Restoration for free, 1x/7 days. Harvest -> craft a single-use Tiny ' +
        'talisman usable once as a Spellcasting Focus that ignores Material components (even costly ones up to 1,000 GP).',
    },
  },
  {
    indexKey: 'bastion_demiplane', name: 'Demiplane', facilityType: 'special', minLevel: 17,
    prerequisiteText: ARCANE_FOCUS_PREREQ, defaultSpace: 'vast', hirelingCount: 0, orderType: 'empower', bpDie: '1d10',
    benefits: {
      summary:
        'Extradimensional room, scry-proof. Empower (7 days) -> temp HP = 5x level after a long rest there. ' +
        'Fabrication: Magic action, 1x/long rest, create a nonmagical object of 5-ft cube or smaller from mundane materials.',
    },
  },
  {
    indexKey: 'bastion_guildhall', name: 'Guildhall', facilityType: 'special', minLevel: 17,
    prerequisiteText: EXPERTISE_PREREQ, defaultSpace: 'vast', hirelingCount: 0, orderType: 'recruit', bpDie: '1d10',
    benefits: {
      summary:
        'Comes with a roughly 50-member guild of a chosen type (Sample Guilds table: Adventurers\', Bakers\', ' +
        'Brewers\', Cartographers\', Entertainers\', Jewelers\', Masons\', Shipbuilders\', Thieves\'). Recruit -> ' +
        'assign the guild a themed task (guild-specific).',
    },
  },
  {
    indexKey: 'bastion_sanctum', name: 'Sanctum', facilityType: 'special', minLevel: 17,
    prerequisiteText: HOLY_FOCUS_PREREQ, defaultSpace: 'roomy', hirelingCount: 4, orderType: 'empower', bpDie: '1d10',
    benefits: {
      summary:
        'Long rest at the Bastion -> cast Heal for free, 1x/7 days. Empower -> daily rites grant temp HP = character ' +
        'level to self or a chosen ally after each long rest, for 7 days. Sanctum Recall: Word of Recall can target ' +
        'the Sanctum even overriding a previously chosen destination; the arriving creature also gets a Heal effect.',
    },
  },
  {
    indexKey: 'bastion_war_room', name: 'War Room', facilityType: 'special', minLevel: 17,
    prerequisiteText: FIGHTING_STYLE_OR_UNARMORED_PREREQ, defaultSpace: 'vast', hirelingCount: null, orderType: 'recruit', bpDie: '1d10',
    benefits: {
      summary:
        'Hireling count varies: comes with 2 Lieutenants (Veteran stat block, owner\'s alignment), growing to a max of ' +
        '10 via Recruit. Lieutenants do not count as Bastion Defenders, but each housed Lieutenant reduces attack-' +
        'event defender-loss dice by 1. Recruit: gain a Lieutenant (max 10), or muster Soldiers (each Lieutenant ' +
        'recruits 100 Guards, or 20 mounted, fed at 1 GP/day/unit, disbands if unfed or unled).',
    },
  },
];

const BASTION_FACILITY_CATALOG_SEED: BastionFacilitySeed[] = [...BASTION_BASIC_FACILITIES, ...BASTION_SPECIAL_FACILITIES];

async function seedBastionFacilityCatalog(client: Client): Promise<void> {
  for (const f of BASTION_FACILITY_CATALOG_SEED) {
    await client.query(
      `INSERT INTO bastion_facility_catalog
         (index_key, name, facility_type, min_level, prerequisite_text, default_space, hireling_count, order_type, bp_die, benefits, source_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (index_key) DO UPDATE SET
         name = EXCLUDED.name, facility_type = EXCLUDED.facility_type, min_level = EXCLUDED.min_level,
         prerequisite_text = EXCLUDED.prerequisite_text, default_space = EXCLUDED.default_space,
         hireling_count = EXCLUDED.hireling_count, order_type = EXCLUDED.order_type, bp_die = EXCLUDED.bp_die,
         benefits = EXCLUDED.benefits, source_note = EXCLUDED.source_note`,
      [
        f.indexKey, f.name, f.facilityType, f.minLevel, f.prerequisiteText, f.defaultSpace, f.hirelingCount,
        f.orderType, f.bpDie, f.benefits ? JSON.stringify(f.benefits) : null, f.sourceNote ?? DEFAULT_BASTION_SOURCE_NOTE,
      ],
    );
  }
  console.log(`  bastion_facility_catalog: ${BASTION_FACILITY_CATALOG_SEED.length}`);
}
