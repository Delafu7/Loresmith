import { describe, expect, it } from 'vitest';
import {
  obscurementFromLightLevel,
  perceptionConsequenceOf,
  computeSightResult,
  tremorsenseDetects,
  type ViewerSenses,
} from './obscurement.js';

function senses(overrides: Partial<ViewerSenses> = {}): ViewerSenses {
  return { darkvisionRadiusFt: 0, blindsightRadiusFt: 0, truesightRadiusFt: 0, ...overrides };
}

describe('obscurementFromLightLevel', () => {
  it('bright -> none, dim -> lightly, dark -> heavily', () => {
    expect(obscurementFromLightLevel('bright')).toBe('none');
    expect(obscurementFromLightLevel('dim')).toBe('lightly');
    expect(obscurementFromLightLevel('dark')).toBe('heavily');
  });
});

describe('perceptionConsequenceOf', () => {
  it('none: no consequence at all', () => {
    expect(perceptionConsequenceOf('none')).toEqual({ perceptionCheckDisadvantage: false, effectivelyBlindedForThisTarget: false });
  });
  it('lightly: Perception disadvantage only, never the Blinded-equivalent', () => {
    expect(perceptionConsequenceOf('lightly')).toEqual({ perceptionCheckDisadvantage: true, effectivelyBlindedForThisTarget: false });
  });
  it('heavily: effectively Blinded for this target, not a separate disadvantage on top', () => {
    expect(perceptionConsequenceOf('heavily')).toEqual({ perceptionCheckDisadvantage: false, effectivelyBlindedForThisTarget: true });
  });
});

describe('computeSightResult', () => {
  it('no special senses: base obscurement passes through unchanged, source "normal"', () => {
    const result = computeSightResult('heavily', 20, senses(), false);
    expect(result).toEqual({ obscurement: 'heavily', perceivesInvisible: false, source: 'normal' });
  });

  it('darkvision downgrades heavily -> lightly within range', () => {
    const result = computeSightResult('heavily', 20, senses({ darkvisionRadiusFt: 60 }), false);
    expect(result).toEqual({ obscurement: 'lightly', perceivesInvisible: false, source: 'darkvision' });
  });

  it('darkvision downgrades lightly -> none within range', () => {
    const result = computeSightResult('lightly', 20, senses({ darkvisionRadiusFt: 60 }), false);
    expect(result.obscurement).toBe('none');
    expect(result.source).toBe('darkvision');
  });

  it('darkvision out of range: base obscurement applies, unmodified', () => {
    const result = computeSightResult('heavily', 100, senses({ darkvisionRadiusFt: 60 }), false);
    expect(result).toEqual({ obscurement: 'heavily', perceivesInvisible: false, source: 'normal' });
  });

  it('darkvision in range but base obscurement was already none: source stays "normal", not falsely "darkvision"', () => {
    const result = computeSightResult('none', 20, senses({ darkvisionRadiusFt: 60 }), false);
    expect(result.source).toBe('normal');
  });

  it('blindsight fully negates obscurement to none and perceives Invisible, within range', () => {
    const result = computeSightResult('heavily', 20, senses({ blindsightRadiusFt: 30 }), false);
    expect(result).toEqual({ obscurement: 'none', perceivesInvisible: true, source: 'blindsight' });
  });

  it('blindsight does NOT help against a target with Total Cover, per its own named exception', () => {
    const result = computeSightResult('heavily', 20, senses({ blindsightRadiusFt: 30 }), true);
    expect(result.source).not.toBe('blindsight');
    expect(result.obscurement).toBe('heavily'); // falls through to the base, no other sense active
  });

  it('truesight fully negates obscurement to none and perceives Invisible, within range, unaffected by Total Cover', () => {
    const withoutCover = computeSightResult('heavily', 20, senses({ truesightRadiusFt: 30 }), false);
    const withCover = computeSightResult('heavily', 20, senses({ truesightRadiusFt: 30 }), true);
    expect(withoutCover).toEqual({ obscurement: 'none', perceivesInvisible: true, source: 'truesight' });
    expect(withCover).toEqual({ obscurement: 'none', perceivesInvisible: true, source: 'truesight' });
  });

  it('blindsight is preferred over truesight when both are in range (both give the same best outcome)', () => {
    const result = computeSightResult('heavily', 10, senses({ blindsightRadiusFt: 30, truesightRadiusFt: 30 }), false);
    expect(result.source).toBe('blindsight');
  });

  it('beyond blindsight range but within a longer darkvision range: darkvision still applies', () => {
    const result = computeSightResult('heavily', 40, senses({ blindsightRadiusFt: 10, darkvisionRadiusFt: 60 }), false);
    expect(result).toEqual({ obscurement: 'lightly', perceivesInvisible: false, source: 'darkvision' });
  });
});

describe('tremorsenseDetects', () => {
  it('detects within range while both share surface contact and the target is not airborne', () => {
    expect(tremorsenseDetects(60, 30, true, false)).toBe(true);
  });

  it('never detects an airborne target, regardless of range/contact', () => {
    expect(tremorsenseDetects(60, 30, true, true)).toBe(false);
  });

  it('never detects without shared surface contact', () => {
    expect(tremorsenseDetects(60, 30, false, false)).toBe(false);
  });

  it('never detects beyond its own range', () => {
    expect(tremorsenseDetects(10, 30, true, false)).toBe(false);
  });

  it('a zero radius never detects anything', () => {
    expect(tremorsenseDetects(0, 0, true, false)).toBe(false);
  });
});
