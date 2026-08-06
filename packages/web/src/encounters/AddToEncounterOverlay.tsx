// Iteration 2 "Fast add/spawn UX" — a single compact overlay replacing the
// old two-flow add-to-encounter experience (MonstersPage.tsx's full-page
// import table for NEW instances, and CombatTracker.tsx's buried
// AddParticipantForm for EXISTING characters/instances — see
// docs/rules/monster-spawning.md and this session's exploration findings).
// Desktop: centered dialog. Mobile: bottom sheet capped at 50vh (acceptance
// criteria). Same native <dialog> pattern as Modal.tsx/NavDrawer.tsx, sized
// responsively via Tailwind breakpoints instead of two separate components.
//
// Scope cut, disclosed rather than silently dropped: only creatures
// (spawn new instances), characters, and existing unseated monster
// instances are searchable here — items and maps are NOT wired into this
// overlay in this iteration (no "add an item to the session" or "switch
// map" action exists in this component). Extending to those entity types is
// a natural follow-up once this pattern is validated at the table.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useToast } from '../components/ui/Toast';
import type { Character, MonsterCatalogEntry, MonsterInstance } from '../lib/types';
import type { MutationLike } from './BattleModeDmPanel';
import type { SpawnParticipantsBody } from './useEncounterSessionData';

export interface AsyncMutationLike<TVariables, TResult> {
  mutate: (variables: TVariables) => void;
  mutateAsync: (variables: TVariables) => Promise<TResult>;
  isPending: boolean;
}

type HpStrategy = SpawnParticipantsBody['hpStrategy'];
type NamingScheme = SpawnParticipantsBody['namingScheme'];

interface ResultRow {
  key: string;
  kind: 'spawn' | 'character' | 'instance';
  id: string;
  label: string;
  sublabel?: string;
}

const RECENTS_KEY_PREFIX = 'addToEncounterRecents:';
const HP_STRATEGY_KEY = 'addToEncounterHpStrategy';
const NAMING_SCHEME_KEY = 'addToEncounterNamingScheme';
const GROUP_INITIATIVE_KEY = 'addToEncounterGroupInitiative';
const RECENTS_MAX = 8;

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private browsing, quota) — recents/preferences
    // just don't persist; not worth surfacing an error for a convenience.
  }
}

// A leading integer ("6 goblin", "12  skeleton") sets the spawn quantity and
// is stripped from the text used to filter results — everything else is
// treated as a plain substring search.
function parseQuery(raw: string): { quantity: number | null; text: string } {
  const match = /^\s*(\d{1,2})\s+(.*)$/.exec(raw);
  if (!match) return { quantity: null, text: raw.trim() };
  return { quantity: Math.max(1, Math.min(20, Number(match[1]))), text: match[2]!.trim() };
}

export function AddToEncounterOverlay({
  open,
  onClose,
  campaignId,
  monsters,
  availableCharacters,
  availableMonsterInstances,
  addParticipantMutation,
  spawnMutation,
  removeParticipantMutation,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  monsters: MonsterCatalogEntry[] | undefined;
  availableCharacters: Character[];
  availableMonsterInstances: MonsterInstance[];
  addParticipantMutation: AsyncMutationLike<{ characterId?: string; monsterInstanceId?: string }, { participant: { id: string } }>;
  spawnMutation: AsyncMutationLike<SpawnParticipantsBody, { participants: Array<{ id: string }> }>;
  removeParticipantMutation: MutationLike<string>;
}) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recentsKey = `${RECENTS_KEY_PREFIX}${campaignId}`;

  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [quantityOverride, setQuantityOverride] = useState<number | null>(null);
  const [hpStrategy, setHpStrategy] = useState<HpStrategy>(() => (readLocalStorage(HP_STRATEGY_KEY) as HpStrategy) || 'average');
  const [namingScheme, setNamingScheme] = useState<NamingScheme>(
    () => (readLocalStorage(NAMING_SCHEME_KEY) as NamingScheme) || 'numeric',
  );
  const [groupInitiative, setGroupInitiative] = useState(() => readLocalStorage(GROUP_INITIATIVE_KEY) !== '0');
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const raw = readLocalStorage(recentsKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    if (open) {
      setQuery('');
      setQuantityOverride(null);
      setHighlightIndex(0);
      // Native <dialog> autofocus doesn't reliably hit a nested input across
      // browsers on first paint — a microtask-deferred focus does.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  function pushRecent(key: string) {
    setRecentIds((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, RECENTS_MAX);
      writeLocalStorage(recentsKey, JSON.stringify(next));
      return next;
    });
  }

  const allRows = useMemo<ResultRow[]>(() => {
    const spawnRows: ResultRow[] = (monsters ?? []).map((m) => ({
      key: `spawn:${m.id}`,
      kind: 'spawn',
      id: m.id,
      label: m.name,
      sublabel: `CR ${m.challenge_rating} · ${m.creature_type}`,
    }));
    const characterRows: ResultRow[] = availableCharacters.map((c) => ({
      key: `character:${c.id}`,
      kind: 'character',
      id: c.id,
      label: c.name,
      sublabel: c.is_pc ? t('encounters.tracker.character') : undefined,
    }));
    const instanceRows: ResultRow[] = availableMonsterInstances.map((mi) => ({
      key: `instance:${mi.id}`,
      kind: 'instance',
      id: mi.id,
      label: mi.custom_name || mi.monster_name || `#${mi.id}`,
      sublabel: t('encounters.tracker.monsterInstance'),
    }));
    return [...spawnRows, ...characterRows, ...instanceRows];
  }, [monsters, availableCharacters, availableMonsterInstances, t]);

  const { quantity: parsedQuantity, text: filterText } = parseQuery(query);
  const effectiveQuantity = quantityOverride ?? parsedQuantity ?? 1;

  const filteredRows = useMemo(() => {
    if (!filterText) return null; // null = "show recents/favorites instead"
    const q = filterText.toLowerCase();
    return allRows.filter((r) => r.label.toLowerCase().includes(q));
  }, [allRows, filterText]);

  const rowsByKey = useMemo(() => new Map(allRows.map((r) => [r.key, r])), [allRows]);
  const recentRows = recentIds.map((key) => rowsByKey.get(key)).filter((r): r is ResultRow => r != null);

  const visibleRows = filteredRows ?? recentRows;

  async function handleSelect(row: ResultRow) {
    if (busy) return;
    setBusy(true);
    try {
      if (row.kind === 'spawn') {
        const { participants } = await spawnMutation.mutateAsync({
          monsterId: row.id,
          quantity: effectiveQuantity,
          hpStrategy,
          groupInitiative,
          namingScheme,
        });
        const ids = participants.map((p) => p.id);
        pushRecent(row.key);
        showToast(t('encounters.addOverlay.toastSpawned', { count: effectiveQuantity, name: row.label }), {
          label: t('encounters.addOverlay.undo'),
          onClick: () => ids.forEach((id) => removeParticipantMutation.mutate(id)),
        });
      } else {
        const body = row.kind === 'character' ? { characterId: row.id } : { monsterInstanceId: row.id };
        const { participant } = await addParticipantMutation.mutateAsync(body);
        pushRecent(row.key);
        showToast(t('encounters.addOverlay.toastAdded', { name: row.label }), {
          label: t('encounters.addOverlay.undo'),
          onClick: () => removeParticipantMutation.mutate(participant.id),
        });
      }
      setQuery('');
      setQuantityOverride(null);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, visibleRows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = visibleRows[highlightIndex];
      if (row) void handleSelect(row);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  function persistHpStrategy(next: HpStrategy) {
    setHpStrategy(next);
    writeLocalStorage(HP_STRATEGY_KEY, next);
  }
  function persistNamingScheme(next: NamingScheme) {
    setNamingScheme(next);
    writeLocalStorage(NAMING_SCHEME_KEY, next);
  }
  function persistGroupInitiative(next: boolean) {
    setGroupInitiative(next);
    writeLocalStorage(GROUP_INITIATIVE_KEY, next ? '1' : '0');
  }

  const hasSpawnRowVisible = visibleRows.some((r) => r.kind === 'spawn');

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      aria-label={t('encounters.addOverlay.title')}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[50vh] w-full max-w-none translate-y-0 rounded-t-lg rounded-b-none border-t border-stone-800 bg-stone-900 p-0 text-stone-100 shadow-2xl backdrop:bg-stone-950/60 transition-transform duration-150 ease-out starting:translate-y-full motion-reduce:transition-none sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[85dvh] sm:w-[min(560px,calc(100vw-2rem))] sm:translate-y-0 sm:rounded-lg sm:border-none sm:starting:translate-y-0"
    >
      <div className="flex max-h-[50vh] flex-col sm:max-h-[85dvh]">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-stone-800 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={t('encounters.addOverlay.searchPlaceholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightIndex(0);
              setQuantityOverride(null);
            }}
            onKeyDown={handleKeyDown}
            className="min-w-0 flex-1 bg-transparent text-base text-stone-100 placeholder:text-stone-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex size-8 flex-shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-stone-800 hover:text-stone-100"
          >
            ✕
          </button>
        </div>

        {hasSpawnRowVisible && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-stone-800 px-3 py-1.5 text-xs text-stone-400">
            <label className="flex items-center gap-1.5">
              {t('encounters.addOverlay.quantityLabel')}
              <input
                type="number"
                min={1}
                max={20}
                value={effectiveQuantity}
                onChange={(e) => setQuantityOverride(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="w-14 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-sm text-stone-100"
              />
            </label>
            <label className="flex items-center gap-1.5">
              {t('encounters.addOverlay.hpStrategyLabel')}
              <select
                value={hpStrategy}
                onChange={(e) => persistHpStrategy(e.target.value as HpStrategy)}
                className="rounded-md bg-stone-800 border border-stone-700 px-1.5 py-1 text-sm text-stone-100"
              >
                <option value="average">{t('encounters.addOverlay.hpAverage')}</option>
                <option value="rolled">{t('encounters.addOverlay.hpRolled')}</option>
                <option value="same">{t('encounters.addOverlay.hpSame')}</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              {t('encounters.addOverlay.namingLabel')}
              <select
                value={namingScheme}
                onChange={(e) => persistNamingScheme(e.target.value as NamingScheme)}
                className="rounded-md bg-stone-800 border border-stone-700 px-1.5 py-1 text-sm text-stone-100"
              >
                <option value="numeric">{t('encounters.addOverlay.namingNumeric')}</option>
                <option value="alpha">{t('encounters.addOverlay.namingAlpha')}</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={groupInitiative}
                onChange={(e) => persistGroupInitiative(e.target.checked)}
                className="size-3.5 rounded border-stone-700 bg-stone-800"
              />
              {t('encounters.addOverlay.groupInitiativeLabel')}
            </label>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredRows === null && recentRows.length > 0 && (
            <p className="px-3 pt-2 text-xs uppercase text-stone-500">{t('encounters.addOverlay.recent')}</p>
          )}
          {filteredRows === null && recentRows.length === 0 && (
            <p className="px-3 py-3 text-sm text-stone-500 italic">{t('encounters.addOverlay.startTyping')}</p>
          )}
          {visibleRows.length === 0 && filteredRows !== null && (
            <p className="px-3 py-3 text-sm text-stone-500 italic">{t('common.noMatches')}</p>
          )}
          <ul role="listbox" className="py-1">
            {visibleRows.map((row, i) => (
              <li key={row.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlightIndex}
                  disabled={busy}
                  onMouseEnter={() => setHighlightIndex(i)}
                  onClick={() => void handleSelect(row)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:opacity-50 ${
                    i === highlightIndex ? 'bg-amber-950 text-amber-400' : 'text-stone-100 hover:bg-stone-800'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {row.kind === 'spawn' && effectiveQuantity > 1 ? `${effectiveQuantity}× ` : ''}
                    {row.label}
                    {row.sublabel && <span className="ml-2 text-xs text-stone-500">{row.sublabel}</span>}
                  </span>
                  <span className="flex-none text-xs uppercase text-stone-500">
                    {row.kind === 'spawn' ? t('encounters.addOverlay.actionSpawn') : t('encounters.addOverlay.actionSeat')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </dialog>
  );
}
