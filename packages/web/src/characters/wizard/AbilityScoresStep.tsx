// Thin wrapper reusing AbilityScoreGenerator.tsx as-is (all four modes,
// including point-buy's own 27-point budget validation/Apply-gating) plus
// the same six raw score inputs CharactersListPage.tsx's existing quick-
// create form already uses for manual entry/fine-tuning after Apply.
import type { AbilityKey } from '../abilityScoreGeneration';
import { AbilityScoreGenerator } from '../AbilityScoreGenerator';
import { useLocale } from '../../i18n/LocaleContext';
import type { StepValidation } from './validation';

const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export function AbilityScoresStep({
  campaignId,
  allowReroll,
  scores,
  onChangeScores,
  validation,
  readOnly,
}: {
  campaignId: string;
  allowReroll: boolean;
  scores: Record<AbilityKey, number>;
  onChangeScores: (scores: Record<AbilityKey, number>) => void;
  validation: StepValidation;
  readOnly: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-4">
      {!readOnly && (
        <AbilityScoreGenerator campaignId={campaignId} allowReroll={allowReroll} onApply={(next) => onChangeScores({ ...scores, ...next })} />
      )}

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {ABILITY_KEYS.map((key) => (
          <div key={key}>
            <label htmlFor={`wizardScore-${key}`} className="block text-xs font-medium text-stone-400 mb-1 uppercase">
              {key}
            </label>
            <input
              id={`wizardScore-${key}`}
              type="number"
              min={1}
              max={30}
              value={scores[key]}
              disabled={readOnly}
              onChange={(e) => onChangeScores({ ...scores, [key]: Number(e.target.value) })}
              className={`w-full min-h-11 rounded-md bg-stone-800 border px-2 py-1.5 text-stone-100 text-center ${
                validation.errors[key] ? 'border-red-500' : 'border-stone-700'
              }`}
            />
          </div>
        ))}
      </div>
      {!validation.valid && <p className="text-xs text-red-400">{t('characters.wizard.abilityScores.outOfRange')}</p>}
    </div>
  );
}
