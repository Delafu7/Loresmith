// Generic over ELEMENT_REGISTRY's `fields` list — one `<GenericField>` per
// entry, driven entirely by each spec's `kind`. Label/visibleToPlayers/
// locked are the one universal block every type shares (MapElementBase), so
// they're rendered here directly rather than via the registry; everything
// type-specific comes from `fields`. No type-specific branch anywhere in
// this file — see registry.tsx's header comment for the contract.
import { useState } from 'react';
import type { MapElement } from '../../lib/types';
import { useLocale, type TranslationKey } from '../../i18n/LocaleContext';
import { Modal } from '../../components/ui/Modal';
import { Field, Input, Textarea, Select, useFieldId } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { ErrorBanner, errorMessage } from '../../components/Feedback';
import { ELEMENT_REGISTRY, type ElementFieldSpec } from './registry';
import { useUpdateMapElement, useDeleteMapElement } from './useMapElements';

function GenericField({ spec, value, onChange, idPrefix }: { spec: ElementFieldSpec; value: unknown; onChange: (v: unknown) => void; idPrefix: string }) {
  const { t } = useLocale();
  const id = `${idPrefix}-${spec.key}`;
  const label = t(spec.labelKey as TranslationKey);

  switch (spec.kind) {
    case 'text':
      return (
        <Field label={label} htmlFor={id}>
          <Input id={id} type="text" maxLength={spec.maxLength} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'textarea':
      return (
        <Field label={label} htmlFor={id}>
          <Textarea id={id} maxLength={spec.maxLength} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'number':
      return (
        <Field label={label} htmlFor={id}>
          <Input
            id={id}
            type="number"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            value={Number(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </Field>
      );
    case 'select':
      return (
        <Field label={label} htmlFor={id}>
          <Select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey as TranslationKey)}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'color':
      return (
        <Field label={label} htmlFor={id}>
          <input id={id} type="color" value={String(value ?? '#888888')} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-md border border-stone-700 bg-stone-800" />
        </Field>
      );
    case 'unit':
      return (
        <Field label={`${label} (${Math.round(Number(value ?? 0) * 100)}%)`} htmlFor={id}>
          <input
            id={id}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={Number(value ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        </Field>
      );
  }
}

export function ElementPropertyPanel({
  encounterId,
  element,
  onClose,
}: {
  encounterId: string;
  element: MapElement;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const entry = ELEMENT_REGISTRY[element.type];
  const idPrefix = useFieldId('mapElement');

  const [label, setLabel] = useState(element.label ?? '');
  const [visibleToPlayers, setVisibleToPlayers] = useState(element.visibleToPlayers);
  const [locked, setLocked] = useState(element.locked);
  const [props, setProps] = useState<Record<string, unknown>>(element.props);

  const updateMutation = useUpdateMapElement(encounterId);
  const deleteMutation = useDeleteMapElement(encounterId);

  function setField(key: string, value: unknown) {
    setProps((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    updateMutation.mutate(
      { elementId: element.id, patch: { label: label.trim() === '' ? null : label, visibleToPlayers, locked, props } },
      { onSuccess: onClose },
    );
  }

  function handleDelete() {
    if (!window.confirm(t('encounters.mapElements.deleteConfirm'))) return;
    deleteMutation.mutate(element.id, { onSuccess: onClose });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t(entry.labelKey as TranslationKey)} — ${t('encounters.mapElements.editElement')}`}
      actions={
        <>
          <Button variant="danger" onClick={handleDelete} disabled={deleteMutation.isPending}>
            {t('encounters.mapElements.delete')}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t('encounters.mapElements.saving') : t('encounters.mapElements.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {(updateMutation.isError || deleteMutation.isError) && (
          <ErrorBanner message={errorMessage(updateMutation.error ?? deleteMutation.error)} />
        )}

        <Field label={t('encounters.mapElements.label')} htmlFor={`${idPrefix}-label`}>
          <Input id={`${idPrefix}-label`} type="text" maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>

        {entry.fields.map((spec) => (
          <GenericField key={spec.key} spec={spec} value={props[spec.key]} onChange={(v) => setField(spec.key, v)} idPrefix={idPrefix} />
        ))}

        <label className="flex items-center gap-2 text-sm text-stone-300">
          <input type="checkbox" checked={visibleToPlayers} onChange={(e) => setVisibleToPlayers(e.target.checked)} className="accent-amber-500" />
          {t('encounters.mapElements.visibleToPlayers')}
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-300">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} className="accent-amber-500" />
          {t('encounters.mapElements.locked')}
        </label>
      </div>
    </Modal>
  );
}
