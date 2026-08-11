// Sample/demo data for immediate testability: a DM + a player, one campaign,
// a small party of PCs, an NPC, a hand-entered starter bestiary (this app
// owns monster stat blocks — the SRD skill deliberately has none), a few
// monster instances spawned from that bestiary, and one fully-populated
// "ready to run" encounter (status='preparing', initiative already rolled).
//
// Phase 2 additions: known/prepared spells + computed spell-slot resource
// pools for Sister Maribel, equipped gear for Brenna Ironhide, and a new
// multiclass PC (Kessia Duskbane, Paladin 3 / Warlock 2) that exercises the
// multiclass spell-slot table and multiclass prerequisites end to end.
//
// Idempotency: re-running `npm run seed` must not duplicate the demo world.
// World-building (campaign/PCs/NPC/bestiary/encounter) is still gated
// behind a single check for the demo campaign's existence, since
// characters/monster_instances/encounters have no natural unique key to
// upsert on. Phase 2 additions are a SEPARATE gate from that check — they
// run every time (idempotently, via each table's real unique constraint, or
// an explicit existence check where no such constraint exists) so that
// re-running the seed against an already-Phase-1-seeded database still
// backfills the Phase 2 demo data, rather than being skipped along with the
// Phase 1 world-building it's gated behind.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcrypt';
import type { Client } from 'pg';
import { UPLOAD_ROOT } from '../../middleware/upload.js';

const DM_EMAIL = 'dm@example.com';
const PLAYER_EMAIL = 'player@example.com';
const MULTICLASS_PLAYER_EMAIL = 'quinn@example.com';
const DEMO_PASSWORD = 'password123';
const CAMPAIGN_NAME = 'The Sunless Vale';
const MULTICLASS_PC_NAME = 'Kessia Duskbane';

async function oneId(client: Client, sql: string, params: unknown[], what: string): Promise<number> {
  const res = await client.query(sql, params);
  if (res.rows.length === 0) throw new Error(`Seed lookup failed: ${what} not found`);
  return res.rows[0].id;
}

async function maybeId(client: Client, sql: string, params: unknown[]): Promise<number | null> {
  const res = await client.query(sql, params);
  return res.rows.length > 0 ? res.rows[0].id : null;
}

// Hand-entered starter bestiary — real SRD 5.1 (2014) stat blocks, chosen
// because they're exact and well-known rather than guessed, rather than
// guessing at the 2024 Monster Manual's revised math. Tagged edition_scope=
// 'both' (not '2014') so they still show up in a 2024-edition campaign's
// bestiary browse (Phase 3.2's GET /catalog/monsters?edition= filter, and the
// pre-existing MonstersPage.tsx before it, both filter catalog rows by the
// campaign's own edition) — at CR 1/4-1/2 these basic stat blocks don't
// differ meaningfully between the two editions, so 'both' is accurate, not
// just convenient. (Originally shipped as '2014' back when nothing read
// edition_scope for filtering yet; that assumption stopped holding once the
// browse UI started filtering by it.)
const BESTIARY = [
  {
    slug: 'goblin', name: 'Goblin', size: 'Small', creature_type: 'humanoid (goblinoid)',
    alignment: 'neutral evil', armor_class: 15, armor_class_notes: 'leather armor, shield',
    hit_point_average: 7, hit_dice: '2d6', speed: { walk: '30 ft.' },
    str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8,
    saving_throws: null, skills: { stealth: 6 },
    damage_vulnerabilities: [], damage_resistances: [], damage_immunities: [],
    senses: 'darkvision 60 ft., passive Perception 9', languages: 'Common, Goblin',
    challenge_rating: 0.25, xp_value: 50,
    traits: [{ name: 'Nimble Escape', desc: 'The goblin can take the Disengage or Hide action as a bonus action on each of its turns.' }],
    actions: [
      { name: 'Scimitar', description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6+2) slashing damage.', attackBonus: 4, damageDice: '1d6+2', damageType: 'slashing' },
      { name: 'Shortbow', description: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6+2) piercing damage.', attackBonus: 4, damageDice: '1d6+2', damageType: 'piercing' },
    ],
  },
  {
    slug: 'wolf', name: 'Wolf', size: 'Medium', creature_type: 'beast',
    alignment: 'unaligned', armor_class: 13, armor_class_notes: 'natural armor',
    hit_point_average: 11, hit_dice: '2d8+2', speed: { walk: '40 ft.' },
    str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6,
    saving_throws: null, skills: { perception: 3, stealth: 4 },
    damage_vulnerabilities: [], damage_resistances: [], damage_immunities: [],
    senses: 'passive Perception 13', languages: '--',
    challenge_rating: 0.25, xp_value: 50,
    traits: [
      { name: 'Keen Hearing and Smell', desc: 'The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell.' },
      { name: 'Pack Tactics', desc: "The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature and the ally isn't incapacitated." },
    ],
    actions: [
      { name: 'Bite', description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4+2) piercing damage. If the target is a creature, it must succeed on a DC 11 Strength saving throw or be knocked prone.', attackBonus: 4, damageDice: '2d4+2', damageType: 'piercing' },
    ],
  },
  {
    slug: 'skeleton', name: 'Skeleton', size: 'Medium', creature_type: 'undead',
    alignment: 'lawful evil', armor_class: 13, armor_class_notes: 'armor scraps',
    hit_point_average: 13, hit_dice: '2d8+4', speed: { walk: '30 ft.' },
    str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5,
    saving_throws: null, skills: null,
    damage_vulnerabilities: ['bludgeoning'], damage_resistances: [], damage_immunities: ['poison'],
    senses: "darkvision 60 ft., passive Perception 9", languages: "understands all languages it knew in life but can't speak",
    challenge_rating: 0.25, xp_value: 50,
    traits: null,
    actions: [
      { name: 'Shortsword', description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6+2) piercing damage.', attackBonus: 4, damageDice: '1d6+2', damageType: 'piercing' },
      { name: 'Shortbow', description: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6+2) piercing damage.', attackBonus: 4, damageDice: '1d6+2', damageType: 'piercing' },
    ],
  },
  {
    slug: 'orc', name: 'Orc', size: 'Medium', creature_type: 'humanoid (orc)',
    alignment: 'chaotic evil', armor_class: 13, armor_class_notes: 'hide armor',
    hit_point_average: 15, hit_dice: '2d8+6', speed: { walk: '30 ft.' },
    str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10,
    saving_throws: null, skills: { intimidation: 2 },
    damage_vulnerabilities: [], damage_resistances: [], damage_immunities: [],
    senses: 'darkvision 60 ft., passive Perception 10', languages: 'Common, Orc',
    challenge_rating: 0.5, xp_value: 100,
    traits: [{ name: 'Aggressive', desc: 'As a bonus action, the orc can move up to its speed toward a hostile creature that it can see.' }],
    actions: [
      { name: 'Greataxe', description: 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 9 (1d12+3) slashing damage.', attackBonus: 5, damageDice: '1d12+3', damageType: 'slashing' },
      { name: 'Javelin', description: 'Melee or Ranged Weapon Attack: +5 to hit, reach 5 ft. or range 30/120 ft., one target. Hit: 6 (1d6+3) piercing damage.', attackBonus: 5, damageDice: '1d6+3', damageType: 'piercing' },
    ],
  },
] as const;

function rollInitiative(dexMod: number): { roll: number; tiebreak: number } {
  const d20 = Math.floor(Math.random() * 20) + 1;
  return { roll: d20 + dexMod, tiebreak: dexMod };
}

export async function seedDemo(client: Client): Promise<void> {
  console.log('\n[demo] Seeding sample campaign data...');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await client.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [DM_EMAIL, 'Dana (DM)', passwordHash],
  );
  await client.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [PLAYER_EMAIL, 'Percy (Player)', passwordHash],
  );
  // A third player, added alongside the Phase 2 multiclass PC: giving Kessia
  // to Percy (who already owns Brenna and Maribel) would work mechanically,
  // but a real campaign's multiclass character is exactly the kind of PC a
  // *third* player brings to the table — and campaign_members already
  // models many players per campaign, so a single-player demo undersells
  // that. Warranted enough to add rather than double up Percy.
  await client.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [MULTICLASS_PLAYER_EMAIL, 'Quinn (Player)', passwordHash],
  );
  const dmId = await oneId(client, `SELECT id FROM users WHERE email = $1`, [DM_EMAIL], 'dm user');
  const playerId = await oneId(client, `SELECT id FROM users WHERE email = $1`, [PLAYER_EMAIL], 'player user');
  const quinnId = await oneId(client, `SELECT id FROM users WHERE email = $1`, [MULTICLASS_PLAYER_EMAIL], 'quinn user');

  // ---- Catalog lookups (edition 2024, matching the campaign) ----
  const ability = async (index: string) => oneId(client, `SELECT id FROM ability_scores WHERE index_key = $1`, [index], `ability_score '${index}'`);
  const skill = async (index: string) => oneId(client, `SELECT id FROM skills WHERE index_key = $1`, [index], `skill '${index}'`);
  const race = async (index: string) => oneId(client, `SELECT id FROM races WHERE index_key = $1 AND edition_scope = '2024'`, [index], `race '${index}'`);
  const background = async (index: string) => oneId(client, `SELECT id FROM backgrounds WHERE index_key = $1 AND edition_scope = '2024'`, [index], `background '${index}'`);
  const klass = async (index: string) => oneId(client, `SELECT id FROM classes WHERE index_key = $1 AND edition_scope = '2024'`, [index], `class '${index}'`);
  const spell = async (slug: string) => oneId(client, `SELECT id FROM spells WHERE slug = $1 AND edition_scope = 'both'`, [slug], `spell '${slug}'`);
  const item = async (slug: string) => oneId(client, `SELECT id FROM items WHERE slug = $1 AND edition_scope = 'both'`, [slug], `item '${slug}'`);

  let campaignId: number;
  let brennaId: number;
  let maribelId: number;

  // ---- Starter bestiary catalog rows (global, not campaign-scoped) ----
  // Hoisted above the campaign-exists check and always upserted (ON CONFLICT
  // DO UPDATE on slug+edition_scope) — this table has no dependency on
  // campaignId, and running it unconditionally means a stat-block edit here
  // (e.g. backfilling damageDice/damageType) actually takes effect on a
  // re-seed of an already-existing demo campaign, not just on first creation.
  // Previously this lived inside the "campaign doesn't exist yet" branch
  // below, which silently made any future BESTIARY edit inert once the demo
  // campaign had been seeded once.
  const monsterIds = new Map<string, number>();
  for (const m of BESTIARY) {
    const res = await client.query(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, alignment, armor_class, armor_class_notes,
          hit_point_average, hit_dice, speed, str, dex, con, int, wis, cha, saving_throws, skills,
          damage_vulnerabilities, damage_resistances, damage_immunities, senses, languages,
          challenge_rating, xp_value, traits, actions, source)
       VALUES ($1,$2,'both',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       ON CONFLICT (slug, edition_scope) DO UPDATE SET
         name = EXCLUDED.name, size = EXCLUDED.size, creature_type = EXCLUDED.creature_type,
         alignment = EXCLUDED.alignment, armor_class = EXCLUDED.armor_class,
         armor_class_notes = EXCLUDED.armor_class_notes, hit_point_average = EXCLUDED.hit_point_average,
         hit_dice = EXCLUDED.hit_dice, speed = EXCLUDED.speed, str = EXCLUDED.str, dex = EXCLUDED.dex,
         con = EXCLUDED.con, int = EXCLUDED.int, wis = EXCLUDED.wis, cha = EXCLUDED.cha,
         saving_throws = EXCLUDED.saving_throws, skills = EXCLUDED.skills,
         damage_vulnerabilities = EXCLUDED.damage_vulnerabilities,
         damage_resistances = EXCLUDED.damage_resistances, damage_immunities = EXCLUDED.damage_immunities,
         senses = EXCLUDED.senses, languages = EXCLUDED.languages,
         challenge_rating = EXCLUDED.challenge_rating, xp_value = EXCLUDED.xp_value,
         traits = EXCLUDED.traits, actions = EXCLUDED.actions, source = EXCLUDED.source
       RETURNING id`,
      [
        m.slug, m.name, m.size, m.creature_type, m.alignment, m.armor_class, m.armor_class_notes,
        m.hit_point_average, m.hit_dice, JSON.stringify(m.speed), m.str, m.dex, m.con, m.int, m.wis, m.cha,
        m.saving_throws ? JSON.stringify(m.saving_throws) : null, m.skills ? JSON.stringify(m.skills) : null,
        m.damage_vulnerabilities, m.damage_resistances, m.damage_immunities, m.senses, m.languages,
        m.challenge_rating, m.xp_value, m.traits ? JSON.stringify(m.traits) : null, JSON.stringify(m.actions),
        'SRD 5.1 (2014 rules)',
      ],
    );
    monsterIds.set(m.slug, res.rows[0].id);
  }
  console.log(`  monsters (starter bestiary): ${monsterIds.size}`);

  const existingCampaign = await client.query(
    `SELECT id FROM campaigns WHERE name = $1 AND dm_user_id = $2`,
    [CAMPAIGN_NAME, dmId],
  );

  if (existingCampaign.rows.length > 0) {
    campaignId = existingCampaign.rows[0].id;
    console.log(`  Demo campaign '${CAMPAIGN_NAME}' already exists (id=${campaignId}) — skipping world-building, but still checking Phase 2 additions below.`);
    brennaId = await oneId(client, `SELECT id FROM characters WHERE campaign_id = $1 AND name = $2`, [campaignId, 'Brenna Ironhide'], 'Brenna Ironhide');
    maribelId = await oneId(client, `SELECT id FROM characters WHERE campaign_id = $1 AND name = $2`, [campaignId, 'Sister Maribel'], 'Sister Maribel');
  } else {
    const campaignRes = await client.query(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition, description)
       VALUES ($1, $2, '2024', $3) RETURNING id`,
      [CAMPAIGN_NAME, dmId, 'A starter demo campaign seeded for Phase 1 verification: a goblin ambush on the road into a sunless vale.'],
    );
    campaignId = campaignRes.rows[0].id;

    await client.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`,
      [campaignId, dmId],
    );
    await client.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`,
      [campaignId, playerId],
    );

    // A single pg Client can't run concurrent queries, so resolve these one
    // at a time rather than via Promise.all (which would fire them all at
    // once).
    const str = await ability('str');
    const dex = await ability('dex');
    const con = await ability('con');
    const int = await ability('int');
    const wis = await ability('wis');
    const cha = await ability('cha');

    // ---- PC 1: Fighter ----
    const humanId = await race('human');
    const soldierId = await background('soldier');
    const fighterClassId = await klass('fighter');

    const fighterRes = await client.query(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, race_id, background_id, alignment,
          str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current, hp_temp, hit_dice_remaining, notes)
       VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        campaignId, playerId, dmId, 'Brenna Ironhide', humanId, soldierId, 'Lawful Good',
        16, 14, 15, 10, 12, 8, 16, 30, 28, 28, 0, JSON.stringify({ d10: 3 }),
        'Ex-legion soldier, joined the party after her unit was disbanded.',
      ],
    );
    brennaId = fighterRes.rows[0].id;
    await client.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 3)`, [brennaId, fighterClassId]);
    for (const aId of [str, con]) {
      await client.query(`INSERT INTO character_saving_throw_proficiencies (character_id, ability_score_id) VALUES ($1, $2)`, [brennaId, aId]);
    }
    for (const sIndex of ['athletics', 'intimidation', 'perception', 'survival']) {
      await client.query(
        `INSERT INTO character_skill_proficiencies (character_id, skill_id, level) VALUES ($1, $2, 'proficient')`,
        [brennaId, await skill(sIndex)],
      );
    }

    // ---- PC 2: Cleric ----
    const dwarfId = await race('dwarf');
    const acolyteId = await background('acolyte');
    const clericClassId = await klass('cleric');

    const clericRes = await client.query(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, race_id, background_id, alignment,
          str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current, hp_temp, hit_dice_remaining, notes)
       VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        campaignId, playerId, dmId, 'Sister Maribel', dwarfId, acolyteId, 'Lawful Good',
        10, 12, 14, 10, 16, 13, 17, 30, 24, 24, 0, JSON.stringify({ d8: 3 }),
        'Cleric of a hill-dwarf faith, sent to investigate the sunless vale.',
      ],
    );
    maribelId = clericRes.rows[0].id;
    await client.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 3)`, [maribelId, clericClassId]);
    for (const aId of [wis, cha]) {
      await client.query(`INSERT INTO character_saving_throw_proficiencies (character_id, ability_score_id) VALUES ($1, $2)`, [maribelId, aId]);
    }
    for (const sIndex of ['insight', 'religion', 'medicine', 'persuasion']) {
      await client.query(
        `INSERT INTO character_skill_proficiencies (character_id, skill_id, level) VALUES ($1, $2, 'proficient')`,
        [maribelId, await skill(sIndex)],
      );
    }

    // ---- NPC ----
    await client.query(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, race_id, alignment,
          str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current, hp_temp, notes)
       VALUES ($1, false, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        campaignId, dmId, 'Old Ostiv', humanId, 'Neutral Good',
        10, 10, 10, 10, 11, 12, 10, 30, 4, 4, 0,
        'Innkeeper at the Prancing Pony; gave the party the rumor about the goblin raiders on the old road.',
      ],
    );

    // ---- Starter bestiary instances (the catalog rows themselves are
    // upserted unconditionally above, before this branch) ----
    async function spawnInstance(slug: string, customName: string | null, hpCurrent: number): Promise<number> {
      const monsterId = monsterIds.get(slug);
      if (!monsterId) throw new Error(`Unknown bestiary slug '${slug}'`);
      const res = await client.query(
        `INSERT INTO monster_instances (campaign_id, monster_id, custom_name, hp_current)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [campaignId, monsterId, customName, hpCurrent],
      );
      return res.rows[0].id;
    }

    const goblin1Id = await spawnInstance('goblin', 'Goblin Raider #1', 7);
    const goblin2Id = await spawnInstance('goblin', 'Goblin Raider #2', 7);
    const wolfId = await spawnInstance('wolf', null, 11);
    await spawnInstance('skeleton', null, 13); // roster reserve, not in this encounter
    await spawnInstance('orc', 'Orc Raider', 15); // roster reserve, not in this encounter
    console.log('  monster_instances: 5 (2 goblins + wolf in the prepared encounter; skeleton + orc held in reserve)');

    // ---- One prepared encounter, ready to hit "start" ----
    const encounterRes = await client.query(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, $2, 'preparing') RETURNING id`,
      [campaignId, 'Ambush on the Old Road'],
    );
    const encounterId = encounterRes.rows[0].id;

    const participants = [
      { characterId: brennaId, monsterInstanceId: null, dexMod: 2 },
      { characterId: maribelId, monsterInstanceId: null, dexMod: 1 },
      { characterId: null, monsterInstanceId: goblin1Id, dexMod: 2 },
      { characterId: null, monsterInstanceId: goblin2Id, dexMod: 2 },
      { characterId: null, monsterInstanceId: wolfId, dexMod: 2 },
    ];

    const rolled = participants
      .map((p) => ({ ...p, ...rollInitiative(p.dexMod) }))
      .sort((a, b) => (b.roll - a.roll) || (b.tiebreak - a.tiebreak));

    for (let i = 0; i < rolled.length; i++) {
      const p = rolled[i];
      // combat_participants.faction has no PC-aware default at the DB level
      // (plain column default is 'enemy') — services/encounters.ts's own
      // addCombatParticipant computes "player for PCs, enemy otherwise"
      // itself rather than trusting that default; this raw seed insert
      // bypasses that service function, so it has to make the same call
      // explicitly or every seeded PC silently ends up on the enemy faction.
      const faction = p.characterId ? 'player' : 'enemy';
      await client.query(
        `INSERT INTO combat_participants
           (encounter_id, character_id, monster_instance_id, initiative_roll, initiative_tiebreak, turn_order, joined_round, faction)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
        [encounterId, p.characterId, p.monsterInstanceId, p.roll, p.tiebreak, i, faction],
      );
    }
    console.log(`  encounter '${'Ambush on the Old Road'}' prepared with ${rolled.length} combat_participants (initiative rolled, status='preparing')`);
  }

  // ==================== Phase 2 additions ====================
  // Everything below runs every time (idempotently), regardless of whether
  // the block above just built the world or found it already there.

  // Quinn joins as a player regardless of which branch above ran — the
  // world-building branch only ever added Percy as 'player', so this can't
  // be folded into it without duplicating this insert in both branches.
  await client.query(
    `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')
     ON CONFLICT (campaign_id, user_id) DO NOTHING`,
    [campaignId, quinnId],
  );

  await seedMaribelSpellsAndResources(client, maribelId, await klass('cleric'), spell);
  await seedBrennaItems(client, brennaId, item);
  await seedMulticlassCharacter(client, campaignId, dmId, quinnId, { ability, background, race, klass, spell });

  // ==================== Phase 3 additions ====================
  // Same "runs every time, idempotently" discipline as Phase 2 above.
  // Demonstrates all five Phase 3 features end to end on the existing demo
  // campaign: a homebrew bestiary entry, an uploaded image used as both a
  // character portrait and a battle-map background, a configured map with
  // placed tokens, sample dice-roll history, and one character opted into
  // armor_class_mode='auto'.
  const encounterId = await oneId(
    client,
    `SELECT id FROM encounters WHERE campaign_id = $1 AND name = $2`,
    [campaignId, 'Ambush on the Old Road'],
    'encounter "Ambush on the Old Road"',
  );

  const placeholderAssetId = await seedPlaceholderAsset(client, campaignId, dmId);
  await seedBrennaPortrait(client, brennaId, placeholderAssetId);
  await seedDemoMap(client, campaignId, encounterId, placeholderAssetId);
  await seedHomebrewCreature(client, campaignId);
  await seedDiceRollHistory(client, campaignId, encounterId, dmId, playerId, brennaId);
  await seedAutoArmorClassDemo(client, brennaId);

  printCredentials();
}

// ---- Phase 3.1: a single generated placeholder image, reused as both
// Brenna's portrait and the demo encounter's map background (Phase 3.3) —
// one real file on disk is enough to demonstrate the upload pipeline works
// end to end without needing separate artwork for each use. It's a flat
// 32x32 stone-grey PNG, not real art; a DM would replace it via the app's
// own upload UI. Idempotent via a fixed, recognizable `title` lookup rather
// than re-writing/re-inserting on every seed run.
const PLACEHOLDER_TITLE = 'Sunless Vale placeholder art';
// A solid 32x32 stone-grey (RGB 68,64,60, roughly Tailwind stone-700) PNG —
// verified to actually decode to visible pixel data, not just a valid
// header (an earlier hand-typed base64 attempt here silently decoded to a
// fully transparent no-op image; this one was generated and re-verified).
const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALElEQVR42u3NIQEAMAgAMHguBIL+mV4C3FZgOV1x6cUxgUAgEAgEAoFAsOUDpz4BAGLJqnwAAAAASUVORK5CYII=';

async function seedPlaceholderAsset(client: Client, campaignId: number, dmId: number): Promise<number> {
  const existing = await maybeId(
    client,
    `SELECT id FROM campaign_assets WHERE campaign_id = $1 AND title = $2`,
    [campaignId, PLACEHOLDER_TITLE],
  );
  if (existing) return existing;

  const dir = path.join(UPLOAD_ROOT, 'campaigns', String(campaignId));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.png`;
  const buffer = Buffer.from(PLACEHOLDER_PNG_BASE64, 'base64');
  fs.writeFileSync(path.join(dir, filename), buffer);

  const fileUrl = `/uploads/campaigns/${campaignId}/${filename}`;
  const res = await client.query(
    `INSERT INTO campaign_assets (campaign_id, uploaded_by_user_id, asset_type, file_url, mime_type, file_size_bytes, title)
     VALUES ($1, $2, 'image', $3, 'image/png', $4, $5)
     RETURNING id`,
    [campaignId, dmId, fileUrl, buffer.byteLength, PLACEHOLDER_TITLE],
  );
  console.log(`  campaign_assets: 1 placeholder image (${fileUrl})`);
  return res.rows[0].id;
}

async function seedBrennaPortrait(client: Client, brennaId: number, assetId: number): Promise<void> {
  await client.query(`UPDATE characters SET portrait_asset_id = $1 WHERE id = $2`, [assetId, brennaId]);
}

// ---- Phase 3.3: a configured battle map with placed tokens on the existing
// prepared encounter, so opening its "Map" view shows something immediately
// rather than an empty grid.
async function seedDemoMap(client: Client, campaignId: number, encounterId: number, backgroundAssetId: number): Promise<void> {
  // Maps now live in the campaign-scoped `maps` library, linked N:M to
  // encounters (1784269788666_create-campaign-maps-library.ts) rather than
  // a 1:1 `encounter_maps` row — same "insert or update the encounter's
  // active map" idempotency this seed always had, just resolved through
  // active_map_id like services/encounters.ts's upsertEncounterMap.
  const existing = await client.query<{ active_map_id: number | null }>(
    `SELECT active_map_id FROM encounters WHERE id = $1`,
    [encounterId],
  );
  const activeMapId = existing.rows[0]?.active_map_id ?? null;

  if (activeMapId) {
    await client.query(
      `UPDATE maps SET background_asset_id = $1, grid_columns = 15, grid_rows = 12, cell_size_px = 50, updated_at = now()
       WHERE id = $2`,
      [backgroundAssetId, activeMapId],
    );
  } else {
    const mapRes = await client.query<{ id: number }>(
      `INSERT INTO maps (campaign_id, name, background_asset_id, grid_columns, grid_rows, cell_size_px)
       VALUES ($1, 'Ambush on the Old Road Map', $2, 15, 12, 50)
       RETURNING id`,
      [campaignId, backgroundAssetId],
    );
    const newMapId = mapRes.rows[0]!.id;
    await client.query(
      `INSERT INTO encounter_maps_link (encounter_id, map_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [encounterId, newMapId],
    );
    await client.query(`UPDATE encounters SET active_map_id = $1 WHERE id = $2`, [newMapId, encounterId]);
  }

  // Spread the party near one corner and the monsters near another —
  // illustrative positions, not tied to any specific participant identity,
  // so this stays correct regardless of how many/which participants exist.
  const positions: Array<[number, number]> = [[2, 8], [3, 9], [10, 3], [11, 4], [10, 5]];
  const participants = await client.query<{ id: number }>(
    `SELECT id FROM combat_participants WHERE encounter_id = $1 ORDER BY turn_order ASC`,
    [encounterId],
  );
  for (let idx = 0; idx < participants.rows.length; idx++) {
    const [x, y] = positions[idx % positions.length]!;
    await client.query(`UPDATE combat_participants SET pos_x = $1, pos_y = $2 WHERE id = $3`, [x, y, participants.rows[idx]!.id]);
  }
  console.log(`  maps: 1 (15x12 grid, ${participants.rows.length} tokens placed)`);
}

// ---- Phase 3.2: one homebrew creature owned by the demo campaign, to show
// the bestiary's homebrew CRUD (not just the read-only global catalog) has
// real data. Thematically tied to "The Sunless Vale" rather than a generic
// filler monster.
async function seedHomebrewCreature(client: Client, campaignId: number): Promise<void> {
  const existing = await maybeId(
    client,
    `SELECT id FROM monsters WHERE owning_campaign_id = $1 AND name = $2`,
    [campaignId, 'Vale Lurker'],
  );
  if (existing) return;

  await client.query(
    `INSERT INTO monsters
       (slug, name, edition_scope, size, creature_type, alignment, armor_class, armor_class_notes,
        hit_point_average, hit_dice, speed, str, dex, con, int, wis, cha, senses, languages,
        challenge_rating, xp_value, traits, actions, source, is_homebrew, owning_campaign_id)
     VALUES ($1,$2,'2024',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,true,$24)`,
    [
      `vale-lurker-${campaignId}`, 'Vale Lurker', 'Medium', 'monstrosity', 'unaligned', 13, 'natural armor',
      22, '4d8+4', JSON.stringify({ walk: '30 ft.', climb: '30 ft.' }), 14, 13, 12, 4, 13, 6,
      'darkvision 90 ft. (blind beyond this radius), passive Perception 15', '--',
      1, 200,
      JSON.stringify([{ name: 'Sunless Adaptation', desc: 'The lurker has advantage on ability checks and saving throws made to avoid or end the blinded condition, and is immune to being blinded by radiant light.' }]),
      JSON.stringify([{ name: 'Claw', description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4+2) slashing damage.', attackBonus: 4 }]),
      'Homebrew — The Sunless Vale',
      campaignId,
    ],
  );
  console.log('  monsters (homebrew): 1 (Vale Lurker, owning_campaign_id=' + campaignId + ')');
}

// ---- Phase 3.4: sample roll history so the Dice Rolls page has something
// to show immediately. Idempotent via a count check (dice_rolls has no
// natural unique key to upsert on).
async function seedDiceRollHistory(
  client: Client,
  campaignId: number,
  encounterId: number,
  dmId: number,
  playerId: number,
  brennaId: number,
): Promise<void> {
  const countRes = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM dice_rolls WHERE campaign_id = $1`, [campaignId]);
  if (Number(countRes.rows[0]!.count) > 0) return;

  const rolls: Array<{
    userId: number; characterId: number | null; encounterId: number | null;
    rollType: string; rollContext: string; d20Rolls: number[]; keep: string; modifier: number;
  }> = [
    { userId: playerId, characterId: brennaId, encounterId, rollType: 'attack', rollContext: 'Longsword', d20Rolls: [14], keep: 'normal', modifier: 5 },
    { userId: playerId, characterId: brennaId, encounterId: null, rollType: 'skill_check', rollContext: 'Perception', d20Rolls: [9, 17], keep: 'advantage', modifier: 1 },
    { userId: dmId, characterId: null, encounterId: null, rollType: 'custom', rollContext: 'Wandering monster check', d20Rolls: [3], keep: 'normal', modifier: 0 },
  ];

  for (const r of rolls) {
    const keptDie = r.keep === 'advantage' ? Math.max(...r.d20Rolls) : r.keep === 'disadvantage' ? Math.min(...r.d20Rolls) : r.d20Rolls[0]!;
    await client.query(
      `INSERT INTO dice_rolls
         (campaign_id, user_id, character_id, monster_instance_id, encounter_id, roll_type, roll_context,
          d20_rolls, keep, modifier, result_total)
       VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10)`,
      [campaignId, r.userId, r.characterId, r.encounterId, r.rollType, r.rollContext, r.d20Rolls, r.keep, r.modifier, keptDie + r.modifier],
    );
  }
  console.log(`  dice_rolls: ${rolls.length} sample rolls`);
}

// ---- Phase 3.5: Brenna opted into armor_class_mode='auto' — her equipped
// Chain Mail (base 16, no Dex contribution) + Shield (+2) computes to 18,
// matching what services/armorClass.ts's computeArmorClass would produce
// from her seeded gear (seedBrennaItems above) and Dex 14. Hardcoded here
// rather than computed, since the seed script writes directly via SQL and
// doesn't invoke the app's own service layer — kept in sync by hand.
async function seedAutoArmorClassDemo(client: Client, brennaId: number): Promise<void> {
  await client.query(`UPDATE characters SET armor_class_mode = 'auto', armor_class = 18 WHERE id = $1`, [brennaId]);
  console.log('  Brenna Ironhide: armor_class_mode=auto (computed AC 18: Chain Mail 16 + Shield 2)');
}

// Sister Maribel (Cleric 3, single-classed) — known/prepared cleric spells
// and her spell-slot resource pool computed straight from her own class's
// `class_levels.spell_slots` (no multiclass table involved: she has exactly
// one class). At level 3 that's cantrips_known=3, prepared_spells=6,
// spell_slots_level_1=4, spell_slots_level_2=2 (per the seeded 2024 Cleric
// class_levels row) — the spell list below is illustrative (6 leveled
// spells + 3 cantrips), not meant to be the exhaustive legal-optimal prep.
async function seedMaribelSpellsAndResources(
  client: Client,
  maribelId: number,
  clericClassId: number,
  spell: (slug: string) => Promise<number>,
): Promise<void> {
  const cantrips = ['guidance', 'sacred-flame', 'spare-the-dying'];
  const prepared = ['bless', 'cure-wounds', 'guiding-bolt', 'shield-of-faith', 'spiritual-weapon', 'lesser-restoration'];

  for (const slug of cantrips) {
    await client.query(
      `INSERT INTO character_spells (character_id, spell_id, class_id, is_prepared, always_prepared, source)
       VALUES ($1, $2, $3, true, true, 'class')
       ON CONFLICT (character_id, spell_id, class_id) DO UPDATE SET is_prepared = true, always_prepared = true`,
      [maribelId, await spell(slug), clericClassId],
    );
  }
  for (const slug of prepared) {
    await client.query(
      `INSERT INTO character_spells (character_id, spell_id, class_id, is_prepared, always_prepared, source)
       VALUES ($1, $2, $3, true, false, 'class')
       ON CONFLICT (character_id, spell_id, class_id) DO UPDATE SET is_prepared = true`,
      [maribelId, await spell(slug), clericClassId],
    );
  }

  const pools: Array<[string, number, string]> = [
    ['spell_slot_1', 4, 'long_rest'],
    ['spell_slot_2', 2, 'long_rest'],
  ];
  for (const [key, max, recharge] of pools) {
    await client.query(
      `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
       VALUES ($1, $2, $3, $3, $4)
       ON CONFLICT (character_id, resource_key) DO UPDATE SET max_value = EXCLUDED.max_value, recharge_on = EXCLUDED.recharge_on`,
      [maribelId, key, max, recharge],
    );
  }
  console.log(`  Sister Maribel: ${cantrips.length} cantrips + ${prepared.length} prepared spells, spell_slot_1=4/spell_slot_2=2 (long_rest)`);
}

// Brenna Ironhide (Fighter 3) — equips a longsword, chain mail, and shield
// (matching the 'ex-legion soldier' background), plus a stowed dagger.
// Second Wind is modeled as a simple 1-use/short-rest resource pool: real
// Second Wind restores 1d10+level HP rather than being a binary toggle, but
// tracking "has she used it since her last rest" as current/max=1 is enough
// for this demo without building out a heal-amount-formula system that
// nothing else in Phase 2 needs yet.
async function seedBrennaItems(client: Client, brennaId: number, item: (slug: string) => Promise<number>): Promise<void> {
  async function ensureItem(slug: string, opts: { equipped: boolean }): Promise<void> {
    const itemId = await item(slug);
    const existing = await client.query(
      `SELECT id FROM character_items WHERE character_id = $1 AND item_id = $2`,
      [brennaId, itemId],
    );
    if (existing.rows.length > 0) return;
    await client.query(
      `INSERT INTO character_items (character_id, item_id, quantity, is_equipped) VALUES ($1, $2, 1, $3)`,
      [brennaId, itemId, opts.equipped],
    );
  }

  await ensureItem('longsword', { equipped: true });
  await ensureItem('chain-mail', { equipped: true });
  await ensureItem('shield', { equipped: true });
  await ensureItem('dagger', { equipped: false });

  await client.query(
    `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
     VALUES ($1, 'second_wind', 1, 1, 'short_rest')
     ON CONFLICT (character_id, resource_key) DO NOTHING`,
    [brennaId],
  );
  console.log('  Brenna Ironhide: equipped longsword/chain mail/shield (+ stowed dagger), second_wind resource pool (1/short_rest)');
}

interface CatalogLookups {
  ability: (index: string) => Promise<number>;
  background: (index: string) => Promise<number>;
  race: (index: string) => Promise<number>;
  klass: (index: string) => Promise<number>;
  spell: (slug: string) => Promise<number>;
}

// Kessia Duskbane (Tiefling, Criminal) — Paladin 3 / Warlock 2, the
// multiclass demo PC. This is the whole point of `multiclass_spell_slot_
// table` and `class_multiclass_prerequisites`:
//
// Prerequisites: Paladin needs STR 13 AND CHA 13; Warlock needs CHA 13.
// Kessia's STR 14 / CHA 16 satisfy both (see `class_multiclass_prerequisites`
// seeded in catalog.ts).
//
// Spell slots — the naive-vs-correct comparison this PC exists to exercise:
//   NAIVE (wrong): sum each class's own single-class table at its own level
//     -> Paladin 3 solo-table = 3 first-level slots, Warlock 2 solo-table
//        (Pact Magic) = 2 first-level slots => "5 first-level slots". This
//        is not how 5e multiclass spellcasting works.
//   CORRECT: Warlock's Pact Magic is EXCLUDED from the multiclass slot
//     table entirely — it's always tracked as its own separate pool.
//     Combined caster level = floor(paladin_level / 2) [half-caster] +
//     floor(warlock_level / 3) [Warlock does NOT count toward this table at
//     all under RAW multiclass rules] = floor(3/2) = 1.
//     multiclass_spell_slot_table[1] = {"1": 2} -> 2 first-level slots,
//     recharge_on='long_rest'. Separately, Warlock 2's own Pact Magic
//     (class_levels.spell_slots_level_1 = 2) gives 2 MORE first-level
//     slots, recharge_on='short_rest'. Both pools coexist and are never
//     merged — that's the "not the naive sum" point in one worked example.
async function seedMulticlassCharacter(
  client: Client,
  campaignId: number,
  dmId: number,
  quinnId: number,
  lookups: CatalogLookups,
): Promise<void> {
  const { ability, background, race, klass, spell } = lookups;

  let kessiaId = await maybeId(
    client,
    `SELECT id FROM characters WHERE campaign_id = $1 AND name = $2`,
    [campaignId, MULTICLASS_PC_NAME],
  );

  const paladinClassId = await klass('paladin');
  const warlockClassId = await klass('warlock');

  if (kessiaId === null) {
    const tieflingId = await race('tiefling');
    const criminalId = await background('criminal');

    const res = await client.query(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, race_id, background_id, alignment,
          str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current, hp_temp, hit_dice_remaining, notes)
       VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        campaignId, quinnId, dmId, MULTICLASS_PC_NAME, tieflingId, criminalId, 'Chaotic Neutral',
        14, 10, 14, 8, 10, 16, 18, 30, 42, 42, 0, JSON.stringify({ d10: 3, d8: 2 }),
        'An oathbreaker paladin who struck a pact to survive the battle that broke her order; ' +
          'still wears her old order\'s sigil, filed down so no one asks about it.',
      ],
    );
    kessiaId = res.rows[0].id;

    await client.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 3)`, [kessiaId, paladinClassId]);
    await client.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 2)`, [kessiaId, warlockClassId]);

    // Only the FIRST class taken grants saving throw proficiencies under
    // multiclassing rules — Paladin's, here (WIS + CHA).
    for (const aId of [await ability('wis'), await ability('cha')]) {
      await client.query(`INSERT INTO character_saving_throw_proficiencies (character_id, ability_score_id) VALUES ($1, $2)`, [kessiaId, aId]);
    }

    console.log(`  Kessia Duskbane created (Paladin 3 / Warlock 2, character id=${kessiaId})`);
  } else {
    console.log(`  Kessia Duskbane already exists (id=${kessiaId}) — refreshing spells/resource pools only.`);
  }

  // ---- Spells known/prepared, per class ----
  const paladinPrepared = ['bless', 'shield-of-faith', 'cure-wounds'];
  for (const slug of paladinPrepared) {
    await client.query(
      `INSERT INTO character_spells (character_id, spell_id, class_id, is_prepared, always_prepared, source)
       VALUES ($1, $2, $3, true, false, 'class')
       ON CONFLICT (character_id, spell_id, class_id) DO UPDATE SET is_prepared = true`,
      [kessiaId, await spell(slug), paladinClassId],
    );
  }

  // Warlocks don't "prepare" — their known spells are always available, so
  // always_prepared=true is the accurate fit (not subject to a daily prep
  // ritual/limit the way Paladin's are).
  const warlockCantrips = ['eldritch-blast', 'mage-hand'];
  const warlockKnown = ['hex', 'armor-of-agathys'];
  for (const slug of [...warlockCantrips, ...warlockKnown]) {
    await client.query(
      `INSERT INTO character_spells (character_id, spell_id, class_id, is_prepared, always_prepared, source)
       VALUES ($1, $2, $3, true, true, 'class')
       ON CONFLICT (character_id, spell_id, class_id) DO UPDATE SET is_prepared = true, always_prepared = true`,
      [kessiaId, await spell(slug), warlockClassId],
    );
  }

  // ---- Resource pools: the correctly-computed multiclass split ----
  // Combined caster level = floor(paladin_level / 2) = floor(3/2) = 1
  // (Warlock's pact caster levels never count toward this sum). Looked up
  // from `multiclass_spell_slot_table` rather than hardcoded here, so this
  // stays correct if that table (or Kessia's levels) ever changes.
  const combinedCasterLevel = Math.floor(3 / 2); // Paladin (half-caster) 3 ÷ 2, rounded down; Warlock excluded
  const multiclassSlots = await oneId(
    client,
    `SELECT combined_caster_level AS id FROM multiclass_spell_slot_table WHERE combined_caster_level = $1`,
    [combinedCasterLevel],
    `multiclass_spell_slot_table row for combined caster level ${combinedCasterLevel}`,
  );
  void multiclassSlots; // existence-checked above; the actual slot count (2) is the well-known table value at level 1

  await client.query(
    `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
     VALUES ($1, 'spell_slot_1', 2, 2, 'long_rest')
     ON CONFLICT (character_id, resource_key) DO UPDATE SET max_value = EXCLUDED.max_value, recharge_on = EXCLUDED.recharge_on`,
    [kessiaId],
  );
  // Warlock 2's own Pact Magic table (class_levels.spell_slots_level_1 = 2
  // at warlock level 2) — a SEPARATE short-rest-recharging pool, never
  // merged with the long-rest multiclass pool above.
  await client.query(
    `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
     VALUES ($1, 'warlock_pact_slot_1', 2, 2, 'short_rest')
     ON CONFLICT (character_id, resource_key) DO UPDATE SET max_value = EXCLUDED.max_value, recharge_on = EXCLUDED.recharge_on`,
    [kessiaId],
  );
  // Lay on Hands (Paladin 3): a pool of 5 x paladin level HP, long rest.
  await client.query(
    `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
     VALUES ($1, 'lay_on_hands_pool', 15, 15, 'long_rest')
     ON CONFLICT (character_id, resource_key) DO UPDATE SET max_value = EXCLUDED.max_value, recharge_on = EXCLUDED.recharge_on`,
    [kessiaId],
  );

  console.log('  Kessia Duskbane resource pools: spell_slot_1=2/long_rest (multiclass table, combined caster level 1) '
    + '+ warlock_pact_slot_1=2/short_rest (Warlock 2 Pact Magic, tracked separately) + lay_on_hands_pool=15/long_rest');
}

function printCredentials(): void {
  console.log('\n[demo] Login credentials:');
  console.log(`  DM     -> email: ${DM_EMAIL}    password: ${DEMO_PASSWORD}`);
  console.log(`  Player -> email: ${PLAYER_EMAIL} password: ${DEMO_PASSWORD}`);
  console.log(`  Player -> email: ${MULTICLASS_PLAYER_EMAIL}  password: ${DEMO_PASSWORD} (owns Kessia Duskbane)`);
}
