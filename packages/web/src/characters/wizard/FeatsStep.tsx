// Feat selection — same deferred-until-creation pattern as EquipmentStep.tsx
// (nothing is POSTed to /characters/:id/feats until the wizard's
// Equipment->Portrait transition actually creates the character; see
// CharacterCreationWizard.tsx's submit flow). Optional: a character can be
// created with zero feats, same as skills/equipment.
import { useState } from 'react';
import type { WizardDraft } from './types';
import { useFeatsCatalog } from '../../lib/useCatalog';
import { Combobox } from '../../components/Combobox';
import { Field } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { Loading } from '../../components/Feedback';
import { useLocale } from '../../i18n/LocaleContext';

export function FeatsStep({
  draft,
  onChange,
  edition,
  readOnly,
}: {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  edition: '2014' | '2024';
  readOnly: boolean;
}) {
  const { t } = useLocale();
  const featsQuery = useFeatsCatalog(edition);
  const [pickedFeatId, setPickedFeatId] = useState('');

  if (featsQuery.isLoading) return <Loading />;

  const feats = featsQuery.data?.feats ?? [];
  const availableFeats = feats.filter((f) => !draft.featIds.includes(f.id));
  const pickedFeats = draft.featIds.map((id) => feats.find((f) => f.id === id)).filter((f) => f !== undefined);

  function addFeat() {
    if (!pickedFeatId || draft.featIds.includes(pickedFeatId)) return;
    onChange({ featIds: [...draft.featIds, pickedFeatId] });
    setPickedFeatId('');
  }

  function removeFeat(featId: string) {
    onChange({ featIds: draft.featIds.filter((id) => id !== featId) });
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label={t('characters.wizard.feats.featLabel')} htmlFor="wizardFeatPick">
              <Combobox
                value={pickedFeatId}
                onChange={setPickedFeatId}
                options={availableFeats.map((f) => ({ value: f.id, label: f.name }))}
              />
            </Field>
          </div>
          <Button variant="secondary" onClick={addFeat} disabled={!pickedFeatId}>
            {t('characters.wizard.feats.add')}
          </Button>
        </div>
      )}

      {pickedFeats.length === 0 ? (
        <p className="text-xs text-stone-500 italic">{t('characters.wizard.feats.none')}</p>
      ) : (
        <ul className="divide-y divide-stone-800 rounded-md bg-stone-900">
          {pickedFeats.map((feat) => (
            <li key={feat.id} className="px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-stone-200 font-medium">{feat.name}</span>
                {!readOnly && (
                  <button type="button" onClick={() => removeFeat(feat.id)} className="text-xs text-stone-500 hover:text-red-400 flex-shrink-0">
                    {t('common.delete')}
                  </button>
                )}
              </div>
              {feat.prerequisite && <p className="text-xs text-stone-500 mt-0.5">{t('characters.wizard.feats.prerequisite', { prerequisite: feat.prerequisite })}</p>}
              <p className="text-xs text-stone-400 mt-1">{feat.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
