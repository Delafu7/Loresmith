import { useState } from 'react';
import type { CatalogField } from './catalogEntities';
import { Field, Input, Textarea, Select } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { ErrorBanner, errorMessage } from '../components/Feedback';

export type DraftValues = Record<string, string>;

function draftFromEntry(fields: CatalogField[], entry: Record<string, unknown> | null): DraftValues {
  const draft: DraftValues = {};
  for (const f of fields) {
    if (!entry) {
      draft[f.key] = f.type === 'boolean' ? 'false' : '';
      continue;
    }
    const column = f.key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const value = entry[column];
    if (value === null || value === undefined) draft[f.key] = '';
    else if (f.type === 'json') draft[f.key] = JSON.stringify(value, null, 2);
    else if (f.type === 'boolean') draft[f.key] = String(value);
    else draft[f.key] = String(value);
  }
  return draft;
}

/**
 * Builds the JSON request body from draft string values, per field type.
 * Throws a plain Error with a field-identifying message on a bad JSON
 * field, caught by the caller and shown inline rather than crashing.
 */
function buildPayload(fields: CatalogField[], draft: DraftValues): Record<string, unknown> {
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
        if (raw.trim() === '') {
          payload[f.key] = null;
          break;
        }
        try {
          payload[f.key] = JSON.parse(raw);
        } catch {
          throw new Error(`"${f.label}" isn't valid JSON.`);
        }
        break;
      default:
        payload[f.key] = raw;
    }
  }
  return payload;
}

export function CatalogEntryForm({
  fields,
  entry,
  onSubmit,
  onCancel,
  submitting,
}: {
  fields: CatalogField[];
  entry: Record<string, unknown> | null; // null = create; otherwise the row being edited
  onSubmit: (payload: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [draft, setDraft] = useState<DraftValues>(() => draftFromEntry(fields, entry));
  const [formError, setFormError] = useState<unknown>(null);

  function setField(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const payload = buildPayload(fields, draft);
      await onSubmit(payload);
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
        if (f.type === 'select') {
          return (
            <Field key={f.key} label={f.label} htmlFor={id}>
              <Select id={id} value={draft[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} required={f.required}>
                <option value="">{f.required ? 'Select…' : '(none)'}</option>
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
          {submitting ? 'Saving…' : entry ? 'Save changes' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
