// Distance-unit formatting (Iteration 4) — every stored distance value in
// this app stays in feet everywhere (DB, forms, inputs); this is the one
// place a read-only DISPLAY converts to meters for a user who's opted into
// the metric preference. Conversion factor (1 ft = 0.3 m) matches this
// project's own established convention (CLAUDE.md / the dnd5e-srd skill's
// reference text: "5 ft. = 1.5 m") — a deliberately simplified, non-precise
// factor for readability, not the literal 0.3048.

import type { TranslationKey } from '../i18n/LocaleContext';
import type { UnitSystem } from './types';

type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Rounds to the nearest 0.5 — matches the half-meter granularity of the
 * project's own "5 ft. = 1.5 m" reference conversions. */
function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatDistance(feet: number, unitSystem: UnitSystem, t: Translator): string {
  if (unitSystem === 'metric') {
    const meters = roundToHalf(feet * 0.3);
    return `${formatNumber(meters)} ${t('common.metersUnit')}`;
  }
  return `${formatNumber(feet)} ${t('common.feetUnit')}`;
}
