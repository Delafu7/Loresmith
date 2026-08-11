import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { formatModifier } from '../lib/dnd-math';
import type { DiceRoll, DiceRollKeep, DiceRollType } from '../lib/types';
import { DiceRollVisibilityPicker, useDiceRollVisibilityState } from './DiceRollVisibilityPicker';
import { ErrorBanner, errorMessage } from './Feedback';
import { useLocale } from '../i18n/LocaleContext';

export interface DiceRollerProps {
  rollType: DiceRollType;
  rollContext?: string;
  /** Already-computed final modifier (via lib/dnd-math.ts) — this component
   * only displays and submits it, it never derives ability/proficiency math
   * itself. */
  modifier: number;
  /** Defaults to a single d20 (the original ability/save/skill/attack use
   * case). Damage rolls pass the weapon/action's actual dice (e.g. sides=8,
   * count=1 for a longsword) — the advantage/disadvantage toggle only
   * renders when sides===20, since keep-highest/lowest isn't a 5e concept
   * for damage dice. */
  diceSides?: number;
  diceCount?: number;
  characterId?: string;
  monsterInstanceId?: string;
  encounterId?: string;
  /** Label for the roll-trigger button. Defaults to the translated "Roll";
   * callers embedding this inline in a dense row (skill/save lists) can pass
   * a compact glyph instead. */
  triggerLabel?: string;
  className?: string;
  /** REFACTOR-PLAN.md §6 — AttackRoller.tsx uses this to learn the kept d20
   * for crit detection (a natural 20 only crits if it's the KEPT die, never
   * a discarded one under disadvantage). Optional: every other existing
   * caller ignores it and behaves exactly as before. */
  onRoll?: (roll: DiceRoll) => void;
  /** Phase 2 "hidden-roll option in contextual rollers" — opt-in per call
   * site (SkillsPanel/SavingThrowsPanel/AttackRoller pass this; other
   * DiceRoller embeds like InventoryPanel/ActionEconomyPanel don't, since a
   * hidden item-use or initiative roll isn't a real DM use case). No effect
   * for a non-DM viewer — the picker only ever renders for role === 'dm',
   * same gating QuickDiceRoller.tsx already used. */
  allowHiddenRoll?: boolean;
}

/**
 * Shared roll-trigger primitive (PLAN.md §6.4/§6.6). Wraps the
 * server-authoritative `POST /campaigns/:id/dice-rolls` endpoint — the
 * server performs the RNG, this component just submits the request and
 * displays whatever result comes back. Not a modal: renders inline,
 * matching this app's established "no modal-heavy UI" precedent (see
 * EffectApplyDialog.tsx).
 */
export function DiceRoller({
  rollType,
  rollContext,
  modifier,
  diceSides = 20,
  diceCount = 1,
  characterId,
  monsterInstanceId,
  encounterId,
  triggerLabel,
  className = '',
  onRoll,
  allowHiddenRoll = false,
}: DiceRollerProps) {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const isDm = role === 'dm';
  const showVisibilityPicker = allowHiddenRoll && isDm;
  const [keep, setKeep] = useState<DiceRollKeep>('normal');
  const [result, setResult] = useState<DiceRoll | null>(null);
  // Collapsed by default (Phase 2) — these embeds are dense per-row lists
  // (every skill/save gets its own DiceRoller), so the full visibility
  // picker only appears once the DM opens it via the 👁/🙈 toggle below,
  // rather than bloating every row's height for the common (public) case.
  const [pickerOpen, setPickerOpen] = useState(false);
  const effectiveTriggerLabel = triggerLabel ?? t('dice.rollerRollButton');
  const keepOptions: Array<{ value: DiceRollKeep; label: string }> = [
    { value: 'disadvantage', label: t('dice.rollerDisadvantage') },
    { value: 'normal', label: t('dice.rollerNormal') },
    { value: 'advantage', label: t('dice.rollerAdvantage') },
  ];
  const { visibility, setVisibility, visibleToUserId, setVisibleToUserId, members } = useDiceRollVisibilityState(
    campaignId,
    showVisibilityPicker,
  );

  const rollMutation = useMutation({
    mutationFn: () =>
      api.post<{ roll: DiceRoll }>(`/campaigns/${campaignId}/dice-rolls`, {
        rollType,
        rollContext,
        keep: diceSides === 20 ? keep : 'normal',
        diceSides,
        diceCount,
        modifier,
        characterId,
        monsterInstanceId,
        encounterId,
        visibility: showVisibilityPicker ? visibility : undefined,
        visibleToUserId: showVisibilityPicker && visibility === 'private' ? visibleToUserId || undefined : undefined,
      }),
    onSuccess: (data) => {
      setResult(data.roll);
      onRoll?.(data.roll);
    },
  });

  return (
    <div className={`inline-flex flex-col items-start gap-1.5 ${className}`}>
      <div className="flex items-center gap-1.5">
        {diceSides === 20 && (
        <div
          role="radiogroup"
          aria-label={t('dice.rollerRollModeLabel')}
          className="inline-flex rounded-md border border-stone-700 overflow-hidden text-[10px] leading-none"
        >
          {keepOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={keep === opt.value}
              onClick={() => setKeep(opt.value)}
              className={`px-1.5 py-1 transition-colors ${
                keep === opt.value
                  ? 'bg-amber-950 text-amber-400 font-semibold'
                  : 'bg-stone-900 text-stone-400 hover:bg-stone-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        )}
        <button
          type="button"
          disabled={rollMutation.isPending}
          onClick={() => rollMutation.mutate()}
          // UX finding #8 (Iteration 3 audit) — icon-only trigger labels
          // ("⚄", "🎲") had no accessible name anywhere in combat, unlike
          // every other icon-only control in the same panels (👁/🙈/▾/▸/✕
          // all correctly carry aria-label). Derived from rollContext (e.g.
          // "Stealth", "STR Save"), which every real call site already
          // passes for exactly this display purpose.
          aria-label={rollContext ? t('dice.rollerTriggerAria', { context: rollContext }) : t('dice.rollerRollButton')}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-2 py-1 text-xs"
        >
          {rollMutation.isPending ? '…' : effectiveTriggerLabel}
        </button>
        {showVisibilityPicker && (
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-label={t('dice.rollerVisibilityToggleAria')}
            title={t(visibility === 'public' ? 'dice.visibilityPublic' : visibility === 'gm_only' ? 'dice.visibilityGmOnly' : 'dice.visibilityPrivate')}
            className="text-xs opacity-70 hover:opacity-100"
          >
            {visibility === 'public' ? '👁' : '🙈'}
          </button>
        )}
      </div>
      {showVisibilityPicker && pickerOpen && (
        <DiceRollVisibilityPicker
          visibility={visibility}
          onVisibilityChange={setVisibility}
          visibleToUserId={visibleToUserId}
          onVisibleToUserIdChange={setVisibleToUserId}
          members={members}
        />
      )}
      {rollMutation.isError && <ErrorBanner message={errorMessage(rollMutation.error)} />}
      {result && (
        <div aria-live="polite">
          <DiceRollResult roll={result} />
        </div>
      )}
    </div>
  );
}

function DiceRollResult({ roll }: { roll: DiceRoll }) {
  const keptIndex = keptDieIndex(roll.d20_rolls, roll.keep);
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums">
      <div className="flex items-center gap-1">
        {roll.d20_rolls.map((value, i) => (
          <DieFace key={i} value={value} kept={i === keptIndex} sides={roll.dice_sides} />
        ))}
      </div>
      <span className="text-stone-500">{formatModifier(roll.modifier)}</span>
      <span className="text-stone-500">=</span>
      {/* The actual roll result — the single number a roll exists to
          produce, sized to match. */}
      <span className="font-bold text-xl text-stone-100">{roll.result_total}</span>
    </div>
  );
}

/**
 * Which index of `d20_rolls` is the "kept" die — normal always keeps the
 * (only) first roll; advantage keeps the higher of the two; disadvantage
 * keeps the lower. Exported so DiceRollHistoryPage can render the same
 * kept/nat20/nat1 visuals for rolls that arrive over the socket rather than
 * through this component's own mutation.
 */
export function keptDieIndex(rolls: number[], keep: DiceRollKeep): number {
  if (rolls.length <= 1) return 0;
  return keep === 'disadvantage' ? rolls.indexOf(Math.min(...rolls)) : rolls.indexOf(Math.max(...rolls));
}

/**
 * One die face. Nat20/nat1 highlighting is computed purely from the raw
 * `value` passed in (always a d20_rolls entry, never result_total) per
 * PLAN.md's "no redundant stored boolean" note — a value of 20 is always a
 * nat20 regardless of modifier. Only applies when `sides` is 20 — a "1" on a
 * d6 or d100 isn't a critical fumble by 5e rules, so non-d20 dice never get
 * the nat20/nat1 styling regardless of value.
 */
export function DieFace({ value, kept, sides = 20 }: { value: number; kept: boolean; sides?: number }) {
  const { t } = useLocale();
  const isNat20 = sides === 20 && value === 20;
  const isNat1 = sides === 20 && value === 1;
  return (
    <span
      title={kept ? t('dice.rollerKept') : t('dice.rollerNotKept')}
      className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border font-mono text-sm font-semibold tabular-nums ${
        kept ? 'ring-2 ring-amber-500' : 'opacity-50'
      } ${
        isNat20
          ? 'border-emerald-600 bg-emerald-950/60 text-emerald-400'
          : isNat1
            ? 'border-red-700 bg-red-950/60 text-red-400'
            : 'border-stone-700 bg-stone-800 text-stone-200'
      }`}
    >
      {value}
    </span>
  );
}
