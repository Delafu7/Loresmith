import type { WizardDraft } from './types';
import type { CampaignMember } from '../../lib/types';
import { useRacesCatalog, useSubracesCatalog, useBackgroundsCatalog, useClassesCatalog, useSubclassesCatalog } from '../../lib/useCatalog';
import { Field, Input } from '../../components/ui/Field';
import { Combobox } from '../../components/Combobox';
import { useLocale } from '../../i18n/LocaleContext';
import type { StepValidation } from './validation';

export function IdentityStep({
  draft,
  onChange,
  edition,
  role,
  players,
  validation,
  readOnly,
}: {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  edition: '2014' | '2024';
  role: 'dm' | 'player';
  players: CampaignMember[];
  validation: StepValidation;
  readOnly: boolean;
}) {
  const { t } = useLocale();
  const racesQuery = useRacesCatalog(edition);
  const subracesQuery = useSubracesCatalog(edition);
  const backgroundsQuery = useBackgroundsCatalog(edition);
  const classesQuery = useClassesCatalog(edition);
  const subclassesQuery = useSubclassesCatalog(edition);

  const subracesForRace = (subracesQuery.data?.subraces ?? []).filter((s) => s.race_id === draft.raceId);
  const subclassesForClass = (subclassesQuery.data?.subclasses ?? []).filter((s) => s.class_id === draft.classId);

  return (
    <div className="space-y-4">
      <Field label={t('characters.wizard.identity.nameLabel')} htmlFor="wizardName" error={validation.errors.name ? t('characters.wizard.identity.nameRequired') : undefined}>
        <Input id="wizardName" value={draft.name} disabled={readOnly} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>

      {role === 'dm' && (
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input type="radio" checked={draft.isPc} disabled={readOnly} onChange={() => onChange({ isPc: true })} />
            {t('characters.common.playerCharacter')}
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input type="radio" checked={!draft.isPc} disabled={readOnly} onChange={() => onChange({ isPc: false, quickCreate: true })} />
            {t('characters.common.npc')}
          </label>
        </div>
      )}

      {role === 'dm' && draft.isPc && (
        <Field label={t('characters.list.owningPlayer')} htmlFor="wizardOwner">
          <select
            id="wizardOwner"
            value={draft.ownerUserId}
            disabled={readOnly}
            onChange={(e) => onChange({ ownerUserId: e.target.value })}
            className="w-full min-h-11 rounded-md border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100"
          >
            <option value="">{t('characters.list.leaveUnassigned')}</option>
            {players.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name} ({p.email})
              </option>
            ))}
          </select>
        </Field>
      )}

      <label className="flex items-center gap-2 text-sm text-stone-300">
        <input
          type="checkbox"
          checked={draft.quickCreate}
          disabled={readOnly || (role === 'dm' && !draft.isPc)}
          onChange={(e) => onChange({ quickCreate: e.target.checked })}
        />
        {t('characters.wizard.identity.quickCreate')}
      </label>
      <p className="text-xs text-stone-500 -mt-2">{t('characters.wizard.identity.quickCreateHint')}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('characters.wizard.identity.race')} htmlFor="wizardRace" error={validation.errors.raceId ? t('characters.wizard.identity.fieldRequired') : undefined}>
          <Combobox
            value={draft.raceId}
            onChange={(v) => onChange({ raceId: v, subraceId: '' })}
            options={(racesQuery.data?.races ?? []).map((r) => ({ value: r.id, label: r.name }))}
            placeholder={t('common.search')}
            className={readOnly ? 'pointer-events-none opacity-60' : ''}
          />
        </Field>
        {subracesForRace.length > 0 && (
          <Field label={t('characters.wizard.identity.subrace')} htmlFor="wizardSubrace">
            <Combobox
              value={draft.subraceId}
              onChange={(v) => onChange({ subraceId: v })}
              options={subracesForRace.map((s) => ({ value: s.id, label: s.name }))}
              placeholder={t('common.search')}
              className={readOnly ? 'pointer-events-none opacity-60' : ''}
            />
          </Field>
        )}

        <Field label={t('characters.wizard.identity.background')} htmlFor="wizardBackground" error={validation.errors.backgroundId ? t('characters.wizard.identity.fieldRequired') : undefined}>
          <Combobox
            value={draft.backgroundId}
            onChange={(v) => onChange({ backgroundId: v })}
            options={(backgroundsQuery.data?.backgrounds ?? []).map((b) => ({ value: b.id, label: b.name }))}
            placeholder={t('common.search')}
            className={readOnly ? 'pointer-events-none opacity-60' : ''}
          />
        </Field>

        <Field label={t('characters.wizard.identity.class')} htmlFor="wizardClass" error={validation.errors.classId ? t('characters.wizard.identity.fieldRequired') : undefined}>
          <Combobox
            value={draft.classId}
            onChange={(v) => onChange({ classId: v, subclassId: '' })}
            options={(classesQuery.data?.classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
            placeholder={t('common.search')}
            className={readOnly ? 'pointer-events-none opacity-60' : ''}
          />
        </Field>
        {subclassesForClass.length > 0 && (
          <Field label={t('characters.wizard.identity.subclass')} htmlFor="wizardSubclass">
            <Combobox
              value={draft.subclassId}
              onChange={(v) => onChange({ subclassId: v })}
              options={subclassesForClass.map((s) => ({ value: s.id, label: s.name }))}
              placeholder={t('common.search')}
              className={readOnly ? 'pointer-events-none opacity-60' : ''}
            />
          </Field>
        )}

        <Field label={t('characters.wizard.identity.level')} htmlFor="wizardLevel">
          <Input
            id="wizardLevel"
            type="number"
            min={1}
            max={20}
            value={draft.level}
            disabled={readOnly}
            onChange={(e) => onChange({ level: Math.min(20, Math.max(1, Number(e.target.value))) })}
          />
        </Field>
        <Field label={t('characters.wizard.identity.alignment')} htmlFor="wizardAlignment">
          <Input id="wizardAlignment" value={draft.alignment} disabled={readOnly} onChange={(e) => onChange({ alignment: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}
