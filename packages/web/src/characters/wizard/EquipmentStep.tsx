// Trimmed InventoryPanel.tsx-style add-item flow — same item-catalog
// Combobox convention, but deferred: nothing is POSTed to the server until
// the wizard's Equipment->Portrait transition actually creates the
// character (InventoryPanel's own POST /characters/:id/items needs a real
// characterId that doesn't exist yet at this point in the flow).
import { useState } from 'react';
import type { WizardDraft, WizardEquipmentPick } from './types';
import { useItemsCatalog } from '../../lib/useCatalog';
import { Combobox } from '../../components/Combobox';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';
import { Loading } from '../../components/Feedback';
import { useLocale } from '../../i18n/LocaleContext';

export function EquipmentStep({
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
  const itemsQuery = useItemsCatalog(edition);
  const [pickedItemId, setPickedItemId] = useState('');
  const [quantity, setQuantity] = useState(1);

  if (itemsQuery.isLoading) return <Loading />;

  const items = itemsQuery.data?.items ?? [];

  function addItem() {
    const item = items.find((i) => String(i.id) === pickedItemId);
    if (!item) return;
    const pick: WizardEquipmentPick = { itemId: pickedItemId, name: item.name, quantity: Math.max(1, quantity) };
    onChange({ equipment: [...draft.equipment, pick] });
    setPickedItemId('');
    setQuantity(1);
  }

  function removeItem(index: number) {
    onChange({ equipment: draft.equipment.filter((_, i) => i !== index) });
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label={t('characters.wizard.equipment.itemLabel')} htmlFor="wizardItemPick">
              <Combobox
                value={pickedItemId}
                onChange={setPickedItemId}
                options={items.map((i) => ({ value: String(i.id), label: `${i.name} (${i.rarity})` }))}
              />
            </Field>
          </div>
          <Field label={t('characters.wizard.equipment.quantityLabel')} htmlFor="wizardItemQty" className="w-20">
            <Input id="wizardItemQty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
          </Field>
          <Button variant="secondary" onClick={addItem} disabled={!pickedItemId}>
            {t('characters.wizard.equipment.add')}
          </Button>
        </div>
      )}

      {draft.equipment.length === 0 ? (
        <p className="text-xs text-stone-500 italic">{t('characters.wizard.equipment.none')}</p>
      ) : (
        <ul className="divide-y divide-stone-800 rounded-md bg-stone-900">
          {draft.equipment.map((pick, i) => (
            <li key={`${pick.itemId}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-stone-200">
                {pick.name} {pick.quantity > 1 && <span className="text-stone-500">×{pick.quantity}</span>}
              </span>
              {!readOnly && (
                <button type="button" onClick={() => removeItem(i)} className="text-xs text-stone-500 hover:text-red-400">
                  {t('common.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Field label={t('characters.wizard.equipment.notesLabel')} htmlFor="wizardNotes">
        <Textarea id="wizardNotes" rows={4} value={draft.notes} disabled={readOnly} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
    </div>
  );
}
