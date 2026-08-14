// Generic over ELEMENT_REGISTRY — one labelled button per entry, grouped by
// each entry's own declared `category` (ELEMENT_CATEGORIES' order), in the
// registry's own within-category order (ELEMENT_TYPES). Adding a type never
// touches this file; see registry.tsx's header comment for the contract —
// grouping/mode-label reads `entry.category`/`entry.placement`, never
// `entry.type`, so no per-type branch exists here either.
import type { MapElementType } from '../../lib/types';
import { useLocale, type TranslationKey } from '../../i18n/LocaleContext';
import { ELEMENT_REGISTRY, ELEMENT_TYPES, ELEMENT_CATEGORIES, type ElementPlacement } from './registry';

const PLACEMENT_MODE_KEY: Record<ElementPlacement, TranslationKey> = {
  point: 'encounters.mapElements.placementModes.point',
  segment: 'encounters.mapElements.placementModes.segment',
  polygon: 'encounters.mapElements.placementModes.polygon',
};

export function ElementPalette({
  placingType,
  onSelectType,
}: {
  placingType: MapElementType | null;
  onSelectType: (type: MapElementType | null) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-shrink-0 flex-wrap items-start gap-3 rounded-md bg-stone-900 p-2 shadow-sm">
      {ELEMENT_CATEGORIES.map(({ key: category, labelKey }) => {
        const typesInCategory = ELEMENT_TYPES.filter((type) => ELEMENT_REGISTRY[type].category === category);
        if (typesInCategory.length === 0) return null;
        return (
          <div key={category} className="flex flex-col gap-1">
            <span className="px-1 text-[10px] uppercase text-stone-500">{t(labelKey as TranslationKey)}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {typesInCategory.map((type) => {
                const entry = ELEMENT_REGISTRY[type];
                const Icon = entry.icon;
                const active = placingType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onSelectType(active ? null : type)}
                    title={`${t(entry.labelKey as TranslationKey)} — ${t(PLACEMENT_MODE_KEY[entry.placement])}`}
                    aria-label={t(entry.labelKey as TranslationKey)}
                    aria-pressed={active}
                    className={`flex flex-col items-center gap-0.5 rounded-md px-2 py-1 text-center ${
                      active ? 'bg-amber-950/30 text-amber-400 outline outline-1 outline-amber-600' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
                    }`}
                  >
                    <Icon size={18} />
                    <span className="text-[9px] leading-tight">{t(entry.labelKey as TranslationKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
