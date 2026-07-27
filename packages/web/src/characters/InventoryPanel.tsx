import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Character, CharacterItem, ItemCatalogEntry, ItemRarity, UpdateCharacterItemBody } from '../lib/types';
import { useDamageTypesCatalog, useItemsCatalog } from '../lib/useCatalog';
import { ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { DiceRoller } from '../components/DiceRoller';
import { parseDiceExpression } from '../components/QuickDiceRoller';
import { Combobox } from '../components/Combobox';
import { abilityModifier, proficiencyBonusForLevel } from '../lib/dnd-math';

const RARITY_COLOR: Record<ItemRarity, string> = {
  mundane: 'text-stone-500',
  common: 'text-stone-300',
  uncommon: 'text-emerald-400',
  rare: 'text-sky-400',
  very_rare: 'text-violet-400',
  legendary: 'text-amber-400',
  artifact: 'text-red-400',
};

// Attack-roll ability modifier for an equipped weapon (Phase 3.4). This app
// has no granular per-weapon proficiency tracking on characters (the
// character_classes/skill/saving-throw schema never recorded a
// weapon-proficiency list), so — as a documented simplification — every
// equipped weapon roll assumes proficiency always applies; the caller adds
// `proficiencyBonus` unconditionally rather than this function checking a
// proficiency list that doesn't exist.
//
// Melee-vs-ranged has no dedicated catalog field either (ItemCatalogEntry's
// `properties` is an untyped `Record<string, unknown> | null`), so this
// infers "ranged" from the presence of an `ammunition` key — the only
// discriminator this app's seed data actually uses (see the shortbow row in
// db/seeds/catalog.ts). `properties.finesse === true` is a clean, reliably
// present boolean flag (dagger/shortsword both set it), so finesse weapons
// correctly use the better of STR/DEX per SRD rules.
function weaponAttackAbilityModifier(catalogEntry: ItemCatalogEntry, str: number, dex: number): number {
  const properties = catalogEntry.properties ?? {};
  const isRanged = 'ammunition' in properties;
  if (isRanged) return abilityModifier(dex);
  const isFinesse = properties.finesse === true;
  if (isFinesse) return Math.max(abilityModifier(str), abilityModifier(dex));
  return abilityModifier(str);
}

// Display-only mirror of services/armorClass.ts's computeArmorClass (PLAN.md
// §3.5/§6.6) — NOT the authoritative AC value, which is always
// `character.armor_class` (passed in as the `armorClass` prop and rendered
// as-is). This only builds the explanatory breakdown string shown alongside
// it in auto mode, e.g. "16 (Chain Mail) + 0 (Dex, heavy) + 2 (Shield) = 18"
// or "10 + 2 (Dex) = 12 (unarmored)". `armorClass` (the authoritative total)
// is threaded in for the "= N" tail rather than recomputed here, so this
// string can never itself drift from the server's number even if this
// helper's logic ever falls out of sync with services/armorClass.ts.
function armorClassBreakdown(dex: number, armor: ItemCatalogEntry | null, hasShield: boolean, armorClass: number): string {
  const dexMod = abilityModifier(dex);
  const shieldTerm = hasShield ? ' + 2 (Shield)' : '';

  if (!armor) {
    return `10 + ${dexMod} (Dex)${shieldTerm} = ${armorClass} (unarmored)`;
  }

  const base = armor.armor_class_base ?? 0;
  let dexContribution: number;
  switch (armor.dex_modifier_rule) {
    case 'full':
      dexContribution = dexMod;
      break;
    case 'max_2':
      dexContribution = Math.min(dexMod, 2);
      break;
    case 'none':
    default:
      dexContribution = 0;
      break;
  }
  const categoryLabel = armor.armor_category ? `, ${armor.armor_category}` : '';
  return `${base} (${armor.name}) + ${dexContribution} (Dex${categoryLabel})${shieldTerm} = ${armorClass}`;
}

/** Inventory panel (PLAN.md §6.2's InventoryPanel + ItemCard grid). */
export function InventoryPanel({
  characterId,
  edition,
  editable,
  str,
  dex,
  level,
  armorClass,
  armorClassMode,
}: {
  characterId: number;
  edition: '2014' | '2024' | 'both';
  editable: boolean;
  str: number;
  dex: number;
  level: number;
  armorClass: number;
  armorClassMode: 'auto' | 'manual';
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const itemsQuery = useQuery({
    queryKey: ['character', characterId, 'items'],
    queryFn: () => api.get<{ items: CharacterItem[] }>(`/characters/${characterId}/items`),
  });
  const itemsCatalogQuery = useItemsCatalog(edition);

  const addMutation = useMutation({
    mutationFn: (input: {
      itemId: number;
      quantity: number;
      isEquipped: boolean;
      isAttuned: boolean;
      customName: string | null;
    }) => api.post<{ item: CharacterItem; character: Character }>(`/characters/${characterId}/items`, input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['character', characterId, 'items'] });
      // A new item can be added pre-equipped (isEquipped: true), which can
      // silently trigger the same server-side AC recompute as the equip
      // toggle below — mirror that mutation's cache write so this panel's
      // AC display doesn't go stale on the add-item path either.
      queryClient.setQueryData(['character', characterId], { character: data.character });
      setAdding(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ itemRowId, patch }: { itemRowId: number; patch: UpdateCharacterItemBody }) =>
      api.patch<{ item: CharacterItem; character: Character }>(`/characters/${characterId}/items/${itemRowId}`, patch),
    onSuccess: (data) => {
      queryClient.setQueryData<{ items: CharacterItem[] }>(['character', characterId, 'items'], (prev) =>
        prev ? { items: prev.items.map((i) => (i.id === data.item.id ? data.item : i)) } : prev,
      );
      // An equip/unequip toggle can silently trigger an AC recompute
      // server-side (armor_class_mode='auto') — the route now always returns
      // the current character alongside the item so this panel's displayed
      // AC stays in sync, exactly like armorClassModeMutation's cache write
      // below. Harmless to overwrite when AC didn't actually change.
      queryClient.setQueryData(['character', characterId], { character: data.character });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (itemRowId: number) => api.delete<void>(`/characters/${characterId}/items/${itemRowId}`),
    onSuccess: (_data, itemRowId) => {
      queryClient.setQueryData<{ items: CharacterItem[] }>(['character', characterId, 'items'], (prev) =>
        prev ? { items: prev.items.filter((i) => i.id !== itemRowId) } : prev,
      );
    },
  });

  // Mirrors CharacterSheetPage's own updateCharacterMutation onSuccess: the
  // PATCH response is the full `{character}` shape, written straight into
  // the ['character', characterId] cache so the ability-scores section's
  // manual-AC-input gating (armor_class_mode) and displayed armor_class
  // update immediately without a manual refetch.
  const armorClassModeMutation = useMutation({
    mutationFn: (mode: 'auto' | 'manual') =>
      api.patch<{ character: Character }>(`/characters/${characterId}/armor-class-mode`, { mode }),
    onSuccess: (data) => {
      queryClient.setQueryData(['character', characterId], data);
    },
  });

  const catalogById = new Map((itemsCatalogQuery.data?.items ?? []).map((i) => [i.id, i]));
  const items = itemsQuery.data?.items ?? [];
  const proficiencyBonus = proficiencyBonusForLevel(level);

  // Same "lowest id wins" tie-break as services/armorClass.ts's
  // recomputeAndApplyCharacterArmorClass, for when more than one armor row
  // is equipped simultaneously (a pre-existing data-modeling gap this app
  // doesn't prevent anywhere else either).
  const equippedArmorItem = [...items]
    .sort((a, b) => a.id - b.id)
    .find((i) => i.is_equipped && catalogById.get(i.item_id)?.item_type === 'armor');
  const equippedArmorCatalog = equippedArmorItem ? catalogById.get(equippedArmorItem.item_id) ?? null : null;
  const hasEquippedShield = items.some((i) => i.is_equipped && catalogById.get(i.item_id)?.item_type === 'shield');
  const acBreakdown = armorClassBreakdown(dex, equippedArmorCatalog, hasEquippedShield, armorClass);

  return (
    <section className="rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Inventory</h3>
        {editable && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-xs text-amber-500 hover:text-amber-400">
            + Add item
          </button>
        )}
      </div>

      <div className="rounded-md border border-stone-800 bg-stone-950 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Armor Class</h4>
          {editable && (
            <div
              role="radiogroup"
              aria-label="Armor class mode"
              className="inline-flex rounded-md border border-stone-700 overflow-hidden text-[10px] leading-none flex-shrink-0"
            >
              {(['manual', 'auto'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={armorClassMode === m}
                  disabled={armorClassModeMutation.isPending}
                  onClick={() => armorClassModeMutation.mutate(m)}
                  className={`px-2 py-1 capitalize transition-colors ${
                    armorClassMode === m
                      ? 'bg-amber-950 text-amber-400 font-semibold'
                      : 'bg-stone-900 text-stone-400 hover:bg-stone-800'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-stone-100">{armorClass}</span>
          {!editable && <span className="text-xs text-stone-500 capitalize">({armorClassMode})</span>}
        </div>
        {armorClassMode === 'auto' && <p className="text-xs text-stone-500">{acBreakdown}</p>}
        {armorClassModeMutation.isError && <ErrorBanner message={errorMessage(armorClassModeMutation.error)} />}
      </div>

      {items.length === 0 ? (
        <EmptyState message="No items yet." />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              catalogEntry={catalogById.get(item.item_id)}
              editable={editable}
              characterId={characterId}
              str={str}
              dex={dex}
              proficiencyBonus={proficiencyBonus}
              onUpdate={(patch) => updateMutation.mutate({ itemRowId: item.id, patch })}
              onRemove={() => removeMutation.mutate(item.id)}
            />
          ))}
        </div>
      )}

      {adding && (
        <AddItemForm
          catalog={itemsCatalogQuery.data?.items ?? []}
          pending={addMutation.isPending}
          onAdd={(input) => addMutation.mutate(input)}
          onCancel={() => setAdding(false)}
        />
      )}

      {(addMutation.isError || updateMutation.isError || removeMutation.isError) && (
        <ErrorBanner message={errorMessage((addMutation.error ?? updateMutation.error ?? removeMutation.error) as unknown)} />
      )}
    </section>
  );
}

function ItemCard({
  item,
  catalogEntry,
  editable,
  characterId,
  str,
  dex,
  proficiencyBonus,
  onUpdate,
  onRemove,
}: {
  item: CharacterItem;
  catalogEntry: ItemCatalogEntry | undefined;
  editable: boolean;
  characterId: number;
  str: number;
  dex: number;
  proficiencyBonus: number;
  onUpdate: (patch: UpdateCharacterItemBody) => void;
  onRemove: () => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(item.notes ?? '');
  const name = item.custom_name || catalogEntry?.name || `Item #${item.item_id}`;
  // Attack-roll trigger only makes sense for an equipped weapon a player is
  // allowed to roll for (see the `editable` reuse comment in
  // SkillsPanel.tsx) — a stowed weapon or non-weapon item gets no trigger.
  const canRollAttack = editable && item.is_equipped && catalogEntry?.item_type === 'weapon';
  // Damage roll is a separate trigger from the to-hit roll above (5e rolls
  // these independently) — only offered when the catalog row actually has
  // parseable damage dice (damage_dice is free-text going back to Phase 2,
  // so a malformed value just silently hides the button rather than crashing).
  const damageTypesQuery = useDamageTypesCatalog();
  const parsedDamage = catalogEntry?.damage_dice ? parseDiceExpression(catalogEntry.damage_dice) : null;
  const damageTypeName = damageTypesQuery.data?.damageTypes.find((dt) => dt.id === catalogEntry?.damage_type_id)?.name;

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-stone-100 truncate">{name}</div>
          <div className="text-xs text-stone-500 flex items-center gap-1.5 flex-wrap mt-0.5">
            {catalogEntry && <span className={`capitalize ${RARITY_COLOR[catalogEntry.rarity]}`}>{catalogEntry.rarity.replace('_', ' ')}</span>}
            {catalogEntry && <span className="capitalize">{catalogEntry.item_type.replace('_', ' ')}</span>}
            {catalogEntry?.requires_attunement && <span className="text-violet-400">Attunement</span>}
          </div>
        </div>
        {editable && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
            className="text-red-400 hover:text-red-300 text-sm px-1 flex-shrink-0"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!editable || item.quantity <= 0}
            onClick={() => onUpdate({ quantity: Math.max(0, item.quantity - 1) })}
            className="h-6 w-6 rounded bg-stone-800 border border-stone-700 text-stone-300 disabled:opacity-40"
            aria-label={`Decrease ${name} quantity`}
          >
            −
          </button>
          <span className="w-6 text-center text-stone-200">{item.quantity}</span>
          <button
            type="button"
            disabled={!editable}
            onClick={() => onUpdate({ quantity: item.quantity + 1 })}
            className="h-6 w-6 rounded bg-stone-800 border border-stone-700 text-stone-300 disabled:opacity-40"
            aria-label={`Increase ${name} quantity`}
          >
            +
          </button>
        </div>
        <label className="flex items-center gap-1 text-xs text-stone-400">
          <input
            type="checkbox"
            disabled={!editable}
            checked={item.is_equipped}
            onChange={(e) => onUpdate({ isEquipped: e.target.checked })}
          />
          Equipped
        </label>
        {catalogEntry?.requires_attunement && (
          <label className="flex items-center gap-1 text-xs text-stone-400">
            <input
              type="checkbox"
              disabled={!editable}
              checked={item.is_attuned}
              onChange={(e) => onUpdate({ isAttuned: e.target.checked })}
            />
            Attuned
          </label>
        )}
      </div>

      {canRollAttack && catalogEntry && (
        <div className="flex flex-wrap items-center gap-3">
          <DiceRoller
            rollType="attack"
            rollContext={name}
            modifier={weaponAttackAbilityModifier(catalogEntry, str, dex) + proficiencyBonus}
            characterId={characterId}
            triggerLabel="⚄ Attack"
          />
          {parsedDamage && (
            <DiceRoller
              rollType="damage"
              rollContext={`${name}${damageTypeName ? ` (${damageTypeName})` : ''}`}
              modifier={weaponAttackAbilityModifier(catalogEntry, str, dex) + parsedDamage.modifier}
              diceSides={parsedDamage.sides}
              diceCount={parsedDamage.count}
              characterId={characterId}
              triggerLabel="🩸 Damage"
            />
          )}
        </div>
      )}

      {editable ? (
        editingNotes ? (
          <div className="space-y-1">
            <textarea
              rows={2}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onUpdate({ notes: notesDraft || null });
                  setEditingNotes(false);
                }}
                className="text-xs text-amber-500 hover:text-amber-400"
              >
                Save note
              </button>
              <button
                type="button"
                onClick={() => {
                  setNotesDraft(item.notes ?? '');
                  setEditingNotes(false);
                }}
                className="text-xs text-stone-400 hover:text-stone-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditingNotes(true)} className="text-xs text-stone-500 hover:text-stone-300 text-left">
            {item.notes || 'Add note…'}
          </button>
        )
      ) : (
        item.notes && <p className="text-xs text-stone-500">{item.notes}</p>
      )}
    </div>
  );
}

function AddItemForm({
  catalog,
  pending,
  onAdd,
  onCancel,
}: {
  catalog: ItemCatalogEntry[];
  pending: boolean;
  onAdd: (input: { itemId: number; quantity: number; isEquipped: boolean; isAttuned: boolean; customName: string | null }) => void;
  onCancel: () => void;
}) {
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [isEquipped, setIsEquipped] = useState(false);
  const [isAttuned, setIsAttuned] = useState(false);
  const [customName, setCustomName] = useState('');

  const sorted = [...catalog].sort((a, b) => a.name.localeCompare(b.name));

  function submit() {
    const id = Number(itemId);
    if (!id) return;
    onAdd({
      itemId: id,
      quantity: Math.max(0, Number(quantity) || 1),
      isEquipped,
      isAttuned,
      customName: customName.trim() || null,
    });
  }

  return (
    <div className="rounded-md border border-stone-700 bg-stone-950 p-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[10rem]">
          <label className="block text-[10px] text-stone-500 mb-0.5">Item</label>
          <Combobox
            value={itemId}
            onChange={setItemId}
            placeholder="Search items…"
            options={sorted.map((i) => ({ value: String(i.id), label: `${i.name} (${i.rarity})` }))}
          />
        </div>
        <div>
          <label className="block text-[10px] text-stone-500 mb-0.5">Qty</label>
          <input
            type="number"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-16 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100 text-center"
          />
        </div>
        <div className="flex-1 min-w-[8rem]">
          <label className="block text-[10px] text-stone-500 mb-0.5">Custom name (optional)</label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          />
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-xs text-stone-400">
          <input type="checkbox" checked={isEquipped} onChange={(e) => setIsEquipped(e.target.checked)} />
          Equipped
        </label>
        <label className="flex items-center gap-1.5 text-xs text-stone-400">
          <input type="checkbox" checked={isAttuned} onChange={(e) => setIsAttuned(e.target.checked)} />
          Attuned
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!itemId || pending}
          onClick={submit}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-sm"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
