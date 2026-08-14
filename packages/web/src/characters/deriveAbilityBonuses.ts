// Compendium feature: reconciles ability_bonuses' two different on-the-wire
// shapes and stacks race + subrace bonuses on top of a character's rolled
// base scores.
//
// Official/seeded races carry the raw SRD JSON shape:
//   [{ ability_score: { index: 'dex', name?: 'DEX' }, bonus: 2 }, ...]
// Homebrew races (authored through the catalog editor) carry the Zod
// schema's flat-map shape instead (schemas/catalogHomebrew.ts's
// raceHomebrewShape.abilityBonuses = z.record(z.string(), z.number().int())):
//   { dex: 2, str: 1 }
// This is a read-side reconciliation only — no data migration normalizes
// the two shapes into one, so every reader of ability_bonuses has to handle
// both. parseAbilityBonuses is that one normalizer, used by both
// applyAbilityBonuses below and any UI that wants to show "+N racial".
import { ABILITY_KEYS, type AbilityKey } from './abilityScoreGeneration';
import type { RaceCatalog, SubraceCatalog } from '../lib/types';

const ABILITY_KEY_SET = new Set<string>(ABILITY_KEYS);

function isAbilityKey(key: string): key is AbilityKey {
  return ABILITY_KEY_SET.has(key);
}

/** Normalizes either on-the-wire ability_bonuses shape into a flat, partial AbilityKey -> bonus map. */
export function parseAbilityBonuses(raw: unknown): Partial<Record<AbilityKey, number>> {
  const out: Partial<Record<AbilityKey, number>> = {};
  if (raw === null || raw === undefined) return out;

  if (Array.isArray(raw)) {
    // Official SRD shape: [{ ability_score: { index }, bonus }]
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const abilityScore = record.ability_score;
      const index =
        typeof abilityScore === 'object' && abilityScore !== null
          ? (abilityScore as Record<string, unknown>).index
          : undefined;
      const bonus = record.bonus;
      if (typeof index === 'string' && typeof bonus === 'number' && isAbilityKey(index.toLowerCase())) {
        out[index.toLowerCase() as AbilityKey] = (out[index.toLowerCase() as AbilityKey] ?? 0) + bonus;
      }
    }
    return out;
  }

  if (typeof raw === 'object') {
    // Homebrew shape: flat Record<string, number>
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number' && isAbilityKey(key.toLowerCase())) {
        out[key.toLowerCase() as AbilityKey] = (out[key.toLowerCase() as AbilityKey] ?? 0) + value;
      }
    }
  }
  return out;
}

/** Sums race + subrace bonuses (subrace stacks on top of race, per SRD rules) into one flat map. */
export function combinedAbilityBonuses(
  race: RaceCatalog | null,
  subrace: SubraceCatalog | null,
): Partial<Record<AbilityKey, number>> {
  const raceBonuses = race ? parseAbilityBonuses(race.ability_bonuses) : {};
  const subraceBonuses = subrace ? parseAbilityBonuses(subrace.ability_bonuses) : {};
  const out: Partial<Record<AbilityKey, number>> = { ...raceBonuses };
  for (const key of ABILITY_KEYS) {
    const bonus = subraceBonuses[key];
    if (bonus !== undefined) out[key] = (out[key] ?? 0) + bonus;
  }
  return out;
}

/** Applies combinedAbilityBonuses on top of base (rolled) scores — the final scores characters.str/dex/... actually stores. */
export function applyAbilityBonuses(
  base: Record<AbilityKey, number>,
  race: RaceCatalog | null,
  subrace: SubraceCatalog | null,
): Record<AbilityKey, number> {
  const bonuses = combinedAbilityBonuses(race, subrace);
  const out = { ...base };
  for (const key of ABILITY_KEYS) {
    const bonus = bonuses[key];
    if (bonus !== undefined) out[key] = out[key] + bonus;
  }
  return out;
}
