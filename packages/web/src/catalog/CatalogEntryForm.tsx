import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CatalogField, ReferenceConfig } from './catalogEntities';
import { Field, Input, Textarea, Select } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useFormDraft } from '../lib/useFormDraft';
import { useLocale } from '../i18n/LocaleContext';

export type DraftValues = Record<string, string>;

export function draftFromEntry(fields: CatalogField[], entry: Record<string, unknown> | null): DraftValues {
  const draft: DraftValues = {};
  for (const f of fields) {
    if (!entry) {
      draft[f.key] = f.type === 'boolean' ? 'false' : '';
      continue;
    }
    const column = f.key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const value = entry[column];
    if (value === null || value === undefined) draft[f.key] = '';
    else if (f.type === 'json' || f.type === 'reference-array') draft[f.key] = JSON.stringify(value, null, 2);
    else if (f.type === 'boolean') draft[f.key] = String(value);
    else draft[f.key] = String(value);
  }
  return draft;
}

/**
 * Builds the JSON request body from draft string values, per field type.
 * Throws a plain Error with a field-identifying message on a bad JSON
 * field, caught by the caller and shown inline rather than crashing.
 * `invalidJsonMessage` lets the caller supply a localized message (see
 * useLocale's `catalog.form.invalidJson`) — this module has no component
 * context of its own to call t() with.
 */
export function buildPayload(
  fields: CatalogField[],
  draft: DraftValues,
  invalidJsonMessage: (label: string) => string = (label) => `"${label}" isn't valid JSON.`,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = draft[f.key] ?? '';
    if (raw === '' && !f.required) {
      payload[f.key] = null;
      continue;
    }
    switch (f.type) {
      case 'number':
        payload[f.key] = raw === '' ? null : Number(raw);
        break;
      case 'boolean':
        payload[f.key] = raw === 'true';
        break;
      case 'json':
      case 'reference-array':
        if (raw.trim() === '') {
          payload[f.key] = null;
          break;
        }
        try {
          payload[f.key] = JSON.parse(raw);
        } catch {
          throw new Error(invalidJsonMessage(f.label));
        }
        break;
      default:
        payload[f.key] = raw;
    }
  }
  return payload;
}

// Fetches another catalog table's rows for a reference/reference-array
// field's dropdown, scoped by campaignId/edition only when that reference
// actually varies by them (see REFERENCE_CATALOGS in catalogEntities.ts).
function useReferenceOptions(ref: ReferenceConfig, campaignId: string, edition: string): Array<{ id: string; name: string }> {
  const params = new URLSearchParams();
  if (ref.campaignScoped) params.set('campaignId', campaignId);
  if (ref.editioned) params.set('edition', edition);
  const qs = params.toString();
  const query = useQuery({
    queryKey: ['catalog-reference', ref.endpoint, ref.campaignScoped ? campaignId : null, ref.editioned ? edition : null],
    queryFn: () => api.get<Record<string, Array<{ id: string; name: string }>>>(`/catalog/${ref.endpoint}${qs ? `?${qs}` : ''}`),
  });
  return query.data?.[ref.listResponseKey] ?? [];
}

function ReferenceSelectField({
  field,
  value,
  onChange,
  campaignId,
  edition,
}: {
  field: CatalogField;
  value: string;
  onChange: (value: string) => void;
  campaignId: string;
  edition: string;
}) {
  const { t } = useLocale();
  const options = useReferenceOptions(field.reference!, campaignId, edition);
  const id = `catalog-field-${field.key}`;
  return (
    <Field label={field.label} htmlFor={id} hint={field.helpText}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={field.required}>
        <option value="">{field.required ? t('catalog.form.selectPlaceholder') : t('catalog.form.noneOption')}</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ReferenceMultiSelectField({
  field,
  value,
  onChange,
  campaignId,
  edition,
}: {
  field: CatalogField;
  value: string;
  onChange: (value: string) => void;
  campaignId: string;
  edition: string;
}) {
  const options = useReferenceOptions(field.reference!, campaignId, edition);
  const selected: string[] = (() => {
    try {
      const parsed: unknown = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  })();
  function toggle(optId: string) {
    onChange(JSON.stringify(selected.includes(optId) ? selected.filter((id) => id !== optId) : [...selected, optId]));
  }
  const id = `catalog-field-${field.key}`;
  return (
    <Field label={field.label} htmlFor={id} hint={field.helpText}>
      <div id={id} className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <label
            key={opt.id}
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-stone-800/60 px-2 text-sm text-stone-300"
          >
            <input type="checkbox" checked={selected.includes(opt.id)} onChange={() => toggle(opt.id)} className="size-4" />
            {opt.name}
          </label>
        ))}
      </div>
    </Field>
  );
}

export function CatalogEntryForm({
  fields,
  entry,
  draftKey,
  campaignId,
  edition,
  onSubmit,
  onCancel,
  submitting,
}: {
  fields: CatalogField[];
  entry: Record<string, unknown> | null; // null = create; otherwise the row being edited
  draftKey: string; // unique per campaign+entity-type+(row id or 'new') — see lib/useFormDraft.ts
  campaignId: string; // for reference fields scoped to this campaign's own homebrew + global rows
  edition: string; // campaign's srd_edition, for edition-varying reference fields
  onSubmit: (payload: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const { t } = useLocale();
  const [draft, setDraft, clearDraft] = useFormDraft<DraftValues>(draftKey, () => draftFromEntry(fields, entry));
  const [formError, setFormError] = useState<unknown>(null);

  function setField(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const payload = buildPayload(fields, draft, (label) => t('catalog.form.invalidJson', { label }));
      await onSubmit(payload);
      clearDraft();
    } catch (err) {
      setFormError(err);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {fields.map((f) => {
        const id = `catalog-field-${f.key}`;
        if (f.type === 'boolean') {
          return (
            <label key={f.key} htmlFor={id} className="flex min-h-11 items-center gap-2 text-sm text-stone-300">
              <input
                id={id}
                type="checkbox"
                checked={draft[f.key] === 'true'}
                onChange={(e) => setField(f.key, String(e.target.checked))}
                className="size-4"
              />
              {f.label}
            </label>
          );
        }
        if (f.type === 'reference') {
          return (
            <ReferenceSelectField
              key={f.key}
              field={f}
              value={draft[f.key] ?? ''}
              onChange={(v) => setField(f.key, v)}
              campaignId={campaignId}
              edition={edition}
            />
          );
        }
        if (f.type === 'reference-array') {
          return (
            <ReferenceMultiSelectField
              key={f.key}
              field={f}
              value={draft[f.key] ?? ''}
              onChange={(v) => setField(f.key, v)}
              campaignId={campaignId}
              edition={edition}
            />
          );
        }
        if (f.type === 'select') {
          return (
            <Field key={f.key} label={f.label} htmlFor={id}>
              <Select id={id} value={draft[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} required={f.required}>
                <option value="">{f.required ? t('catalog.form.selectPlaceholder') : t('catalog.form.noneOption')}</option>
                {(f.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }
        if (f.type === 'textarea' || f.type === 'json') {
          return (
            <Field key={f.key} label={f.label} htmlFor={id} hint={f.helpText}>
              <Textarea
                id={id}
                rows={f.type === 'json' ? 4 : 3}
                value={draft[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
                required={f.required}
                className={f.type === 'json' ? 'font-mono text-xs' : undefined}
              />
            </Field>
          );
        }
        return (
          <Field key={f.key} label={f.label} htmlFor={id} hint={f.helpText}>
            <Input
              id={id}
              type={f.type === 'number' ? 'number' : 'text'}
              value={draft[f.key] ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
              required={f.required}
            />
          </Field>
        );
      })}
      {formError !== null && <ErrorBanner message={errorMessage(formError)} />}
      <div className="flex gap-2 pt-2">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? t('catalog.form.saving') : entry ? t('catalog.form.saveChanges') : t('common.create')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
