// Read-only stat block built from dnd-math.ts's pure functions — no
// computation lives in this component itself. AC shows an explanatory note
// rather than previewing the server's real armor_class_mode:'auto' logic
// (services/armorClass.ts) — nothing is equipped yet at character-creation
// time, so any client-side "preview" of auto-AC would just be restating the
// same 10+DEX unarmored default already shown here, dressed up as more
// authoritative than it is. Armor Class and Max HP are the two exceptions to
// "read-only": createCharacterSchema requires both and nothing else in the
// wizard produces them, so they're editable here with a computed suggestion
// pre-filled.
import { useEffect, useRef } from 'react';
import type { WizardDraft } from './types';
import type { ClassCatalog, RaceCatalog, SubraceCatalog } from '../../lib/types';
import { abilityModifier, formatModifier, proficiencyBonusForLevel, passivePerception } from '../../lib/dnd-math';
import { combinedAbilityBonuses, applyAbilityBonuses } from '../deriveAbilityBonuses';
import { Field, Input } from '../../components/ui/Field';
import { useLocale } from '../../i18n/LocaleContext';

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

export function DerivedStatsStep({
  draft,
  onChange,
  selectedClass,
  selectedRace,
  selectedSubrace,
  readOnly,
}: {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  selectedClass: ClassCatalog | null;
  selectedRace: RaceCatalog | null;
  selectedSubrace: SubraceCatalog | null;
  readOnly: boolean;
}) {
  const { t } = useLocale();
  const proficiencyBonus = proficiencyBonusForLevel(draft.level);
  // Derived (base + racial bonus) scores — everything below (modifiers, AC/HP
  // suggestions, passive perception) is computed from these, not the raw
  // rolled scores, since a race/subrace's ability bonuses are part of the
  // character's actual final ability scores (characters.str/dex/... stores
  // one final value, no separate base column — see
  // CharacterCreationWizard.tsx's submit payload).
  const racialBonuses = combinedAbilityBonuses(selectedRace, selectedSubrace);
  const derivedScores = applyAbilityBonuses(draft.scores, selectedRace, selectedSubrace);
  const dexMod = abilityModifier(derivedScores.dex);
  const conMod = abilityModifier(derivedScores.con);
  const wisMod = abilityModifier(derivedScores.wis);

  const suggestedAc = 10 + dexMod;
  const suggestedHpMax = Math.max(1, (selectedClass?.hit_die ?? 8) + conMod);

  // Pre-fill the suggestion once (when the step first has enough info to
  // compute it) without fighting a value the user already typed over —
  // tracked per suggestion so picking a class later still offers its own
  // suggested HP max exactly once.
  const appliedAcSuggestion = useRef(false);
  const appliedHpSuggestion = useRef<number | null>(null);
  useEffect(() => {
    if (!appliedAcSuggestion.current && draft.armorClass === 10) {
      appliedAcSuggestion.current = true;
      if (suggestedAc !== 10) onChange({ armorClass: suggestedAc });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedAc]);
  useEffect(() => {
    if (appliedHpSuggestion.current !== suggestedHpMax && draft.hpMax === 10) {
      appliedHpSuggestion.current = suggestedHpMax;
      onChange({ hpMax: suggestedHpMax });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedHpMax]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {ABILITY_KEYS.map((key) => {
          const bonus = racialBonuses[key] ?? 0;
          return (
            <div key={key} className="rounded-md bg-stone-800 px-2 py-2 text-center">
              <p className="text-[10px] uppercase text-stone-500">{key}</p>
              <p className="text-sm font-medium text-stone-100">
                {derivedScores[key]} ({formatModifier(abilityModifier(derivedScores[key]))})
              </p>
              {bonus !== 0 && (
                <p className="text-[10px] text-amber-500">{t('characters.wizard.derivedStats.racialBonus', { bonus: formatModifier(bonus) })}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md bg-stone-800 px-3 py-2">
          <p className="text-[10px] uppercase text-stone-500">{t('characters.wizard.derivedStats.proficiencyBonus')}</p>
          <p className="text-lg font-semibold text-stone-100">{formatModifier(proficiencyBonus)}</p>
        </div>
        <div className="rounded-md bg-stone-800 px-3 py-2">
          <p className="text-[10px] uppercase text-stone-500">{t('characters.wizard.derivedStats.passivePerception')}</p>
          <p className="text-lg font-semibold text-stone-100">{passivePerception(wisMod, null)}</p>
        </div>
        <div className="rounded-md bg-stone-800 px-3 py-2">
          <p className="text-[10px] uppercase text-stone-500">{t('characters.wizard.derivedStats.initiative')}</p>
          <p className="text-lg font-semibold text-stone-100">{formatModifier(dexMod)}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('characters.common.armorClass')} htmlFor="wizardAc" hint={t('characters.wizard.derivedStats.acHint')}>
          <Input
            id="wizardAc"
            type="number"
            min={0}
            value={draft.armorClass}
            disabled={readOnly}
            onChange={(e) => onChange({ armorClass: Number(e.target.value) })}
          />
        </Field>
        <Field label={t('characters.list.maxHp')} htmlFor="wizardHpMax">
          <Input
            id="wizardHpMax"
            type="number"
            min={1}
            value={draft.hpMax}
            disabled={readOnly}
            onChange={(e) => onChange({ hpMax: Number(e.target.value) })}
          />
        </Field>
      </div>
    </div>
  );
}
