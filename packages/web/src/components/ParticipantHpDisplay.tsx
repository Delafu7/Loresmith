import { HPBar, HP_BAND_COLOR, HP_BAND_KEY } from './HPBar';
import type { ParticipantHp } from '../lib/types';
import { useLocale } from '../i18n/LocaleContext';

function BandBadge({ hp }: { hp: Extract<ParticipantHp, { hpVisibility: 'banded' }> }) {
  const { t } = useLocale();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white ${HP_BAND_COLOR[hp.band]}`}
    >
      {t(HP_BAND_KEY[hp.band])}
    </span>
  );
}

function HiddenBadge() {
  const { t } = useLocale();
  return <span className="text-xs italic text-stone-600">{t('hp.hidden')}</span>;
}

/**
 * Phase 2 "restore hp_visibility + banding" — the one place a combat
 * participant's `hp: ParticipantHp` (a DM-always/player-sometimes union,
 * see that type's doc comment) gets rendered. Every call site that used to
 * pass `current={p.hp.hpCurrent} max={p.hp.hpMax}` straight to HPBar now
 * goes through here instead, since a 'banded'/'hidden' participant no
 * longer carries those numbers at all.
 *
 * `variant="bar"` (default) renders the full HPBar (number + progress bar +
 * band label) for the exact case — used everywhere HPBar was used before.
 * `variant="text"` renders a compact "current/max (+temp)" inline string
 * instead, for dense per-row rosters (BattleModeDmPanel's tracker list) that
 * never had room for a full bar in the first place; the banded/hidden
 * fallback is identical either way.
 */
export function ParticipantHpDisplay({
  hp,
  size = 'compact',
  variant = 'bar',
}: {
  hp: ParticipantHp;
  size?: 'compact' | 'large';
  variant?: 'bar' | 'text';
}) {
  if ('hpCurrent' in hp) {
    if (variant === 'text') {
      return (
        <span className="font-mono tabular-nums">
          {hp.hpCurrent}/{hp.hpMax}
          {hp.hpTemp > 0 && <span className="text-sky-400"> (+{hp.hpTemp})</span>}
        </span>
      );
    }
    return <HPBar current={hp.hpCurrent} max={hp.hpMax} temp={hp.hpTemp} size={size} />;
  }
  if (hp.hpVisibility === 'banded') return <BandBadge hp={hp} />;
  return <HiddenBadge />;
}
