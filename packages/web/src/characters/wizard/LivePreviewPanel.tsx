// Right-hand running preview (mockup's live-preview layout DNA) — built
// entirely from existing components, no new presentational primitives:
// AbilityScoreGrid.tsx (read-only mode) + HPBar.tsx.
import type { WizardDraft } from './types';
import { AbilityScoreGrid } from '../../components/AbilityScoreGrid';
import { HPBar } from '../../components/HPBar';
import { useLocale } from '../../i18n/LocaleContext';

export function LivePreviewPanel({
  draft,
  raceName,
  backgroundName,
  className: classDisplayName,
}: {
  draft: WizardDraft;
  raceName: string | null;
  backgroundName: string | null;
  className: string | null;
}) {
  const { t } = useLocale();
  return (
    <div className="rounded-md bg-stone-900 shadow-sm p-4 space-y-4">
      <div>
        <p className="text-lg font-semibold text-stone-100 truncate">{draft.name || t('characters.wizard.preview.unnamed')}</p>
        <p className="text-xs text-stone-500">
          {[raceName, classDisplayName ? `${classDisplayName} ${draft.level}` : null, backgroundName].filter(Boolean).join(' · ') ||
            t('characters.wizard.preview.noDetailsYet')}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="rounded-md bg-stone-800 px-3 py-2 text-center">
          <p className="text-[10px] uppercase text-stone-500">{t('characters.common.armorClass')}</p>
          <p className="text-lg font-semibold text-stone-100">{draft.armorClass}</p>
        </div>
        <div className="flex-1">
          <HPBar current={draft.hpMax} max={draft.hpMax} size="compact" />
        </div>
      </div>

      <AbilityScoreGrid scores={draft.scores} editable={false} />
    </div>
  );
}
