// HP banding (Phase 2 "restore hp_visibility + banding"). Confirmed scale:
// a simple global percentage, not a per-creature-type curve — >75% Healthy,
// 50-75% Injured, 25-50% Bloodied, <25% Critical, 0 Down. Pure so it's
// directly unit-testable. The band is computed server-side only and sent
// as a plain string over the wire (sockets/broadcast.ts's resolveHpForViewer)
// — the client never receives raw hpCurrent/hpMax for a 'banded' participant,
// so there's nothing for it to re-derive.
//
// Band names/thresholds are deliberately identical to the client's
// pre-existing HPBar.tsx status label (Healthy/Injured/Bloodied/Critical/
// Down, already shown on every character sheet/dashboard/monster stat
// block) — that component computes its band from always-visible exact HP,
// unrelated to this reintroduced visibility mechanic, but there is no
// reason for the app to show two different band vocabularies for the same
// underlying concept, so this reuses its exact wording.

export type HpBand = 'healthy' | 'injured' | 'bloodied' | 'critical' | 'down';

export function bandHp(hpCurrent: number, hpMax: number): HpBand {
  if (hpCurrent <= 0) return 'down';
  if (hpMax <= 0) return 'critical'; // defensive: a real hpMax is always > 0, but never divide by zero
  const pct = hpCurrent / hpMax;
  if (pct > 0.75) return 'healthy';
  if (pct > 0.5) return 'injured';
  if (pct > 0.25) return 'bloodied';
  return 'critical';
}
