// Participant sheet (nav point 3) — opened by clicking a token on the map
// (BattleMap.tsx/Token.tsx). Two independent things live here, matching the
// two-part ask: (1) this participant's OWN attributes (name, image, HP, AC,
// conditions, and — for whoever's allowed to see it — full stats and its own
// available actions, reusing ParticipantStatLookup unchanged), and (2) a
// "take action against this target" shortcut that renders the VIEWER's own
// acting participant's attacks with this one pre-selected as target, not
// this participant's attacks.
//
// Permissions: DM sees everything; a player sees full detail only for their
// OWN character's token (matches ParticipantStatLookup's existing "caller
// decides whether to render it" gating, just moved from a hardcoded isDm
// check at each call site to an explicit isDm-or-own check here). Anyone
// else's token — another player's PC or any monster — a player sees only
// what's already visible in the roster today (name/image/HP/AC/conditions),
// never the full stat block. No new server reveal-plumbing is added here:
// monster weaknesses stay DM-only exactly as entity_field_reveals already
// enforces server-side (GET .../reveals 403s a player outright).

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Character, CharacterItem, MonsterCatalogEntry, MonsterInstance, SnapshotParticipant } from '../lib/types';
import type { StatBlockEntry } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useItemsCatalog } from '../lib/useCatalog';
import { Portrait } from '../components/Portrait';
import { ParticipantHpDisplay } from '../components/ParticipantHpDisplay';
import { EffectBadge } from '../components/EffectBadge';
import { EmptyState, ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';
import { ParticipantStatLookup } from './CombatTracker';
import { AttackRoller, attackTargetsFor, CharacterAttackRoller, type NormalizedAttack } from './AttackRoller';

export interface ParticipantSheetPanelProps {
  participant: SnapshotParticipant;
  isDm: boolean;
  encounterId: string;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
  allParticipants: SnapshotParticipant[];
  myCharacterIds: Set<string>;
  activeParticipantId: string | null;
  onClose: () => void;
  onRemoveEffect?: (effectId: string) => void;
}

export function ParticipantSheetPanel({
  participant,
  isDm,
  encounterId,
  characters,
  monsterInstances,
  monsters,
  allParticipants,
  myCharacterIds,
  activeParticipantId,
  onClose,
  onRemoveEffect,
}: ParticipantSheetPanelProps) {
  const { t } = useLocale();
  const isOwn = participant.characterId != null && myCharacterIds.has(participant.characterId);
  const canSeeFullDetail = isDm || isOwn;

  const character = participant.characterId != null ? characters?.find((c) => c.id === participant.characterId) : undefined;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto rounded-md bg-stone-900 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Portrait fileUrl={participant.imageUrl} alt={participant.name} shape="circle" size="md" placeholderLabel={participant.name} />
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-stone-100 truncate">{participant.name}</h3>
            <p className="text-[11px] uppercase text-stone-500">
              {t('encounters.tracker.armorClass')} <span className="font-mono tabular-nums">{participant.armorClass}</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="flex size-9 flex-shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-stone-800 hover:text-stone-100"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-2">
        <ParticipantHpDisplay hp={participant.hp} size="large" />
        {isDm && <UndoDamageButton participant={participant} />}
      </div>

      {/* Phase 2 "legendary actions per-round counters" — always visible
          (no redaction mechanism for this, same as AC/effects); the spend
          control itself is DM-only, since monsters have no player controller. */}
      {participant.legendaryActionsRemaining != null && (
        <LegendaryActionsTracker encounterId={encounterId} participant={participant} isDm={isDm} />
      )}

      {isDm && (
        <div className="flex flex-wrap items-center gap-3">
          <FactionSelect encounterId={encounterId} participant={participant} />
          <InitiativeEditor encounterId={encounterId} participant={participant} />
          {/* Phase 2 "restore hp_visibility + banding" — meaningless for a
              character participant (resolveHpForViewer always shows the
              party's own HP exact regardless), so only offered for a
              monster instance, matching the confirmed "monster HP" scope. */}
          {participant.monsterInstanceId != null && <HpVisibilitySelect encounterId={encounterId} participant={participant} />}
        </div>
      )}

      {participant.effects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {participant.effects.map((effect) => (
            <EffectBadge key={effect.effectId} effect={effect} removable={isDm} onRemove={onRemoveEffect ? () => onRemoveEffect(effect.effectId) : undefined} />
          ))}
        </div>
      )}

      {character && <EquipmentList characterId={character.id} />}

      <TakeActionSection
        target={participant}
        allParticipants={allParticipants}
        isDm={isDm}
        encounterId={encounterId}
        characters={characters}
        monsterInstances={monsterInstances}
        monsters={monsters}
        myCharacterIds={myCharacterIds}
        activeParticipantId={activeParticipantId}
      />

      {canSeeFullDetail ? (
        <ParticipantStatLookup
          participant={participant}
          characters={characters}
          monsterInstances={monsterInstances}
          monsters={monsters}
          encounterId={encounterId}
          allParticipants={allParticipants}
        />
      ) : (
        <p className="text-xs italic text-stone-500">{t('encounters.sheet.detailDmOnly')}</p>
      )}
    </div>
  );
}

const FACTION_OPTIONS: Array<{ value: SnapshotParticipant['faction']; labelKey: 'player' | 'ally' | 'enemy' | 'neutral' }> = [
  { value: 'player', labelKey: 'player' },
  { value: 'ally', labelKey: 'ally' },
  { value: 'enemy', labelKey: 'enemy' },
  { value: 'neutral', labelKey: 'neutral' },
];

// DM-only — moved here from the map-first redesign's now-deleted RosterPanel
// (BattleMap.tsx). Self-contained mutation, no cache write on success, same
// pattern as BattleModeDmPanel's ModeToggle: FACTION_CHANGED/FULL_STATE_SYNC
// arriving over the socket is the single source of truth, including for the
// DM's own change.
function FactionSelect({ encounterId, participant }: { encounterId: string; participant: SnapshotParticipant }) {
  const { t } = useLocale();
  const mutation = useMutation({
    mutationFn: (faction: SnapshotParticipant['faction']) =>
      api.patch(`/encounters/${encounterId}/participants/${participant.participantId}/faction`, { faction }),
  });
  return (
    <label className="flex items-center gap-2 text-xs text-stone-400">
      {t('encounters.sheet.factionLabel')}
      <select
        value={participant.faction}
        disabled={mutation.isPending}
        onChange={(e) => mutation.mutate(e.target.value as SnapshotParticipant['faction'])}
        className="min-h-9 rounded border border-stone-700 bg-stone-800 text-stone-200 text-xs px-2"
      >
        {FACTION_OPTIONS.map((f) => (
          <option key={f.value} value={f.value}>
            {t(`encounters.battleMap.faction.${f.labelKey}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

// DM-only manual initiative override — the endpoint re-sequences turn_order
// for the whole encounter server-side (services/encounters.ts's
// setParticipantInitiative), so this control only needs to submit the one
// changed value; every participant's position updates via the same
// INITIATIVE_ROLLED broadcast roll-initiative already uses (useEncounterLive.ts's
// onInitiativeRolled), not a local cache write, same discipline as FactionSelect.
function InitiativeEditor({ encounterId, participant }: { encounterId: string; participant: SnapshotParticipant }) {
  const { t } = useLocale();
  const [value, setValue] = useState(String(participant.initiativeRoll));
  const mutation = useMutation({
    mutationFn: (initiativeRoll: number) =>
      api.patch(`/encounters/${encounterId}/participants/${participant.participantId}/initiative`, {
        initiativeRoll,
        initiativeTiebreak: participant.initiativeTiebreak,
      }),
  });

  const commit = () => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed === participant.initiativeRoll) {
      setValue(String(participant.initiativeRoll));
      return;
    }
    mutation.mutate(parsed);
  };

  return (
    <label className="flex items-center gap-2 text-xs text-stone-400">
      {t('encounters.sheet.initiativeLabel')}
      <input
        type="number"
        value={value}
        disabled={mutation.isPending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="min-h-9 w-16 rounded border border-stone-700 bg-stone-800 text-stone-200 text-xs px-2 font-mono tabular-nums"
      />
    </label>
  );
}

// Phase 2 "HP/damage undo" — DM-only, mirrors ActionEconomyPanel.tsx's own
// undo button (same "server tracks the last snapshot, this button just
// asks for it back" shape). Targets whichever endpoint matches this
// participant — a character or a monster instance never share one row.
function UndoDamageButton({ participant }: { participant: SnapshotParticipant }) {
  const { t } = useLocale();
  const mutation = useMutation({
    mutationFn: () =>
      participant.characterId != null
        ? api.post(`/characters/${participant.characterId}/hp/undo`)
        : api.post(`/monster-instances/${participant.monsterInstanceId}/hp/undo`),
  });
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        title={t('encounters.sheet.undoDamageTitle')}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="text-[10px] uppercase text-stone-500 hover:text-amber-400 border border-stone-800 hover:border-amber-700 rounded px-1.5 py-0.5 disabled:opacity-40"
      >
        {t('encounters.sheet.undoDamage')}
      </button>
      {mutation.isError && <ErrorBanner message={errorMessage(mutation.error)} />}
    </div>
  );
}

// Phase 2 "legendary actions per-round counters" — one pip per point of
// budget (not per legendaryActions entry, since entries can cost more than
// 1), clicked to spend exactly 1 point at a time; the server resets the
// whole counter every round (advanceTurn), this component never resets
// anything itself.
function LegendaryActionsTracker({
  encounterId,
  participant,
  isDm,
}: {
  encounterId: string;
  participant: SnapshotParticipant;
  isDm: boolean;
}) {
  const { t } = useLocale();
  const spendMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounterId}/participants/${participant.participantId}/legendary-actions/spend`, {}),
  });
  const remaining = participant.legendaryActionsRemaining ?? 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-stone-400">
        {t('encounters.sheet.legendaryActionsLabel', { remaining })}
        {isDm && (
          <button
            type="button"
            disabled={remaining <= 0 || spendMutation.isPending}
            onClick={() => spendMutation.mutate()}
            className="rounded-md border border-stone-700 px-2 py-0.5 text-[10px] text-amber-400 hover:border-amber-700 disabled:opacity-40"
          >
            {t('encounters.sheet.spendLegendaryAction')}
          </button>
        )}
      </div>
      {spendMutation.isError && <ErrorBanner message={errorMessage(spendMutation.error)} />}
    </div>
  );
}

const HP_VISIBILITY_OPTIONS = ['exact', 'banded', 'hidden'] as const;

// DM-only, same PATCH-then-resync shape as setParticipantVisibility's own
// route (routes/encounters.ts) — the server broadcasts a role-split
// FULL_STATE_SYNC resync itself, so this needs no local cache write, same
// discipline as FactionSelect/InitiativeEditor above.
function HpVisibilitySelect({ encounterId, participant }: { encounterId: string; participant: SnapshotParticipant }) {
  const { t } = useLocale();
  const mutation = useMutation({
    mutationFn: (hpVisibility: (typeof HP_VISIBILITY_OPTIONS)[number]) =>
      api.patch(`/encounters/${encounterId}/participants/${participant.participantId}/hp-visibility`, { hpVisibility }),
  });
  return (
    <label className="flex items-center gap-2 text-xs text-stone-400">
      {t('encounters.sheet.hpVisibilityLabel')}
      <select
        value={participant.hp.hpVisibility}
        disabled={mutation.isPending}
        onChange={(e) => mutation.mutate(e.target.value as (typeof HP_VISIBILITY_OPTIONS)[number])}
        className="min-h-9 rounded border border-stone-700 bg-stone-800 text-stone-200 text-xs px-2"
      >
        {HP_VISIBILITY_OPTIONS.map((v) => (
          <option key={v} value={v}>
            {t(`encounters.sheet.hpVisibility.${v}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function EquipmentList({ characterId }: { characterId: string }) {
  const { t } = useLocale();
  const { campaign } = useCampaignShell();
  const itemsQuery = useQuery({
    queryKey: ['character', characterId, 'items'],
    queryFn: () => api.get<{ items: CharacterItem[] }>(`/characters/${characterId}/items`),
  });
  const itemsCatalogQuery = useItemsCatalog(campaign.srd_edition);
  const catalogNameById = new Map((itemsCatalogQuery.data?.items ?? []).map((i) => [i.id, i.name]));
  const equipped = (itemsQuery.data?.items ?? []).filter((i) => i.is_equipped);

  if (itemsQuery.isLoading) return null;
  if (equipped.length === 0) return null;

  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-wide text-stone-500 mb-1">{t('encounters.sheet.equipmentTitle')}</h4>
      <ul className="space-y-0.5">
        {equipped.map((item) => (
          <li key={item.id} className="text-xs text-stone-300 truncate">
            {item.custom_name || catalogNameById.get(item.item_id) || t('encounters.tracker.itemFallback', { id: item.item_id })}
            {item.quantity > 1 && <span className="text-stone-500"> ×{item.quantity}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// "Launch an action against that character" — resolves the VIEWER's own
// acting participant (their own seated character, or for a DM the currently
// active participant) and renders that participant's attacks with `target`
// pre-selected, not the sheet subject's own attacks.
function TakeActionSection({
  target,
  allParticipants,
  isDm,
  encounterId,
  characters,
  monsterInstances,
  monsters,
  myCharacterIds,
  activeParticipantId,
}: {
  target: SnapshotParticipant;
  allParticipants: SnapshotParticipant[];
  isDm: boolean;
  encounterId: string;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
  myCharacterIds: Set<string>;
  activeParticipantId: string | null;
}) {
  const { t } = useLocale();
  // A player controlling more than one seated character (own PC + a
  // delegated one) used to have the second one silently invisible here —
  // .find() always resolved to whichever came first in participant order.
  const myParticipants = allParticipants.filter((p) => p.characterId != null && myCharacterIds.has(p.characterId));
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const actingParticipant = isDm
    ? allParticipants.find((p) => p.participantId === activeParticipantId)
    : (myParticipants.find((p) => p.participantId === selectedActorId) ?? myParticipants[0]);

  if (!actingParticipant || actingParticipant.participantId === target.participantId) return null;

  const targets = attackTargetsFor(allParticipants, actingParticipant.participantId, monsterInstances);
  const actingCharacter = actingParticipant.characterId != null ? characters?.find((c) => c.id === actingParticipant.characterId) : undefined;

  return (
    <div className="rounded-md border border-amber-900/50 bg-amber-950/10 p-2 space-y-1.5">
      <h4 className="text-[11px] uppercase tracking-wide text-amber-500">
        {t('encounters.sheet.takeActionTitle', { actor: actingParticipant.name, target: target.name })}
      </h4>
      {!isDm && myParticipants.length > 1 && (
        <label className="flex items-center gap-2 text-[11px] text-stone-400">
          {t('encounters.sheet.actingAsLabel')}
          <select
            value={actingParticipant.participantId}
            onChange={(e) => setSelectedActorId(e.target.value)}
            className="min-h-8 rounded border border-stone-700 bg-stone-800 text-stone-200 text-xs px-1.5"
          >
            {myParticipants.map((p) => (
              <option key={p.participantId} value={p.participantId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {actingCharacter ? (
        <CharacterAttackRoller
          characterId={actingCharacter.id}
          encounterId={encounterId}
          rollerParticipantId={actingParticipant.participantId}
          targets={targets}
          initialTargetParticipantId={target.participantId}
        />
      ) : actingParticipant.monsterInstanceId != null ? (
        <MonsterAttackRoller
          monsterInstanceId={actingParticipant.monsterInstanceId}
          monsterInstances={monsterInstances}
          monsters={monsters}
          encounterId={encounterId}
          rollerParticipantId={actingParticipant.participantId}
          targets={targets}
          initialTargetParticipantId={target.participantId}
        />
      ) : (
        <EmptyState message={t('common.loading')} />
      )}
    </div>
  );
}

function MonsterAttackRoller({
  monsterInstanceId,
  monsterInstances,
  monsters,
  encounterId,
  rollerParticipantId,
  targets,
  initialTargetParticipantId,
}: {
  monsterInstanceId: string;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
  encounterId: string;
  rollerParticipantId: string;
  targets: ReturnType<typeof attackTargetsFor>;
  initialTargetParticipantId?: string;
}) {
  const mi = monsterInstances?.find((m) => m.id === monsterInstanceId);
  const monster = mi ? monsters?.find((m) => m.id === mi.monster_id) : undefined;
  if (!monster) return null;
  const monsterAttacks: NormalizedAttack[] = Array.isArray(monster.actions)
    ? (monster.actions as StatBlockEntry[]).map((a, i) => ({
        key: `${monster.id}-${i}`,
        name: a.name,
        attackBonus: a.attackBonus ?? null,
        damageDice: a.damageDice ?? null,
        damageType: a.damageType ?? null,
        saveDc: a.saveDc ?? null,
        saveAbilityIndex: a.saveAbilityIndex ?? null,
      }))
    : [];
  return (
    <AttackRoller
      attacks={monsterAttacks}
      rollerMonsterInstanceId={mi!.id}
      encounterId={encounterId}
      rollerParticipantId={rollerParticipantId}
      targets={targets}
      initialTargetParticipantId={initialTargetParticipantId}
    />
  );
}
