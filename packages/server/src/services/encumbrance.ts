// Encumbrance derivation (docs/rules/inventory-and-attunement.md, dnd-rules
// agent). SRD 5.1 (2014, `references/2014/ability-checks.md`), confirmed:
//   - Carrying capacity = STR score x 15 lb.
//   - Standard/variant thresholds: > STR x 5 = Encumbered (speed -10 ft);
//     > STR x 10 = Heavily Encumbered (speed -20 ft, disadvantage on
//     STR/DEX/CON checks/attacks/saves).
// SRD 5.2 (2024) carrying-capacity numbers are NOT present in this
// project's rules-reference dataset (dnd5e-srd skill) — `adventuring.md`
// only says "carrying capacity rules apply" without giving the formula.
// The same x15/x5/x10 multipliers are applied for 2024 campaigns too as an
// UNCONFIRMED EXTENSION pending SRD 5.2 text verification, not asserted as
// equal-authority to the 2014 numbers. Revisit if that gap gets filled.
//
// Deliberately NOT modeled here (out of scope for this pass, matching the
// rules doc's own recommendation): size-category capacity multipliers
// (Tiny/Large+/Powerful Build — overwhelmingly Medium/Small among standard
// PC races, so a low-value addition for real risk of drift from
// services/movement.ts's own separate size-rank logic), and NOT auto-
// applying the speed penalty to a character's computed speed — this is a
// read-only, informational derivation surfaced on the character sheet, not
// wired into movement/combat math (services/movement.ts stays untouched).
//
// Per the brief's "derivation layer, not hardcoded in UI components" rule
// (mirrors services/armorClass.ts's own precedent): a pure, unit-tested
// function here; services/characters.ts wires it to a real STR score + the
// summed weight of a character's owned items (ALL character_items rows,
// not just equipped ones — worn/equipped items count toward carried
// weight too, per the rules doc).

export interface EncumbranceResult {
  carryCapacityLb: number;
  encumberedThresholdLb: number;
  heavilyEncumberedThresholdLb: number;
  totalCarriedLb: number;
  encumbered: boolean;
  heavilyEncumbered: boolean;
}

export function computeEncumbrance(strengthScore: number, totalCarriedLb: number): EncumbranceResult {
  const carryCapacityLb = strengthScore * 15;
  const encumberedThresholdLb = strengthScore * 5;
  const heavilyEncumberedThresholdLb = strengthScore * 10;

  return {
    carryCapacityLb,
    encumberedThresholdLb,
    heavilyEncumberedThresholdLb,
    totalCarriedLb,
    encumbered: totalCarriedLb > encumberedThresholdLb,
    heavilyEncumbered: totalCarriedLb > heavilyEncumberedThresholdLb,
  };
}
