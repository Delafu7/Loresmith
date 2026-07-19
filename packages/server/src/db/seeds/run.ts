// Seed entrypoint — `npm run seed --workspace=@dnd/server`.
// Runs the SRD catalog seed (both editions) then the sample/demo campaign
// data, each in its own transaction, then prints row counts for every
// Phase 1 table as a sanity check.

import { Client } from 'pg';
import { seedCatalog } from './catalog.js';
import { seedDemo } from './demo.js';

const PHASE_1_TABLES = [
  'srd_editions', 'users', 'campaigns', 'campaign_members',
  'ability_scores', 'skills', 'languages', 'alignments',
  'races', 'subraces', 'classes', 'subclasses', 'class_levels', 'class_features',
  'feats', 'backgrounds', 'monsters',
  'characters', 'character_classes', 'character_skill_proficiencies', 'character_saving_throw_proficiencies',
  'monster_instances', 'encounters', 'combat_participants',
  'sessions', 'notes',
];

const PHASE_2_TABLES = [
  'conditions', 'magic_schools', 'damage_types',
  'spells', 'spell_classes', 'items',
  'class_multiclass_prerequisites', 'multiclass_spell_slot_table', 'effect_definitions',
  'character_spells', 'character_items', 'character_resource_pools',
  'active_effects', 'rest_events', 'rest_event_characters',
];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (expected to be loaded from the repo-root .env via dotenv-cli)');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    try {
      await client.query('BEGIN');
      await seedCatalog(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[seed] Catalog seed failed, rolled back:', err);
      throw err;
    }

    try {
      await client.query('BEGIN');
      await seedDemo(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[seed] Demo seed failed, rolled back:', err);
      throw err;
    }

    console.log('\n[seed] Row counts:');
    for (const table of [...PHASE_1_TABLES, ...PHASE_2_TABLES]) {
      const res = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      console.log(`  ${table.padEnd(40, '.')} ${res.rows[0].count}`);
    }
    console.log('\n[seed] Done.');
  } finally {
    // Always release the connection — otherwise a failed seed leaves an idle
    // client holding the process open forever instead of exiting.
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
