// Reusable read-only D&D 5e stat-block renderer (PLAN.md §6.6). Takes a
// MonsterCatalogEntry-shaped object so it works for both global/seeded rows
// and homebrew rows without transformation. Deliberately has no data-fetching
// or edit affordances of its own — callers (bestiary row expansion, the
// creature editor's live preview, and later phases per the task brief:
// battle map, dice roller) own that.

import type { ReactNode } from 'react';
import { abilityModifier, formatModifier } from '../lib/dnd-math';
import { formatDistance } from '../lib/units';
import type { MonsterCatalogEntry, StatBlockEntry } from '../lib/types';
import { formatTimestamp } from '../lib/dates';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../auth/AuthContext';

const ABILITIES: Array<{ key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; label: string }> = [
  { key: 'str', label: 'STR' },
  { key: 'dex', label: 'DEX' },
  { key: 'con', label: 'CON' },
  { key: 'int', label: 'INT' },
  { key: 'wis', label: 'WIS' },
  { key: 'cha', label: 'CHA' },
];

/** CR → proficiency bonus table (dnd-srd-rules-validator's reference table). */
export function crToProficiencyBonus(cr: number): number {
  if (cr <= 4) return 2;
  if (cr <= 8) return 3;
  if (cr <= 12) return 4;
  if (cr <= 16) return 5;
  if (cr <= 20) return 6;
  if (cr <= 24) return 7;
  if (cr <= 28) return 8;
  return 9;
}

function formatCr(cr: number): string {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}

function asEntries(value: unknown): StatBlockEntry[] {
  if (!Array.isArray(value)) return [];
  return value as StatBlockEntry[];
}

function EntryList({ title, entries }: { title: string; entries: StatBlockEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div>
      {title && <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-500 mb-1.5">{title}</h4>}
      <ul className="space-y-1.5">
        {entries.map((entry, i) => (
          <li key={i} className="text-sm text-stone-300">
            <span className="font-semibold text-stone-100">{entry.name}.</span>{' '}
            {entry.description ?? entry.desc ?? ''}
            {/* A distinct mono chip for the roll-able damage expression —
                already-modeled structured data (StatBlockEntry.damageDice),
                just not previously rendered anywhere in this component. */}
            {entry.damageDice && (
              <span className="ml-1.5 inline-block rounded border border-stone-700 bg-stone-800 px-1.5 py-0.5 font-mono text-xs text-amber-400 align-middle">
                {entry.damageDice}
                {entry.damageType ? ` ${entry.damageType}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Collapsible section (docs/design-tokens.md's mobile pass — "creature
 * sheets are long on mobile; stat block and actions open by default, lore/
 * description collapsed"). This catalog entry has no separate lore field
 * (see MonsterCatalogEntry in lib/types.ts) — the nearest equivalent split
 * is core numbers + Actions (what a DM needs moment-to-moment in combat)
 * open by default, with Traits/Legendary Actions/Reactions and the extended
 * saves/skills/resistances/senses/languages block collapsed, since those
 * are the "read once, then rarely" reference detail. Native <details> — no
 * new JS, works with zero script, keyboard/AT accessible for free.
 */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-amber-500">
        {title}
        <span className="text-stone-500 transition-transform group-open:rotate-180" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}

function kvList(record: Record<string, number> | null | undefined): string {
  if (!record || Object.keys(record).length === 0) return '';
  return Object.entries(record)
    .map(([k, v]) => `${k} ${formatModifier(v)}`)
    .join(', ');
}

export function StatBlock({ monster }: { monster: MonsterCatalogEntry }) {
  const { t } = useLocale();
  const { user } = useAuth();
  const unitSystem = user?.unitSystem ?? 'imperial';
  const proficiencyBonus = crToProficiencyBonus(monster.challenge_rating);
  // monster.speed is a free-form JSONB blob — most seeded SRD rows store
  // each value as an already-formatted string (e.g. "30 ft."), while a few
  // ad-hoc/test rows store a plain number. Number(v) on the former produced
  // NaN (a real, live bug, not something this pass introduced the shape
  // of) — only convert through formatDistance when it's actually numeric;
  // an already-formatted string renders as-is rather than double-converting.
  const speedText = Object.entries(monster.speed ?? {})
    .map(([k, v]) => {
      const value = typeof v === 'number' ? formatDistance(v, unitSystem, t) : String(v);
      return k === 'walk' ? value : `${k} ${value}`;
    })
    .join(', ');

  const savingThrowsText = kvList(monster.saving_throws);
  const skillsText = kvList(monster.skills);

  const vulnerabilities = monster.damage_vulnerabilities ?? [];
  const resistances = monster.damage_resistances ?? [];
  const immunities = monster.damage_immunities ?? [];

  const traits = asEntries(monster.traits);
  const actions = asEntries(monster.actions);
  const legendaryActions = asEntries(monster.legendary_actions);
  const reactions = asEntries(monster.reactions);

  return (
    <div className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 space-y-3">
      {/* Ledger-entry header — margin-note type line (size/type/alignment)
          under the creature's name, fade-edge rule instead of a hard line. */}
      <header>
        <h3 className="font-display text-lg font-medium text-amber-500">{monster.name}</h3>
        <p className="text-xs italic text-stone-400">
          {monster.size} {monster.creature_type}
          {monster.alignment ? `, ${monster.alignment}` : ''}
        </p>
      </header>
      <div className="hr" />

      <div className="text-sm space-y-1">
        <p>
          <span className="font-semibold text-stone-100">{t('statBlock.armorClass')}</span>{' '}
          <span className="font-mono text-stone-300 tabular-nums">
            {monster.armor_class}
            {monster.armor_class_notes ? ` (${monster.armor_class_notes})` : ''}
          </span>
        </p>
        <p>
          <span className="font-semibold text-stone-100">{t('statBlock.hitPoints')}</span>{' '}
          <span className="font-mono text-stone-300 tabular-nums">
            {monster.hit_point_average} ({monster.hit_dice})
          </span>
        </p>
        <p>
          <span className="font-semibold text-stone-100">{t('statBlock.speed')}</span>{' '}
          <span className="font-mono text-stone-300 tabular-nums">{speedText || '—'}</span>
        </p>
      </div>

      {/* Ability scores as one compact mono line rather than six boxes —
          "STR 16 (+3)" reads like a ledger entry, and the mono digits keep
          every modifier aligned and unambiguous at a glance. */}
      <div className="font-mono text-sm text-stone-300 tabular-nums flex flex-wrap gap-x-3 gap-y-1 py-1">
        {ABILITIES.map(({ key, label }) => {
          const score = monster[key];
          const mod = abilityModifier(score);
          return (
            <span key={key}>
              <span className="text-stone-500">{label}</span> {score} <span className="text-amber-500">({formatModifier(mod)})</span>
            </span>
          );
        })}
      </div>

      <CollapsibleSection title={t('statBlock.savesSkillsSenses')}>
        <div className="text-sm space-y-1">
          {savingThrowsText && (
            <p>
              <span className="font-semibold text-stone-100">{t('statBlock.savingThrows')}</span>{' '}
              <span className="font-mono text-stone-300 tabular-nums">{savingThrowsText}</span>
            </p>
          )}
          {skillsText && (
            <p>
              <span className="font-semibold text-stone-100">{t('statBlock.skills')}</span>{' '}
              <span className="font-mono text-stone-300 tabular-nums">{skillsText}</span>
            </p>
          )}
          {vulnerabilities.length > 0 && (
            <p>
              <span className="font-semibold text-stone-100">{t('statBlock.damageVulnerabilities')}</span>{' '}
              <span className="text-stone-300">{vulnerabilities.join(', ')}</span>
            </p>
          )}
          {resistances.length > 0 && (
            <p>
              <span className="font-semibold text-stone-100">{t('statBlock.damageResistances')}</span>{' '}
              <span className="text-stone-300">{resistances.join(', ')}</span>
            </p>
          )}
          {immunities.length > 0 && (
            <p>
              <span className="font-semibold text-stone-100">{t('statBlock.damageImmunities')}</span>{' '}
              <span className="text-stone-300">{immunities.join(', ')}</span>
            </p>
          )}
          {monster.senses && (
            <p>
              <span className="font-semibold text-stone-100">{t('statBlock.senses')}</span>{' '}
              <span className="text-stone-300">{monster.senses}</span>
            </p>
          )}
          {monster.languages && (
            <p>
              <span className="font-semibold text-stone-100">{t('statBlock.languages')}</span>{' '}
              <span className="text-stone-300">{monster.languages}</span>
            </p>
          )}
          <p>
            <span className="font-semibold text-stone-100">{t('statBlock.challenge')}</span>{' '}
            <span className="font-mono text-stone-300 tabular-nums">
              {formatCr(monster.challenge_rating)} ({monster.xp_value.toLocaleString()} XP)
            </span>{' '}
            <span className="font-semibold text-stone-100">{t('statBlock.proficiencyBonus')}</span>{' '}
            <span className="font-mono text-stone-300 tabular-nums">{formatModifier(proficiencyBonus)}</span>
          </p>
        </div>
      </CollapsibleSection>

      {traits.length > 0 && (
        <CollapsibleSection title={t('statBlock.traits')}>
          <EntryList title="" entries={traits} />
        </CollapsibleSection>
      )}
      <EntryList title={t('statBlock.actions')} entries={actions} />
      {legendaryActions.length > 0 && (
        <CollapsibleSection title={t('statBlock.legendaryActions')}>
          <EntryList title="" entries={legendaryActions} />
        </CollapsibleSection>
      )}
      {reactions.length > 0 && (
        <CollapsibleSection title={t('statBlock.reactions')}>
          <EntryList title="" entries={reactions} />
        </CollapsibleSection>
      )}
      {/* Only meaningful for homebrew rows — every seeded/official monster's
          created_at is just whenever that migration happened to run. */}
      {monster.is_homebrew && (
        <p className="text-xs text-stone-500 pt-1">
          {t('statBlock.createdUpdated', {
            created: formatTimestamp(monster.created_at),
            updated: formatTimestamp(monster.updated_at),
          })}
        </p>
      )}
    </div>
  );
}
