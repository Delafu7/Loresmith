// Encounter XP budgeting (Phase 3 "Encounter XP budgeting"). Pure — no DB
// access, same `domain/hpBanding.ts` precedent — so it's directly
// unit-testable and callable from either services/encounters.ts or a future
// encounter-builder UI without a round-trip.
//
// Both editions' numbers were transcribed from WotC's own free rules text,
// NOT the SRD (this content — "Building Combat Encounters" / "Combat
// Encounter Difficulty" — is Dungeon Master's Guide material in both
// editions, outside the OGL SRD 5.1 / CC-BY SRD 5.2 legal text, and does not
// exist anywhere in .opencode/skills/dnd5e-srd/'s data):
//   - 2014: WotC's free "Dungeon Master's Basic Rules v0.2" PDF,
//     "Building Combat Encounters" (pp. 55-57).
//   - 2024: D&D Beyond's official "Basic Rules (2024) -> DM's Toolbox" page,
//     "Combat Encounter Difficulty" section.
// Full transcription, worked examples, and edge-case reasoning this file
// implements: docs/rules/encounter-xp-budget.md. Do not cite either table
// below as "SRD" in comments/UI — see that doc's sourcing note.

export interface MonsterXpInput {
  xpValue: number;
  // Rows with quantity <= 0 (e.g. a still-empty UI row) are excluded from
  // both the XP sum and the monster-count used for the 2014 multiplier —
  // see docs/rules/encounter-xp-budget.md's "Monster count = 0" edge case.
  quantity: number;
}

export type Tier2014 = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly';
export type Tier2024 = 'trivial' | 'low' | 'moderate' | 'high';

export interface XpBudgetResult2014 {
  edition: '2014';
  tier: Tier2014;
  partyThresholds: { easy: number; medium: number; hard: number; deadly: number };
  monsterCount: number;
  rawMonsterXp: number;
  multiplier: number;
  adjustedMonsterXp: number;
}

export interface XpBudgetResult2024 {
  edition: '2024';
  tier: Tier2024;
  // All three tier budgets, not just the one that ended up matching —
  // mirrors 2014's partyThresholds shape above. docs/rules/encounter-xp-budget.md
  // §2's suggested output shape was a single `xpBudget` for a DM-chosen
  // target tier, but classifying an already-built monster list (this
  // function's job) needs all three to find which one it clears, so this
  // intentionally returns the fuller set instead.
  partyBudgets: { low: number; moderate: number; high: number };
  monsterCount: number;
  monsterXpTotal: number;
}

export type XpBudgetResult = XpBudgetResult2014 | XpBudgetResult2024;

// 2014 "XP Thresholds by Character Level", levels 1-20, verbatim.
const THRESHOLDS_2014: ReadonlyArray<{ easy: number; medium: number; hard: number; deadly: number }> = [
  { easy: 25, medium: 50, hard: 75, deadly: 100 },
  { easy: 50, medium: 100, hard: 150, deadly: 200 },
  { easy: 75, medium: 150, hard: 225, deadly: 400 },
  { easy: 125, medium: 250, hard: 375, deadly: 500 },
  { easy: 250, medium: 500, hard: 750, deadly: 1100 },
  { easy: 300, medium: 600, hard: 900, deadly: 1400 },
  { easy: 350, medium: 750, hard: 1100, deadly: 1700 },
  { easy: 450, medium: 900, hard: 1400, deadly: 2100 },
  { easy: 550, medium: 1100, hard: 1600, deadly: 2400 },
  { easy: 600, medium: 1200, hard: 1900, deadly: 2800 },
  { easy: 800, medium: 1600, hard: 2400, deadly: 3600 },
  { easy: 1000, medium: 2000, hard: 3000, deadly: 4500 },
  { easy: 1100, medium: 2200, hard: 3400, deadly: 5100 },
  { easy: 1250, medium: 2500, hard: 3800, deadly: 5700 },
  { easy: 1400, medium: 2800, hard: 4300, deadly: 6400 },
  { easy: 1600, medium: 3200, hard: 4800, deadly: 7200 },
  { easy: 2000, medium: 3900, hard: 5900, deadly: 8800 },
  { easy: 2100, medium: 4200, hard: 6300, deadly: 9500 },
  { easy: 2400, medium: 4900, hard: 7300, deadly: 10900 },
  { easy: 2800, medium: 5700, hard: 8500, deadly: 12700 },
];

// 2024 "XP Budget per Character", levels 1-20, verbatim. NOT the same table
// as THRESHOLDS_2014 with renamed columns — levels 1-4 look similar but are
// shifted, and levels 5+ diverge outright. See docs/rules/encounter-xp-budget.md
// §2's note for the level-1/level-3 near-collisions that make this table
// easy to mistranscribe against the 2014 one.
const BUDGET_2024: ReadonlyArray<{ low: number; moderate: number; high: number }> = [
  { low: 50, moderate: 75, high: 100 },
  { low: 100, moderate: 150, high: 200 },
  { low: 150, moderate: 225, high: 400 },
  { low: 250, moderate: 375, high: 500 },
  { low: 500, moderate: 750, high: 1100 },
  { low: 600, moderate: 1000, high: 1400 },
  { low: 750, moderate: 1300, high: 1700 },
  { low: 1000, moderate: 1700, high: 2100 },
  { low: 1300, moderate: 2000, high: 2600 },
  { low: 1600, moderate: 2300, high: 3100 },
  { low: 1900, moderate: 2900, high: 4100 },
  { low: 2200, moderate: 3700, high: 4700 },
  { low: 2600, moderate: 4200, high: 5400 },
  { low: 2900, moderate: 4900, high: 6200 },
  { low: 3300, moderate: 5400, high: 7800 },
  { low: 3800, moderate: 6100, high: 9800 },
  { low: 4500, moderate: 7200, high: 11700 },
  { low: 5000, moderate: 8700, high: 14200 },
  { low: 5500, moderate: 10700, high: 17200 },
  { low: 6400, moderate: 13200, high: 22000 },
];

function clampLevel(level: number): number {
  return Math.min(20, Math.max(1, Math.round(level)));
}

// 2014 encounter-multiplier columns, extended one step past each end of the
// printed table (0.5 below the ×1 column, 5 above the ×4 column) so the
// party-size shift below always has somewhere to land — the source states
// both extensions explicitly (see docs/rules/encounter-xp-budget.md §1 step 4).
const MULTIPLIER_COLUMNS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5] as const;

// Index into MULTIPLIER_COLUMNS for the printed (3-5 character party, no
// shift) table, keyed by monster count bracket.
function baseMultiplierIndex(monsterCount: number): number {
  if (monsterCount <= 1) return 1; // ×1
  if (monsterCount === 2) return 2; // ×1.5
  if (monsterCount <= 6) return 3; // ×2
  if (monsterCount <= 10) return 4; // ×2.5
  if (monsterCount <= 14) return 5; // ×3
  return 6; // 15+ -> ×4
}

// Party-size adjustment shifts which MULTIPLIER_COLUMNS index is used, not
// the multiplier value itself — a <3-character party uses the next-highest
// column, a >=6-character party the next-lowest, 3-5 uses the table as
// printed. See docs/rules/encounter-xp-budget.md §1 step 4's "column shift,
// not a flat +/-" note.
function multiplierFor(monsterCount: number, partySize: number): number {
  if (monsterCount <= 0) return 1; // unused when there are no monsters (raw XP is already 0)
  let index = baseMultiplierIndex(monsterCount);
  if (partySize < 3) index += 1;
  else if (partySize >= 6) index -= 1;
  index = Math.min(MULTIPLIER_COLUMNS.length - 1, Math.max(0, index));
  return MULTIPLIER_COLUMNS[index]!;
}

function summarizeMonsters(monsters: MonsterXpInput[]): { count: number; totalXp: number } {
  let count = 0;
  let totalXp = 0;
  for (const m of monsters) {
    if (m.quantity <= 0) continue;
    count += m.quantity;
    totalXp += m.xpValue * m.quantity;
  }
  return { count, totalXp };
}

function assess2014(levels: number[], monsters: MonsterXpInput[]): XpBudgetResult2014 {
  const partyThresholds = levels.reduce(
    (sum, level) => {
      const row = THRESHOLDS_2014[clampLevel(level) - 1]!;
      return { easy: sum.easy + row.easy, medium: sum.medium + row.medium, hard: sum.hard + row.hard, deadly: sum.deadly + row.deadly };
    },
    { easy: 0, medium: 0, hard: 0, deadly: 0 },
  );

  const { count: monsterCount, totalXp: rawMonsterXp } = summarizeMonsters(monsters);
  const multiplier = multiplierFor(monsterCount, levels.length);
  const adjustedMonsterXp = rawMonsterXp * multiplier;

  let tier: Tier2014 = 'trivial';
  if (adjustedMonsterXp >= partyThresholds.deadly) tier = 'deadly';
  else if (adjustedMonsterXp >= partyThresholds.hard) tier = 'hard';
  else if (adjustedMonsterXp >= partyThresholds.medium) tier = 'medium';
  else if (adjustedMonsterXp >= partyThresholds.easy) tier = 'easy';

  return { edition: '2014', tier, partyThresholds, monsterCount, rawMonsterXp, multiplier, adjustedMonsterXp };
}

function assess2024(levels: number[], monsters: MonsterXpInput[]): XpBudgetResult2024 {
  // The 2024 source only defines this for a single party level ("the
  // party's level" x party size); it never states a procedure for a
  // mixed-level party. This sums each character's own per-level row instead
  // of one row x count, per docs/rules/encounter-xp-budget.md §2's edge-case
  // discussion — an explicit interpretive choice this app is making (it
  // degenerates to the official single-level-party math when every level is
  // equal), NOT an official rule.
  const partyBudgets = levels.reduce(
    (sum, level) => {
      const row = BUDGET_2024[clampLevel(level) - 1]!;
      return { low: sum.low + row.low, moderate: sum.moderate + row.moderate, high: sum.high + row.high };
    },
    { low: 0, moderate: 0, high: 0 },
  );

  const { count: monsterCount, totalXp: monsterXpTotal } = summarizeMonsters(monsters);

  let tier: Tier2024 = 'trivial';
  if (monsterXpTotal >= partyBudgets.high) tier = 'high';
  else if (monsterXpTotal >= partyBudgets.moderate) tier = 'moderate';
  else if (monsterXpTotal >= partyBudgets.low) tier = 'low';

  return { edition: '2024', tier, partyBudgets, monsterCount, monsterXpTotal };
}

/**
 * Classifies a proposed encounter's difficulty for the given party and
 * monster list. `levels` must be non-empty (an encounter needs a party to
 * be difficult *for*); an empty `monsters` list is valid and always
 * resolves to 'trivial' (a DM may call this mid-build, before adding any
 * monsters yet).
 */
export function assessEncounterXp(edition: '2014' | '2024', levels: number[], monsters: MonsterXpInput[]): XpBudgetResult {
  if (levels.length === 0) {
    throw new Error('assessEncounterXp requires at least one party member level');
  }
  return edition === '2014' ? assess2014(levels, monsters) : assess2024(levels, monsters);
}
