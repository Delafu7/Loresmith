// Left-hand step nav (mockup's step-nav layout DNA, live theme tokens — no
// reusable stepper primitive exists in components/ui/Nav.tsx, which is a
// sidebar-links-only component, so this is built from scratch reusing the
// same active/inactive visual language). Steps aren't routes — this is a
// linear <button> list, not react-router NavLinks.
import type { WizardStepId } from './types';

export function WizardStepNav({
  steps,
  currentIndex,
  furthestIndexReached,
  invalidIndices,
  onSelect,
}: {
  steps: { id: WizardStepId; label: string }[];
  currentIndex: number;
  /** Back-nav past an already-visited step never re-blocks it — see CharacterCreationWizard.tsx. */
  furthestIndexReached: number;
  /** Indices whose OWN step validation currently fails — shown as a small marker, doesn't gate clicking back to them. */
  invalidIndices: Set<number>;
  onSelect: (index: number) => void;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Character creation steps">
      {steps.map((step, i) => {
        const reachable = i <= furthestIndexReached;
        const active = i === currentIndex;
        return (
          <button
            key={step.id}
            type="button"
            disabled={!reachable}
            onClick={() => onSelect(i)}
            aria-current={active ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm border-l-2 transition-colors ${
              active
                ? 'border-amber-500 bg-stone-800 text-stone-100'
                : reachable
                  ? 'border-transparent text-stone-400 hover:bg-stone-800/60 hover:text-stone-200'
                  : 'border-transparent text-stone-600 cursor-not-allowed'
            }`}
          >
            <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
              active ? 'bg-amber-500 text-stone-950' : 'bg-stone-700 text-stone-300'
            }`}>
              {i + 1}
            </span>
            <span className="flex-1">{step.label}</span>
            {invalidIndices.has(i) && <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}
