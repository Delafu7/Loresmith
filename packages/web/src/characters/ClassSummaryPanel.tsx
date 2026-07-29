import { useEffect, useState } from 'react';
import type { ClassCatalog, CharacterClass, MulticlassPrereqFailure, SubclassCatalog } from '../lib/types';
import { ApiError } from '../lib/api';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';

interface DraftRow {
  classId: string;
  subclassId: string | null;
  level: number;
}

function formatValidationError(error: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
    const failures = (error.details as { failures?: MulticlassPrereqFailure[] } | null | undefined)?.failures;
    if (Array.isArray(failures) && failures.length > 0) {
      return (
        <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 text-red-300 text-xs px-3 py-2 space-y-1">
          <p className="font-semibold">{t('characters.classSummary.prereqFailedTitle')}</p>
          <ul className="list-disc list-inside space-y-0.5">
            {failures.map((f, i) => (
              <li key={i}>
                {t('characters.classSummary.prereqFailureLine', {
                  className: f.className,
                  ability: f.abilityIndex.toUpperCase(),
                  required: f.required,
                  actual: f.actual,
                })}
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }
  return <ErrorBanner message={errorMessage(error)} />;
}

export function ClassSummaryPanel({
  classesCatalog,
  subclassesCatalog,
  classRows,
  editable,
  onSave,
  saving,
}: {
  classesCatalog: ClassCatalog[];
  subclassesCatalog: SubclassCatalog[];
  classRows: CharacterClass[];
  editable: boolean;
  // Returns a Promise (backed by TanStack Query's mutateAsync) so this panel
  // can stay open and show a readable inline error on a 4xx VALIDATION_ERROR
  // (multiclass prerequisites not met) instead of closing immediately and
  // losing the user's in-progress edit — see formatValidationError above.
  onSave: (rows: DraftRow[]) => Promise<unknown>;
  saving?: boolean;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftRow[]>(
    classRows.map((r) => ({ classId: r.class_id, subclassId: r.subclass_id, level: r.level })),
  );
  const [saveError, setSaveError] = useState<unknown>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(classRows.map((r) => ({ classId: r.class_id, subclassId: r.subclass_id, level: r.level })));
    }
  }, [classRows, editing]);

  const classById = new Map(classesCatalog.map((c) => [c.id, c]));
  const subclassById = new Map(subclassesCatalog.map((s) => [s.id, s]));
  const totalLevel = classRows.reduce((sum, r) => sum + r.level, 0) || 1;

  if (!editing) {
    return (
      <div className="rounded-md bg-stone-900 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{t('characters.classSummary.title')}</h3>
          {editable && (
            <button
              type="button"
              onClick={() => {
                setSaveError(null);
                setEditing(true);
              }}
              className="text-xs text-amber-500 hover:text-amber-400"
            >
              {t('common.edit')}
            </button>
          )}
        </div>
        {classRows.length === 0 ? (
          <p className="text-stone-500 text-sm italic">{t('characters.classSummary.noClasses')}</p>
        ) : (
          <ul className="text-sm text-stone-200 space-y-1">
            {classRows.map((r) => {
              const subclass = r.subclass_id != null ? subclassById.get(r.subclass_id) : undefined;
              return (
                <li key={r.class_id}>
                  {classById.get(r.class_id)?.name ?? t('characters.classSummary.classFallback', { id: r.class_id })} {r.level}
                  {subclass ? ` (${subclass.name})` : ''}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-stone-500 mt-2">{t('characters.classSummary.totalLevel', { level: totalLevel })}</p>
      </div>
    );
  }

  function updateRow(idx: number, patch: Partial<DraftRow>) {
    setDraft((d) => d.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setSaveError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setSaveError(err);
    }
  }

  return (
    <div className="rounded-md bg-stone-900 shadow-sm p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-2">{t('characters.classSummary.title')}</h3>
      <div className="space-y-2">
        {draft.map((row, idx) => {
          const subclassOptions = subclassesCatalog.filter((s) => s.class_id === row.classId);
          return (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <select
                value={row.classId}
                onChange={(e) => updateRow(idx, { classId: e.target.value, subclassId: null })}
                className="flex-1 min-w-[8rem] rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100 text-sm"
              >
                {classesCatalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={row.subclassId ?? ''}
                onChange={(e) => updateRow(idx, { subclassId: e.target.value ? e.target.value : null })}
                disabled={subclassOptions.length === 0}
                className="flex-1 min-w-[8rem] rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100 text-sm disabled:opacity-50"
              >
                <option value="">
                  {subclassOptions.length === 0 ? t('characters.classSummary.noSubclassNoneYet') : t('characters.classSummary.noSubclass')}
                </option>
                {subclassOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={20}
                value={row.level}
                onChange={(e) => updateRow(idx, { level: Number(e.target.value) })}
                className="w-16 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100 text-sm text-center"
              />
              <button
                type="button"
                onClick={() => setDraft((d) => d.filter((_, i) => i !== idx))}
                className="text-red-400 hover:text-red-300 text-sm px-1"
                aria-label={t('characters.classSummary.removeClass')}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setDraft((d) => [...d, { classId: classesCatalog[0]?.id ?? '', subclassId: null, level: 1 }])}
          disabled={classesCatalog.length === 0}
          className="text-xs text-amber-500 hover:text-amber-400"
        >
          {draft.length > 0 ? t('characters.classSummary.addClassMulticlass') : t('characters.classSummary.addClass')}
        </button>
      </div>
      {saveError !== null && <div className="mt-3">{formatValidationError(saveError, t)}</div>}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-sm"
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          onClick={() => {
            setSaveError(null);
            setEditing(false);
          }}
          className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
