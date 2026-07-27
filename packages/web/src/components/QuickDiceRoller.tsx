import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { formatModifier } from '../lib/dnd-math';
import { DICE_SIDES, type DiceRoll, type DiceRollKeep } from '../lib/types';
import { DieFace, keptDieIndex } from './DiceRoller';
import { ErrorBanner, errorMessage } from './Feedback';

const KEEP_OPTIONS: Array<{ value: DiceRollKeep; label: string }> = [
  { value: 'disadvantage', label: 'Disadv' },
  { value: 'normal', label: 'Normal' },
  { value: 'advantage', label: 'Adv' },
];

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
  characterId?: number;
  monsterInstanceId?: number;
  encounterId?: number;
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
  const { campaignId } = useCampaignShell();
  const [expression, setExpression] = useState('1d20');
  const [keep, setKeep] = useState<DiceRollKeep>('normal');
  const [result, setResult] = useState<DiceRoll | null>(null);

  const parsed = parseDiceExpression(expression);
  const isD20 = parsed?.sides === 20;

  const rollMutation = useMutation({
    mutationFn: () => {
      if (!parsed) throw new Error('Invalid dice expression');
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
      });
    },
    onSuccess: (data) => setResult(data.roll),
  });

  return (
    <div className={`rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-3 ${className}`}>
      <h3 className="text-xs uppercase text-stone-500">Roll dice</h3>

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
          placeholder="e.g. 2d6+3"
          className="w-28 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100 font-mono"
        />
        {isD20 && (
          <div
            role="radiogroup"
            aria-label="Roll mode"
            className="inline-flex rounded-md border border-stone-700 overflow-hidden text-[10px] leading-none"
          >
            {KEEP_OPTIONS.map((opt) => (
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
        <button
          type="button"
          disabled={!parsed || rollMutation.isPending}
          onClick={() => rollMutation.mutate()}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs"
        >
          {rollMutation.isPending ? 'Rolling…' : 'Roll'}
        </button>
      </div>

      {!parsed && expression.trim() !== '' && (
        <p className="text-xs text-red-400">Expected a die expression like "d20", "2d6", or "2d6+3".</p>
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
