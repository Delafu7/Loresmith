// Generic over ELEMENT_REGISTRY — one icon button per entry, in the
// registry's own declared order (ELEMENT_TYPES). Adding a type never
// touches this file; see registry.tsx's header comment for the contract.
import type { MapElementType } from '../../lib/types';
import { useLocale, type TranslationKey } from '../../i18n/LocaleContext';
import { ELEMENT_REGISTRY, ELEMENT_TYPES } from './registry';

export function ElementPalette({
  placingType,
  onSelectType,
}: {
  placingType: MapElementType | null;
  onSelectType: (type: MapElementType | null) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 rounded-md bg-stone-900 p-2 shadow-sm">
      <span className="px-1 text-[10px] uppercase text-stone-500">{t('encounters.mapElements.palette')}</span>
      {ELEMENT_TYPES.map((type) => {
        const entry = ELEMENT_REGISTRY[type];
        const Icon = entry.icon;
        const active = placingType === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onSelectType(active ? null : type)}
            title={t(entry.labelKey as TranslationKey)}
            aria-label={t(entry.labelKey as TranslationKey)}
            aria-pressed={active}
            className={`flex size-9 items-center justify-center rounded-md ${
              active ? 'bg-amber-950/30 text-amber-400 outline outline-1 outline-amber-600' : 'text-stone-400 hover:bg-stone-800 hover:text-stone-200'
            }`}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </div>
  );
}
