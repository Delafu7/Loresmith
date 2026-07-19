// Shared HP-delta math for characters and monster instances (SRD 5e "Damage and
// Healing" / "Temporary Hit Points" rules), pulled out into one place so both
// call sites and the test suite share a single implementation.
//
// SRD rules modeled here:
// - Damage is subtracted from temporary hit points first; only the remainder
//   (if any) carries over to real hit points.
// - Healing restores real hit points only and never interacts with temp HP.
// - New temporary HP doesn't stack additively with existing temp HP — you
//   keep whichever amount is higher.

export interface HpState {
  hp_current: number;
  hp_max: number;
  hp_temp: number;
}

export interface HpDelta {
  delta: number;
  tempDelta: number;
}

export interface HpResult {
  hpCurrent: number;
  hpTemp: number;
}

export function applyHpDeltaWithTempAbsorption(state: HpState, { delta, tempDelta }: HpDelta): HpResult {
  let hpCurrent = state.hp_current;
  let hpTemp = state.hp_temp;

  if (delta < 0) {
    const damage = -delta;
    const absorbedByTemp = Math.min(hpTemp, damage);
    hpTemp -= absorbedByTemp;
    const remaining = damage - absorbedByTemp;
    hpCurrent = Math.max(0, hpCurrent - remaining);
  } else if (delta > 0) {
    hpCurrent = Math.min(state.hp_max, hpCurrent + delta);
  }

  if (tempDelta > 0) {
    hpTemp = Math.max(hpTemp, tempDelta);
  }

  return { hpCurrent, hpTemp };
}
