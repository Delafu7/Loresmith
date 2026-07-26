// Read-only duplicate report for REFACTOR-PLAN.md §2's uniqueness fix.
//
// Before this fix, `createMonsterInstance`'s is_unique check was scoped
// per-campaign and counted every instance status — so pre-existing data
// could already violate the corrected system-wide, living-only invariant
// ("at most one status='alive' instance of an is_unique monster, across the
// whole system") in two ways this script reports separately:
//
//   1. Multiple LIVING instances of the same unique monster across DIFFERENT
//      campaigns — the actual bug the brief describes.
//   2. Multiple instances (any status) of the same unique monster WITHIN one
//      campaign — legal under the corrected rule as long as at most one is
//      currently 'alive', but worth surfacing since it's exactly the shape
//      the old per-campaign check was trying (incompletely) to prevent.
//
// Never mutates anything — this only prints; a DM resolves conflicts
// manually (mark one dead, un-flag is_unique, etc.), matching this
// migration's "no data-loss concern worth an automated fix" posture per
// REFACTOR-PLAN.md §2.
//
// Run: npm run report:unique-duplicates --workspace=@dnd/server

import { Client } from 'pg';

interface CrossCampaignRow {
  monster_id: number;
  monster_name: string;
  living_instance_count: string;
  campaign_names: string[];
}

interface WithinCampaignRow {
  monster_id: number;
  monster_name: string;
  campaign_id: number;
  campaign_name: string;
  instance_count: string;
  living_count: string;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (expected to be loaded from the repo-root .env via dotenv-cli)');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const crossCampaign = await client.query<CrossCampaignRow>(`
      SELECT m.id AS monster_id, m.name AS monster_name,
             COUNT(*)::text AS living_instance_count,
             array_agg(c.name ORDER BY c.name) AS campaign_names
      FROM monsters m
      JOIN monster_instances mi ON mi.monster_id = m.id AND mi.status = 'alive'
      JOIN campaigns c ON c.id = mi.campaign_id
      WHERE m.is_unique = true
      GROUP BY m.id, m.name
      HAVING COUNT(DISTINCT mi.campaign_id) > 1
      ORDER BY m.name
    `);

    const withinCampaign = await client.query<WithinCampaignRow>(`
      SELECT m.id AS monster_id, m.name AS monster_name,
             mi.campaign_id, c.name AS campaign_name,
             COUNT(*)::text AS instance_count,
             COUNT(*) FILTER (WHERE mi.status = 'alive')::text AS living_count
      FROM monsters m
      JOIN monster_instances mi ON mi.monster_id = m.id
      JOIN campaigns c ON c.id = mi.campaign_id
      WHERE m.is_unique = true
      GROUP BY m.id, m.name, mi.campaign_id, c.name
      HAVING COUNT(*) > 1
      ORDER BY m.name, c.name
    `);

    console.log('[report:unique-duplicates] Unique creatures with LIVING instances in more than one campaign');
    console.log('(the actual pre-fix bug — resolve by marking all but one instance dead, or un-flagging is_unique):\n');
    if (crossCampaign.rows.length === 0) {
      console.log('  None found.\n');
    } else {
      for (const row of crossCampaign.rows) {
        console.log(
          `  ${row.monster_name} (monster id ${row.monster_id}): ${row.living_instance_count} living instances across [${row.campaign_names.join(', ')}]`,
        );
      }
      console.log();
    }

    console.log('[report:unique-duplicates] Unique creatures with multiple instances (any status) within one campaign');
    console.log('(legal under the corrected rule if at most one is living — informational only):\n');
    if (withinCampaign.rows.length === 0) {
      console.log('  None found.\n');
    } else {
      for (const row of withinCampaign.rows) {
        console.log(
          `  ${row.monster_name} in "${row.campaign_name}" (campaign id ${row.campaign_id}): ${row.instance_count} instances total, ${row.living_count} living`,
        );
      }
      console.log();
    }

    console.log('[report:unique-duplicates] Done. This script never modifies data.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
