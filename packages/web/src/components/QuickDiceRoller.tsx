import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { formatModifier } from '../lib/dnd-math';
import { DICE_SIDES, type DiceRoll, type DiceRollKeep } from '../lib/types';
import { DieFace, keptDieIndex } from './DiceRoller';
import { DiceRollVisibilityPicker, useDiceRollVisibilityState } from './DiceRollVisibilityPicker';
import { ErrorBanner, errorMessage } from './Feedback';
import { useLocale } from '../i18n/LocaleContext';

interface ParsedExpression {
  count: number;
  sides: number;
  modifier: number;
}

// Accepts "d20", "1d20", "2d6+3", "4d6-1" — a single die-type + optional flat
// modifier, which is the only shape 5e actually needs (attack/damage dice are
// always "NdM+K", never a mix of die types in one roll). Anything else
// (empty count defaults to 1, missing modifier defaults to 0) is a parse
// error surfaced inline rather than guessed at.
export function parseDiceExpression(input: string): ParsedExpression | null {
  const match = input.trim().match(/^(\d*)d(\d+)\s*([+-]\s*\d+)?$/i);
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3].replace(/\s+/g, '')) : 0;
  if (!DICE_SIDES.includes(sides as (typeof DICE_SIDES)[number])) return null;
  if (count < 1 || count > 20) return null;
  return { count, sides, modifier };
}

export interface QuickDiceRollerProps {
  characterId?: string;
  monsterInstanceId?: string;
  encounterId?: string;
  className?: string;
}

/**
 * General-purpose "roll anything" widget — quick buttons for the standard
 * die sizes plus a free-typed expression box ("2d6+3"), with advantage/
 * disadvantage available whenever the current roll resolves to a single d20.
 * Distinct from DiceRoller.tsx (a contextual roll-TRIGGER embedded next to a
 * specific skill/save/attack with a caller-supplied modifier) — this is the
 * standalone roller a user reaches for when they just want to roll dice,
 * which nothing in the app offered before.
 */
export function QuickDiceRoller({ characterId, monsterInstanceId, encounterId, className = '' }: QuickDiceRollerProps) {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const isDm = role === 'dm';
  const [expression, setExpression] = useState('1d20');
  const [keep, setKeep] = useState<DiceRollKeep>('normal');
  const [result, setResult] = useState<DiceRoll | null>(null);

  // Iteration 3 §2.4 — DM-only. Never shown to a player: rollDice rejects
  // anything but 'public' from a non-DM anyway, so hiding the picker here
  // just avoids offering a control that would 403.
  const { visibility, setVisibility, visibleToUserId, setVisibleToUserId, members } = useDiceRollVisibilityState(campaignId, isDm);

  // Iteration 3 §2.3/2.4 "both physical and digital dice matter equally" —
  // a manual-entry toggle that swaps the roll button for per-die number
  // inputs matching the parsed expression's dice count/sides; the request
  // still goes through the exact same endpoint, only the SOURCE of the raw
  // values differs (see schemas/diceRolls.ts's manualRolls field).
  const [manualMode, setManualMode] = useState(false);
  const [manualValues, setManualValues] = useState<string[]>([]);

  const parsed = parseDiceExpression(expression);
  const isD20 = parsed?.sides === 20;
  const manualRollCount = parsed ? (isD20 && keep !== 'normal' ? 2 : parsed.count) : 0;
  useEffect(() => {
    setManualValues((prev) => Array.from({ length: manualRollCount }, (_, i) => prev[i] ?? ''));
  }, [manualRollCount]);
  const parsedManualValues = manualValues.map((v) => Number(v));
  const manualValuesValid =
    !manualMode ||
    (parsedManualValues.length === manualRollCount &&
      parsedManualValues.every((v) => Number.isInteger(v) && v >= 1 && parsed && v <= parsed.sides));

  const keepOptions: Array<{ value: DiceRollKeep; label: string }> = [
    { value: 'disadvantage', label: t('dice.rollerDisadvantage') },
    { value: 'normal', label: t('dice.rollerNormal') },
    { value: 'advantage', label: t('dice.rollerAdvantage') },
  ];

  const rollMutation = useMutation({
    mutationFn: () => {
      if (!parsed) throw new Error(t('dice.quickInvalidExpression'));
      return api.post<{ roll: DiceRoll }>(`/campaigns/${campaignId}/dice-rolls`, {
        rollType: 'custom',
        rollContext: expression.trim(),
        keep: parsed.sides === 20 ? keep : 'normal',
        diceSides: parsed.sides,
        diceCount: parsed.count,
        modifier: parsed.modifier,
        characterId,
        monsterInstanceId,
        encounterId,
        visibility: isDm ? visibility : 'public',
        visibleToUserId: isDm && visibility === 'private' ? visibleToUserId || undefined : undefined,
        manualRolls: manualMode ? parsedManualValues : undefined,
      });
    },
    onSuccess: (data) => setResult(data.roll),
  });

  return (
    <div className={`rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 space-y-3 ${className}`}>
      <h3 className="text-xs uppercase text-stone-500">{t('dice.quickHeading')}</h3>

      <div className="flex flex-wrap gap-1.5">
        {DICE_SIDES.map((sides) => (
          <button
            key={sides}
            type="button"
            onClick={() => {
              setExpression(`1d${sides}`);
              setResult(null);
            }}
            className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-semibold px-2.5 py-1.5"
          >
            d{sides}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={expression}
          onChange={(e) => {
            setExpression(e.target.value);
            setResult(null);
          }}
          placeholder={t('dice.quickPlaceholder')}
          className="w-28 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100 font-mono"
        />
        {isD20 && (
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
                className={`px-1.5 py-1.5 transition-colors ${
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
        <label className="flex items-center gap-1.5 text-[11px] text-stone-400">
          <input type="checkbox" checked={manualMode} onChange={(e) => setManualMode(e.target.checked)} />
          {t('dice.manualEntryToggle')}
        </label>
        {!manualMode && (
          <button
            type="button"
            disabled={!parsed || rollMutation.isPending}
            onClick={() => rollMutation.mutate()}
            className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs"
          >
            {rollMutation.isPending ? t('dice.quickRolling') : t('dice.rollerRollButton')}
          </button>
        )}
      </div>

      {manualMode && parsed && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-stone-500">{t('dice.manualEntryHint', { count: manualRollCount, sides: parsed.sides })}</span>
          {manualValues.map((v, i) => (
            <input
              key={i}
              type="number"
              min={1}
              max={parsed.sides}
              value={v}
              onChange={(e) => setManualValues((prev) => prev.map((p, pi) => (pi === i ? e.target.value : p)))}
              className="w-14 rounded-md bg-stone-800 border border-stone-700 px-1.5 py-1 text-sm text-stone-100 text-center"
            />
          ))}
          <button
            type="button"
            disabled={!parsed || !manualValuesValid || rollMutation.isPending}
            onClick={() => rollMutation.mutate()}
            className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs"
          >
            {rollMutation.isPending ? t('dice.quickRolling') : t('dice.rollerRollButton')}
          </button>
        </div>
      )}

      {isDm && (
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-800 pt-2">
          <span className="text-[11px] text-stone-500">{t('dice.visibilityLabel')}</span>
          <DiceRollVisibilityPicker
            visibility={visibility}
            onVisibilityChange={setVisibility}
            visibleToUserId={visibleToUserId}
            onVisibleToUserIdChange={setVisibleToUserId}
            members={members}
          />
        </div>
      )}

      {!parsed && expression.trim() !== '' && (
        <p className="text-xs text-red-400">{t('dice.quickInvalidExpression')}</p>
      )}
      {rollMutation.isError && <ErrorBanner message={errorMessage(rollMutation.error)} />}
      {result && (
        <div aria-live="polite">
          <QuickRollResult roll={result} />
        </div>
      )}
    </div>
  );
}

function QuickRollResult({ roll }: { roll: DiceRoll }) {
  const keptIndex = keptDieIndex(roll.d20_rolls, roll.keep);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <div className="flex items-center gap-1 flex-wrap">
        {roll.d20_rolls.map((value, i) => (
          <DieFace key={i} value={value} kept={i === keptIndex} sides={roll.dice_sides} />
        ))}
      </div>
      {roll.modifier !== 0 && <span className="text-stone-500">{formatModifier(roll.modifier)}</span>}
      <span className="text-stone-500">=</span>
      <span className="font-semibold text-stone-100 text-base">{roll.result_total}</span>
    </div>
  );
}
