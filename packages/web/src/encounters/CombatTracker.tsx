import type { ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Character,
  CharacterAttack,
  Encounter,
  MonsterCatalogEntry,
  MonsterInstance,
  SnapshotParticipant,
  StatBlockEntry,
} from '../lib/types';
import { useEncounterSessionData } from './useEncounterSessionData';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { RevealToggle } from '../components/RevealToggle';
import { useReveals } from '../lib/useReveal';
import { StatBlock } from '../components/StatBlock';
import { AbilityScoreGrid } from '../components/AbilityScoreGrid';
import { useLocale } from '../i18n/LocaleContext';
import { SessionScreen } from './SessionScreen';
import { AttackRoller, type AttackTarget, type NormalizedAttack } from './AttackRoller';

const WEAKNESS_FIELDS: Array<{ key: string; labelKey: 'vuln' | 'resist' | 'immune' }> = [
  { key: 'damage_vulnerabilities', labelKey: 'vuln' },
  { key: 'damage_resistances', labelKey: 'resist' },
  { key: 'damage_immunities', labelKey: 'immune' },
];

// One per monster-instance participant row — the one thing the hide/reveal
// removal kept: a DM can reveal a creature's damage vulnerabilities/
// resistances/immunities to players as they're discovered. Never rendered
// for character participants (weaknesses only exist on monster instances).
// Pulled out as its own component, not inlined in the row map, since
// useReveals is a hook and each row needs its own independent query/mutation
// state.
export function ParticipantWeaknessReveal({ monsterInstanceId }: { monsterInstanceId: string }) {
  const { t } = useLocale();
  const { fieldState, setRevealed, isSaving } = useReveals(monsterInstanceId);
  return (
    <div className="flex items-center gap-1">
      {WEAKNESS_FIELDS.map(({ key, labelKey }) => {
        const revealed = fieldState(key)?.revealed ?? false;
        return (
          <RevealToggle
            key={key}
            revealed={revealed}
            disabled={isSaving}
            label={t(`encounters.weakness.${labelKey}`)}
            onToggle={() => void setRevealed(key, !revealed)}
          />
        );
      })}
    </div>
  );
}

// Inline stat lookup (REVISION-PLAN.md §9.3) — DM-only, same as the data it
// reads from: bestiaryQuery/monsterInstancesQuery below are only fetched
// `enabled: isDm`, since a monster's full catalog stat block (traits,
// actions, resistances) is exactly the sensitive info the reveal engine
// exists to gate — this must never render for a player, not just be hidden
// behind a collapsed panel a curious player could still inspect via
// devtools. Characters render via the same read-only AbilityScoreGrid the
// character sheet itself uses, not a new component; monster instances reuse
// StatBlock as-is (already built for the bestiary page).
export function attackTargetsFor(allParticipants: SnapshotParticipant[] | undefined, selfId: string): AttackTarget[] {
  return (allParticipants ?? [])
    .filter((p) => p.participantId !== selfId)
    .map((p) => ({ participantId: p.participantId, name: p.name, characterId: p.characterId, monsterInstanceId: p.monsterInstanceId }));
}

export function ParticipantStatLookup({
  participant,
  characters,
  monsterInstances,
  monsters,
  encounterId,
  allParticipants,
}: {
  participant: SnapshotParticipant;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
  /** REFACTOR-PLAN.md §6 — when supplied (battle mode / the live Session
   * view), renders the participant's selectable attacks with a target picker
   * and server-validated damage application. Omitted entirely in contexts
   * with no live encounter/roster to target (e.g. none today — every caller
   * currently supplies these — but kept optional so a future non-combat
   * caller of this component degrades gracefully instead of crashing). */
  encounterId?: string;
  allParticipants?: SnapshotParticipant[];
}) {
  const { t } = useLocale();
  if (participant.characterId != null) {
    const c = characters?.find((ch) => ch.id === participant.characterId);
    if (!c) return <p className="text-xs text-stone-500 italic mt-2">{t('common.loading')}</p>;
    return (
      <div className="mt-3 rounded-md border border-stone-800 bg-stone-950 p-3 space-y-3">
        <AbilityScoreGrid scores={c} />
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-stone-600">AC</dt>
            <dd className="text-stone-200 font-semibold">{c.armor_class}</dd>
          </div>
          <div>
            <dt className="text-stone-600">{t('encounters.tracker.speed')}</dt>
            <dd className="text-stone-200 font-semibold">{t('encounters.tracker.feetValue', { value: c.speed })}</dd>
          </div>
          <div>
            <dt className="text-stone-600">{t('encounters.tracker.senses')}</dt>
            <dd className="text-stone-200">{c.senses || '—'}</dd>
          </div>
        </dl>
        {c.notes && <p className="text-xs text-stone-400 whitespace-pre-wrap">{c.notes}</p>}
        {encounterId !== undefined && (
          <CharacterAttackRoller
            characterId={c.id}
            encounterId={encounterId}
            rollerParticipantId={participant.participantId}
            targets={attackTargetsFor(allParticipants, participant.participantId)}
          />
        )}
      </div>
    );
  }

  const mi = monsterInstances?.find((m) => m.id === participant.monsterInstanceId);
  const monster = mi ? monsters?.find((m) => m.id === mi.monster_id) : undefined;
  if (!monster) return <p className="text-xs text-stone-500 italic mt-2">{t('common.loading')}</p>;
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
    <div className="mt-3 space-y-3">
      <StatBlock monster={monster} />
      {encounterId !== undefined && mi && (
        <AttackRoller
          attacks={monsterAttacks}
          rollerMonsterInstanceId={mi.id}
          encounterId={encounterId}
          rollerParticipantId={participant.participantId}
          targets={attackTargetsFor(allParticipants, participant.participantId)}
        />
      )}
    </div>
  );
}

// Split out only because it needs its own useQuery for character_attacks —
// the monster branch above already has its attacks in hand (monster.actions,
// no fetch needed) so it calls AttackRoller directly. Exported for reuse by
// ParticipantSheetPanel.tsx's "take action against this target" section.
export function CharacterAttackRoller({
  characterId,
  encounterId,
  rollerParticipantId,
  targets,
  initialTargetParticipantId,
}: {
  characterId: string;
  encounterId: string;
  rollerParticipantId: string;
  targets: AttackTarget[];
  initialTargetParticipantId?: string;
}) {
  const attacksQuery = useQuery({
    queryKey: ['character', characterId, 'attacks'],
    queryFn: () => api.get<{ attacks: CharacterAttack[] }>(`/characters/${characterId}/attacks`),
  });
  const normalized: NormalizedAttack[] = (attacksQuery.data?.attacks ?? []).map((a) => ({
    key: String(a.id),
    name: a.name,
    attackBonus: a.attack_bonus,
    damageDice: a.damage_dice,
    damageType: a.damage_type,
    saveDc: a.save_dc,
    saveAbilityIndex: a.save_ability_index,
    characterAttackId: a.id,
  }));
  if (normalized.length === 0) return null;
  return (
    <AttackRoller
      attacks={normalized}
      rollerCharacterId={characterId}
      encounterId={encounterId}
      rollerParticipantId={rollerParticipantId}
      targets={targets}
      initialTargetParticipantId={initialTargetParticipantId}
    />
  );
}

export function CombatTracker({ encounter }: { encounter: Encounter }) {
  const { t } = useLocale();
  const {
    campaignId,
    isDm,
    live,
    expandedParticipantId,
    setExpandedParticipantId,
    showDiceRoller,
    setShowDiceRoller,
    charactersQuery,
    monsterInstancesQuery,
    bestiaryQuery,
    myCharacterIds,
    status,
    currentRound,
    availableCharacters,
    availableMonsterInstances,
    startMutation,
    endMutation,
    startCombatMutation,
    endCombatMutation,
    dispositionMutation,
    forceFullscreenMutation,
    rollInitiativeMutation,
    advanceTurnMutation,
    removeParticipantMutation,
    visibilityMutation,
    addParticipantMutation,
    spawnMutation,
    hpMutation,
    applyEffectMutation,
    removeEffectMutation,
  } = useEncounterSessionData(encounter);

  return (
    <div className="space-y-4">
      <header className="rounded-md bg-stone-900 shadow-sm p-4">
        <h2 className="text-lg font-semibold text-stone-100">{encounter.name}</h2>
        <p className="text-sm text-stone-400">
          <span className="uppercase font-medium">{t(`encounters.status.${status}`)}</span>
          {status !== 'preparing' && t('encounters.tracker.roundInline', { round: currentRound })}
        </p>
      </header>

      {[
        startMutation,
        endMutation,
        startCombatMutation,
        endCombatMutation,
        dispositionMutation,
        rollInitiativeMutation,
        advanceTurnMutation,
        removeParticipantMutation,
        addParticipantMutation,
        hpMutation,
        applyEffectMutation,
        removeEffectMutation,
      ]
        .filter((m) => m.isError)
        .map((m, i) => (
          <ErrorBanner key={i} message={errorMessage(m.error)} />
        ))}

      {!live && (
        <p className="text-sm text-stone-500 italic">
          {isDm ? t('encounters.tracker.connectingLive') : t('encounters.tracker.noCharacterYet')}
        </p>
      )}

      {live && (
        <SessionScreen
          encounter={encounter}
          campaignId={campaignId}
          isDm={isDm}
          live={live}
          myCharacterIds={myCharacterIds}
          characters={charactersQuery.data?.characters}
          monsterInstances={monsterInstancesQuery.data?.monsterInstances}
          monsters={bestiaryQuery.data?.monsters}
          expandedParticipantId={expandedParticipantId}
          setExpandedParticipantId={setExpandedParticipantId}
          showDiceRoller={showDiceRoller}
          setShowDiceRoller={setShowDiceRoller}
          startMutation={startMutation}
          endMutation={endMutation}
          startCombatMutation={startCombatMutation}
          endCombatMutation={endCombatMutation}
          dispositionMutation={dispositionMutation}
          forceFullscreenMutation={forceFullscreenMutation}
          rollInitiativeMutation={rollInitiativeMutation}
          advanceTurnMutation={advanceTurnMutation}
          addParticipantMutation={addParticipantMutation}
          spawnMutation={spawnMutation}
          removeParticipantMutation={removeParticipantMutation}
          visibilityMutation={visibilityMutation}
          hpMutation={hpMutation}
          applyEffectMutation={applyEffectMutation}
          removeEffectMutation={removeEffectMutation}
          availableCharacters={availableCharacters}
          availableMonsterInstances={availableMonsterInstances}
          showMap={false}
        />
      )}
    </div>
  );
}

// Ability scores for ActionEconomyPanel's roll triggers — characters carry
// str/dex/etc directly; a monster instance needs a hop through the bestiary
// catalog via its monster_id. Returns null (panel just omits roll buttons)
// if the relevant source list hasn't loaded yet or the row can't be found.
export function resolveAbilityScores(
  participant: SnapshotParticipant,
  characters: Character[] | undefined,
  monsterInstances: MonsterInstance[] | undefined,
  monsters: MonsterCatalogEntry[] | undefined,
): Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number> | null {
  if (participant.characterId != null) {
    const c = characters?.find((ch) => ch.id === participant.characterId);
    if (!c) return null;
    return { str: c.str, dex: c.dex, con: c.con, int: c.int, wis: c.wis, cha: c.cha };
  }
  if (participant.monsterInstanceId != null) {
    const mi = monsterInstances?.find((m) => m.id === participant.monsterInstanceId);
    const m = mi ? monsters?.find((catalog) => catalog.id === mi.monster_id) : undefined;
    if (!m) return null;
    return { str: m.str, dex: m.dex, con: m.con, int: m.int, wis: m.wis, cha: m.cha };
  }
  return null;
}

export function ActionButton({
  children,
  onClick,
  pending,
  variant = 'primary',
}: {
  children: ReactNode;
  onClick: () => void;
  pending?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const styles = {
    primary: 'border border-amber-500 text-amber-500 hover:bg-amber-500/10',
    secondary: 'bg-stone-800 hover:bg-stone-700 text-stone-100 border border-stone-700',
    danger: 'bg-red-700 hover:bg-red-600 text-white',
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`rounded-md font-semibold px-3 py-2 text-sm disabled:opacity-60 min-h-[2.5rem] ${styles}`}
    >
      {pending ? '…' : children}
    </button>
  );
}

// Resets every monster instance currently seated in THIS encounter back to
// "weaknesses hidden" — the one thing the hide/reveal removal kept.
export function ResetRevealsButton({ encounterId }: { encounterId: string }) {
  const { t } = useLocale();
  const mutation = useMutation({
    mutationFn: () => api.post<void>(`/encounters/${encounterId}/reveals/reset`),
  });
  return (
    <ActionButton
      variant="danger"
      pending={mutation.isPending}
      onClick={() => {
        if (confirm(t('encounters.tracker.resetRevealsConfirm'))) {
          mutation.mutate();
        }
      }}
    >
      {t('encounters.tracker.resetReveals')}
    </ActionButton>
  );
}

