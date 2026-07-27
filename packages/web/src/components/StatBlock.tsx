// Reusable read-only D&D 5e stat-block renderer (PLAN.md §6.6). Takes a
// MonsterCatalogEntry-shaped object so it works for both global/seeded rows
// and homebrew rows without transformation. Deliberately has no data-fetching
// or edit affordances of its own — callers (bestiary row expansion, the
// creature editor's live preview, and later phases per the task brief:
// battle map, dice roller) own that.

import type { ReactNode } from 'react';
import { abilityModifier, formatModifier } from '../lib/dnd-math';
import type { MonsterCatalogEntry, StatBlockEntry } from '../lib/types';

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
  const proficiencyBonus = crToProficiencyBonus(monster.challenge_rating);
  const speedText = Object.entries(monster.speed ?? {})
    .map(([k, v]) => (k === 'walk' ? `${v} ft.` : `${k} ${v} ft.`))
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
    <div className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 space-y-4">
      <header className="border-b border-stone-800 pb-2">
        <h3 className="font-display text-lg font-medium text-amber-500">{monster.name}</h3>
        <p className="text-xs italic text-stone-400">
          {monster.size} {monster.creature_type}
          {monster.alignment ? `, ${monster.alignment}` : ''}
        </p>
      </header>

      <div className="text-sm space-y-1">
        <p>
          <span className="font-semibold text-stone-100">Armor Class</span>{' '}
          <span className="text-stone-300">
            {monster.armor_class}
            {monster.armor_class_notes ? ` (${monster.armor_class_notes})` : ''}
          </span>
        </p>
        <p>
          <span className="font-semibold text-stone-100">Hit Points</span>{' '}
          <span className="text-stone-300">
            {monster.hit_point_average} ({monster.hit_dice})
          </span>
        </p>
        <p>
          <span className="font-semibold text-stone-100">Speed</span>{' '}
          <span className="text-stone-300">{speedText || '—'}</span>
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 border-y border-stone-800 py-3">
        {ABILITIES.map(({ key, label }) => {
          const score = monster[key];
          const mod = abilityModifier(score);
          return (
            <div key={key} className="text-center">
              <div className="text-xs font-semibold tracking-wide text-stone-500">{label}</div>
              <div className="text-lg font-bold text-stone-100">{score}</div>
              <div className="text-xs text-amber-500 font-medium">{formatModifier(mod)}</div>
            </div>
          );
        })}
      </div>

      <CollapsibleSection title="Saves, skills & senses">
        <div className="text-sm space-y-1">
          {savingThrowsText && (
            <p>
              <span className="font-semibold text-stone-100">Saving Throws</span>{' '}
              <span className="text-stone-300">{savingThrowsText}</span>
            </p>
          )}
          {skillsText && (
            <p>
              <span className="font-semibold text-stone-100">Skills</span>{' '}
              <span className="text-stone-300">{skillsText}</span>
            </p>
          )}
          {vulnerabilities.length > 0 && (
            <p>
              <span className="font-semibold text-stone-100">Damage Vulnerabilities</span>{' '}
              <span className="text-stone-300">{vulnerabilities.join(', ')}</span>
            </p>
          )}
          {resistances.length > 0 && (
            <p>
              <span className="font-semibold text-stone-100">Damage Resistances</span>{' '}
              <span className="text-stone-300">{resistances.join(', ')}</span>
            </p>
          )}
          {immunities.length > 0 && (
            <p>
              <span className="font-semibold text-stone-100">Damage Immunities</span>{' '}
              <span className="text-stone-300">{immunities.join(', ')}</span>
            </p>
          )}
          {monster.senses && (
            <p>
              <span className="font-semibold text-stone-100">Senses</span>{' '}
              <span className="text-stone-300">{monster.senses}</span>
            </p>
          )}
          {monster.languages && (
            <p>
              <span className="font-semibold text-stone-100">Languages</span>{' '}
              <span className="text-stone-300">{monster.languages}</span>
            </p>
          )}
          <p>
            <span className="font-semibold text-stone-100">Challenge</span>{' '}
            <span className="text-stone-300">
              {formatCr(monster.challenge_rating)} ({monster.xp_value.toLocaleString()} XP)
            </span>{' '}
            <span className="font-semibold text-stone-100">Proficiency Bonus</span>{' '}
            <span className="text-stone-300">{formatModifier(proficiencyBonus)}</span>
          </p>
        </div>
      </CollapsibleSection>

      {traits.length > 0 && (
        <CollapsibleSection title="Traits">
          <EntryList title="" entries={traits} />
        </CollapsibleSection>
      )}
      <EntryList title="Actions" entries={actions} />
      {legendaryActions.length > 0 && (
        <CollapsibleSection title="Legendary Actions">
          <EntryList title="" entries={legendaryActions} />
        </CollapsibleSection>
      )}
      {reactions.length > 0 && (
        <CollapsibleSection title="Reactions">
          <EntryList title="" entries={reactions} />
        </CollapsibleSection>
      )}
    </div>
  );
}
