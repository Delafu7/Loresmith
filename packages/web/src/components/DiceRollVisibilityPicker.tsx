import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignMember, DiceRollVisibility } from '../lib/types';
import { useLocale } from '../i18n/LocaleContext';

const VISIBILITY_LABEL_KEYS = {
  public: 'dice.visibilityPublic',
  gm_only: 'dice.visibilityGmOnly',
  private: 'dice.visibilityPrivate',
} as const;

/**
 * Phase 2 "hidden-roll option in contextual rollers" — the visibility
 * picker (public/gm_only/private + target-player select) used to live only
 * in QuickDiceRoller.tsx. Lifted out so DiceRoller.tsx's contextual
 * roll-trigger (embedded in SkillsPanel/SavingThrowsPanel/AttackRoller) can
 * offer the exact same "roll this as a hidden Perception check" control a
 * DM previously only got from the standalone quick roller. DM-only —
 * rollDice rejects anything but 'public' from a non-DM anyway (Iteration
 * 3 §2.4), so callers should gate rendering on `role === 'dm'` themselves.
 */
export function useDiceRollVisibilityState(campaignId: string, enabled: boolean) {
  const [visibility, setVisibility] = useState<DiceRollVisibility>('public');
  const [visibleToUserId, setVisibleToUserId] = useState('');
  const membersQuery = useQuery({
    queryKey: ['campaign', campaignId, 'members'],
    queryFn: () => api.get<{ members: CampaignMember[] }>(`/campaigns/${campaignId}/members`),
    enabled,
  });

  return { visibility, setVisibility, visibleToUserId, setVisibleToUserId, members: membersQuery.data?.members ?? [] };
}

export function DiceRollVisibilityPicker({
  visibility,
  onVisibilityChange,
  visibleToUserId,
  onVisibleToUserIdChange,
  members,
}: {
  visibility: DiceRollVisibility;
  onVisibilityChange: (v: DiceRollVisibility) => void;
  visibleToUserId: string;
  onVisibleToUserIdChange: (id: string) => void;
  members: CampaignMember[];
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label={t('dice.visibilityLabel')}
        className="inline-flex rounded-md border border-stone-700 overflow-hidden text-[10px] leading-none"
      >
        {(['public', 'gm_only', 'private'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={visibility === v}
            onClick={() => onVisibilityChange(v)}
            className={`px-1.5 py-1.5 transition-colors ${
              visibility === v ? 'bg-amber-950 text-amber-400 font-semibold' : 'bg-stone-900 text-stone-400 hover:bg-stone-800'
            }`}
          >
            {t(VISIBILITY_LABEL_KEYS[v])}
          </button>
        ))}
      </div>
      {visibility === 'private' && (
        <select
          value={visibleToUserId}
          onChange={(e) => onVisibleToUserIdChange(e.target.value)}
          className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
        >
          <option value="">{t('dice.visibilityPickPlayer')}</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
