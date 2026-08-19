import { useState } from 'react';
import { QuickDiceRoller } from '../components/QuickDiceRoller';
import { DiceRollsIcon } from '../components/layout/navIcons';
import { useLocale } from '../i18n/LocaleContext';

/**
 * Floating dice-roller access point — mounted once in CampaignShell so it's
 * reachable from anywhere inside a campaign, not just the /dice-rolls page.
 * Deliberately thin: all the actual rolling logic (expression parsing,
 * advantage/disadvantage, manual entry, visibility, the server-authoritative
 * POST /campaigns/:id/dice-rolls call) already lives in QuickDiceRoller —
 * this is only the toggle chrome around it, so there is exactly one place
 * that knows how to build a dice-roll request.
 *
 * Outline/ghost styling (border-amber-500 + text-amber-500, no filled
 * background) matches this app's one rule for its accent color — see
 * Button.tsx's `primary` variant, the same rule this reuses at a larger,
 * circular size for a FAB.
 */
export function DiceRollerFab() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-20 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[min(20rem,calc(100vw-2.5rem))] rounded-md border border-stone-700 shadow-lg overflow-hidden">
          <QuickDiceRoller />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('nav.diceRolls')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex size-14 items-center justify-center rounded-full border-2 border-amber-500 bg-stone-950 text-amber-500 shadow-lg hover:bg-amber-500/10 active:bg-amber-500/20"
      >
        <DiceRollsIcon size={24} />
      </button>
    </div>
  );
}
