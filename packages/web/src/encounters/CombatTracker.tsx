import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Character,
  CharacterAttack,
  Encounter,
  EncounterWithParticipants,
  MonsterCatalogEntry,
  MonsterInstance,
  SnapshotParticipant,
  StatBlockEntry,
} from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useEncounterLive } from './useEncounterLive';
import { useEffectDefinitionsCatalog } from '../lib/useCatalog';
import { HPBar } from '../components/HPBar';
import { HpAdjustForm } from '../components/HpAdjustForm';
import { EffectBadge } from '../components/EffectBadge';
import { EffectApplyDialog, type ApplyEffectFormInput } from '../components/EffectApplyDialog';
import { ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { ActionEconomyPanel } from './ActionEconomyPanel';
import { Combobox } from '../components/Combobox';
import { useAuth } from '../auth/AuthContext';
import { RevealToggle } from '../components/RevealToggle';
import { useReveals } from '../lib/useReveal';
import { StatBlock } from '../components/StatBlock';
import { AbilityScoreGrid } from '../components/AbilityScoreGrid';
import { QuickDiceRoller } from '../components/QuickDiceRoller';
import { useLocale } from '../i18n/LocaleContext';
import { BattleMode } from './BattleMode';
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
function attackTargetsFor(allParticipants: SnapshotParticipant[] | undefined, selfId: string): AttackTarget[] {
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
// no fetch needed) so it calls AttackRoller directly.
function CharacterAttackRoller({
  characterId,
  encounterId,
  rollerParticipantId,
  targets,
}: {
  characterId: string;
  encounterId: string;
  rollerParticipantId: string;
  targets: AttackTarget[];
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
  }));
  if (normalized.length === 0) return null;
  return (
    <AttackRoller
      attacks={normalized}
      rollerCharacterId={characterId}
      encounterId={encounterId}
      rollerParticipantId={rollerParticipantId}
      targets={targets}
    />
  );
}

export function CombatTracker({ encounter }: { encounter: Encounter }) {
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const isDm = role === 'dm';
  const live = useEncounterLive(encounter.id);
  // REVISION-PLAN.md §9.3/§9.4 — both let the DM stay on this screen instead
  // of navigating to the Bestiary tab or the Dice Rolls page mid-combat.
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);
  const [showDiceRoller, setShowDiceRoller] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['encounterDetail', encounter.id],
    queryFn: () =>
      api.get<{ encounter: EncounterWithParticipants }>(`/campaigns/${campaignId}/encounters/${encounter.id}`),
  });

  // Not DM-only: a player needs this too, to know which participant row is
  // THEIR OWN character (see myCharacterIds below) — the player-facing
  // "optimized for movement/HP/actions" visual redesign is a highlighted row
  // for that character, since players have no other reason to scan the full
  // roster the way a DM does.
  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });

  const myCharacterIds = new Set(
    charactersQuery.data?.characters.filter((c) => c.owner_user_id === user?.id).map((c) => c.id) ?? [],
  );

  const monsterInstancesQuery = useQuery({
    queryKey: ['monsterInstances', campaignId],
    queryFn: () => api.get<{ monsterInstances: MonsterInstance[] }>(`/campaigns/${campaignId}/monster-instances`),
    enabled: isDm,
  });

  // Ability scores for the turn-action panel's roll triggers (Grab/Shove/
  // Hide) — characters carry these directly, monster instances need a join
  // through the bestiary catalog to their monster_id.
  const bestiaryQuery = useQuery({
    queryKey: ['catalog', 'monsters', campaign.srd_edition, campaignId],
    queryFn: () =>
      api.get<{ monsters: MonsterCatalogEntry[] }>(
        `/catalog/monsters?edition=${campaign.srd_edition}&campaignId=${campaignId}`,
      ),
    enabled: isDm,
  });

  const effectDefinitionsQuery = useEffectDefinitionsCatalog(campaignId);

  function invalidateControlPlane() {
    void queryClient.invalidateQueries({ queryKey: ['encounters', campaignId] });
    void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounter.id] });
  }

  const startMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounter.id}/start`),
    onSuccess: invalidateControlPlane,
  });
  const endMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounter.id}/end`),
    onSuccess: invalidateControlPlane,
  });
  const rollInitiativeMutation = useMutation({
    mutationFn: (force: boolean) => api.post(`/encounters/${encounter.id}/roll-initiative`, { force }),
    onSuccess: invalidateControlPlane,
  });
  const advanceTurnMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounter.id}/advance-turn`),
    onSuccess: invalidateControlPlane,
  });
  const removeParticipantMutation = useMutation({
    mutationFn: (participantId: string) => api.delete(`/encounters/${encounter.id}/participants/${participantId}`),
    onSuccess: invalidateControlPlane,
  });
  const addParticipantMutation = useMutation({
    mutationFn: (body: { characterId?: string; monsterInstanceId?: string }) =>
      api.post(`/encounters/${encounter.id}/participants`, body),
    onSuccess: invalidateControlPlane,
  });
  const hpMutation = useMutation({
    mutationFn: ({
      target,
      id,
      delta,
      tempDelta,
    }: {
      target: 'character' | 'monster';
      id: string;
      delta: number;
      tempDelta: number;
    }) =>
      target === 'character'
        ? api.patch(`/characters/${id}/hp`, { delta, tempDelta })
        : api.patch(`/monster-instances/${id}/hp`, { delta, tempDelta }),
    // No cache write here on purpose — HP_CHANGED arriving over the socket
    // (which the DM's own action also triggers, per PLAN.md §5.2) is the
    // single source of truth for combat HP display, so this mutation only
    // needs to surface errors, not race a second local write.
  });
  const applyEffectMutation = useMutation({
    mutationFn: ({ participant, input }: { participant: SnapshotParticipant; input: ApplyEffectFormInput }) =>
      api.post(`/encounters/${encounter.id}/effects`, {
        ...(participant.characterId != null
          ? { characterId: participant.characterId }
          : { monsterInstanceId: participant.monsterInstanceId }),
        effectDefinitionId: input.effectDefinitionId,
        durationValue: input.durationValue,
      }),
    // Same "no cache write" discipline as hpMutation — EFFECT_APPLIED over
    // the socket is the source of truth (see useEncounterLive.ts).
  });
  const removeEffectMutation = useMutation({
    mutationFn: (effectId: string) => api.delete(`/effects/${effectId}`),
    // EFFECT_EXPIRED over the socket patches the cache; see useEncounterLive.ts.
  });

  const status = live?.encounter.status ?? detailQuery.data?.encounter.status ?? encounter.status;
  const currentRound = live?.encounter.currentRound ?? detailQuery.data?.encounter.current_round ?? encounter.current_round;
  const participants: SnapshotParticipant[] = live?.participants ?? [];
  const activeParticipantId = live?.activeParticipantId ?? null;

  const existingCharacterIds = new Set(
    (live?.participants.map((p) => p.characterId) ?? detailQuery.data?.encounter.participants.map((p) => p.character_id) ?? []).filter(
      (id): id is string => id != null,
    ),
  );
  const existingMonsterInstanceIds = new Set(
    (
      live?.participants.map((p) => p.monsterInstanceId) ??
      detailQuery.data?.encounter.participants.map((p) => p.monster_instance_id) ??
      []
    ).filter((id): id is string => id != null),
  );

  const availableCharacters = (charactersQuery.data?.characters ?? []).filter((c) => !existingCharacterIds.has(c.id));
  const availableMonsterInstances = (monsterInstancesQuery.data?.monsterInstances ?? []).filter(
    (mi) => !existingMonsterInstanceIds.has(mi.id),
  );

  return (
    <div className="space-y-4">
      <header className="rounded-md bg-stone-900 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-100">{encounter.name}</h2>
          {status === 'active' ? (
            // Battle mode (REVISION-PLAN.md §10.2): the DM turn-control
            // buttons below relocate into BattleModeDmPanel, so this header
            // shrinks to just name + round rather than duplicating them.
            <p className="text-sm text-stone-400">{t('encounters.tracker.round', { round: currentRound })}</p>
          ) : (
            <p className="text-sm text-stone-400">
              <span className="uppercase font-medium">{t(`encounters.status.${status}`)}</span>
              {status !== 'preparing' && t('encounters.tracker.roundInline', { round: currentRound })}
            </p>
          )}
        </div>

        {isDm && status !== 'active' && (
          <div className="flex flex-wrap gap-2">
            {status === 'preparing' && (
              <ActionButton onClick={() => startMutation.mutate()} pending={startMutation.isPending}>
                {t('encounters.tracker.startEncounter')}
              </ActionButton>
            )}
            {status === 'paused' && (
              <ActionButton onClick={() => endMutation.mutate()} pending={endMutation.isPending} variant="danger">
                {t('encounters.tracker.endEncounter')}
              </ActionButton>
            )}
            <ActionButton
              onClick={() => rollInitiativeMutation.mutate(false)}
              pending={rollInitiativeMutation.isPending}
              variant="secondary"
            >
              {t('encounters.tracker.rollInitiative')}
            </ActionButton>
          </div>
        )}
      </header>

      {[
        startMutation,
        endMutation,
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

      {live && live.encounter.status === 'active' ? (
        <BattleMode
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
          endMutation={endMutation}
          rollInitiativeMutation={rollInitiativeMutation}
          advanceTurnMutation={advanceTurnMutation}
          addParticipantMutation={addParticipantMutation}
          availableCharacters={availableCharacters}
          availableMonsterInstances={availableMonsterInstances}
        />
      ) : (
        <>
      <div className="flex gap-2 items-center justify-between">
        <div className="flex gap-2">
          <ActionButton
            onClick={() => setShowDiceRoller((s) => !s)}
            variant={showDiceRoller ? 'primary' : 'secondary'}
          >
            {showDiceRoller ? t('encounters.tracker.hideDice') : t('encounters.tracker.rollDice')}
          </ActionButton>
        </div>
        {isDm && <ResetRevealsButton encounterId={encounter.id} />}
      </div>

      {showDiceRoller && <QuickDiceRoller encounterId={encounter.id} />}

      <ol className="space-y-2">
        {participants.map((p) => {
          const isMine = p.characterId != null && myCharacterIds.has(p.characterId);
          return (
          <li
            key={p.participantId}
            className={`rounded-lg border p-3 sm:p-4 ${
              p.participantId === activeParticipantId
                ? 'border-amber-600 bg-amber-950/20'
                : 'border-stone-800 bg-stone-900'
            } ${isMine ? 'ring-2 ring-amber-500/50' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-stone-500 text-sm font-mono w-10 flex-shrink-0">
                  {p.initiativeRoll > -9999 ? p.initiativeRoll : '—'}
                </span>
                <span className="font-medium text-stone-100 truncate">{p.name}</span>
                {isMine && (
                  <span className="text-[10px] uppercase font-semibold text-amber-500 border border-amber-700 rounded px-1 flex-shrink-0">
                    {t('encounters.tracker.you')}
                  </span>
                )}
                <span
                  className="text-xs text-stone-500 border border-stone-700 rounded px-1 flex-shrink-0"
                  title={t('encounters.tracker.armorClass')}
                >
                  AC {p.armorClass}
                </span>
                {isDm && p.monsterInstanceId != null && <ParticipantWeaknessReveal monsterInstanceId={p.monsterInstanceId} />}
                <span
                  className={`text-xs rounded px-1 flex-shrink-0 border ${
                    p.posX != null && p.posY != null
                      ? 'text-stone-500 border-stone-700'
                      : 'text-stone-600 border-stone-800 italic'
                  }`}
                  title={t('encounters.tracker.position')}
                >
                  {p.posX != null && p.posY != null ? `(${p.posX}, ${p.posY})` : t('encounters.tracker.unplaced')}
                </span>
                {p.participantId === activeParticipantId && (
                  <span className="text-xs uppercase font-semibold text-amber-500">{t('encounters.tracker.currentTurn')}</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="min-w-[8rem]">
                  <HPBar current={p.hp.hpCurrent} max={p.hp.hpMax} temp={p.hp.hpTemp} />
                </div>
                {isDm && (
                  <button
                    type="button"
                    onClick={() => setExpandedParticipantId((id) => (id === p.participantId ? null : p.participantId))}
                    aria-expanded={expandedParticipantId === p.participantId}
                    aria-label={
                      expandedParticipantId === p.participantId
                        ? t('encounters.tracker.hideStats', { name: p.name })
                        : t('encounters.tracker.viewStats', { name: p.name })
                    }
                    title={t('encounters.tracker.viewFullStats')}
                    className="inline-flex h-10 w-10 items-center justify-center text-stone-400 hover:text-stone-200"
                  >
                    {expandedParticipantId === p.participantId ? '▾' : '▸'}
                  </button>
                )}
                {isDm && (
                  <button
                    type="button"
                    onClick={() => removeParticipantMutation.mutate(p.participantId)}
                    className="text-red-400 hover:text-red-300 text-sm px-1"
                    aria-label={t('encounters.tracker.removeParticipant', { name: p.name })}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {isDm && expandedParticipantId === p.participantId && (
              <ParticipantStatLookup
                participant={p}
                characters={charactersQuery.data?.characters}
                monsterInstances={monsterInstancesQuery.data?.monsterInstances}
                monsters={bestiaryQuery.data?.monsters}
                encounterId={encounter.id}
                allParticipants={live?.participants}
              />
            )}

            {isDm && (
              <HpAdjustForm
                compact
                disabled={hpMutation.isPending}
                onApply={(delta, tempDelta) =>
                  hpMutation.mutate({
                    target: p.characterId != null ? 'character' : 'monster',
                    id: (p.characterId ?? p.monsterInstanceId)!,
                    delta,
                    tempDelta,
                  })
                }
              />
            )}

            {(p.effects.length > 0 || isDm) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {p.effects.map((effect) => (
                  <EffectBadge
                    key={effect.effectId}
                    effect={effect}
                    removable={isDm}
                    onRemove={() => removeEffectMutation.mutate(effect.effectId)}
                  />
                ))}
                {isDm && (
                  <EffectApplyDialog
                    effectDefinitions={effectDefinitionsQuery.data?.effectDefinitions ?? []}
                    pending={applyEffectMutation.isPending}
                    onApply={(input) => applyEffectMutation.mutate({ participant: p, input })}
                  />
                )}
              </div>
            )}

            {isDm && p.participantId === activeParticipantId && (
              <ActionEconomyPanel
                encounterId={encounter.id}
                participant={p}
                abilityScores={resolveAbilityScores(p, charactersQuery.data?.characters, monsterInstancesQuery.data?.monsterInstances, bestiaryQuery.data?.monsters)}
                otherParticipants={participants.filter((other) => other.participantId !== p.participantId)}
              />
            )}
          </li>
          );
        })}
        {participants.length === 0 && live && <EmptyState message={t('encounters.tracker.noParticipantsYet')} />}
      </ol>

      {isDm && (
        <AddParticipantForm
          characters={availableCharacters}
          monsterInstances={availableMonsterInstances}
          pending={addParticipantMutation.isPending}
          onAdd={(body) => addParticipantMutation.mutate(body)}
        />
      )}
        </>
      )}
    </div>
  );
}

// Ability scores for ActionEconomyPanel's roll triggers — characters carry
// str/dex/etc directly; a monster instance needs a hop through the bestiary
// catalog via its monster_id. Returns null (panel just omits roll buttons)
// if the relevant source list hasn't loaded yet or the row can't be found.
function resolveAbilityScores(
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

export function AddParticipantForm({
  characters,
  monsterInstances,
  onAdd,
  pending,
}: {
  characters: Character[];
  monsterInstances: MonsterInstance[];
  onAdd: (body: { characterId?: string; monsterInstanceId?: string }) => void;
  pending: boolean;
}) {
  const { t } = useLocale();
  const [kind, setKind] = useState<'character' | 'monster'>('character');
  const [selected, setSelected] = useState('');

  const options = kind === 'character' ? characters : monsterInstances;

  function handleAdd() {
    if (!selected) return;
    onAdd(kind === 'character' ? { characterId: selected } : { monsterInstanceId: selected });
    setSelected('');
  }

  return (
    <div className="rounded-md bg-stone-900 shadow-sm p-4 flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-xs text-stone-500 mb-1">{t('encounters.tracker.addParticipant')}</label>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as 'character' | 'monster');
            setSelected('');
          }}
          className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
        >
          <option value="character">{t('encounters.tracker.character')}</option>
          <option value="monster">{t('encounters.tracker.monsterInstance')}</option>
        </select>
      </div>
      <Combobox
        value={selected}
        onChange={setSelected}
        placeholder={t('common.search')}
        className="min-w-[10rem]"
        options={options.map((o) => ({
          value: String(o.id),
          label: 'name' in o ? o.name : (o as MonsterInstance).custom_name || (o as MonsterInstance).monster_name || `#${o.id}`,
        }))}
      />
      <button
        type="button"
        disabled={!selected || pending}
        onClick={handleAdd}
        className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-sm"
      >
        {t('encounters.tracker.add')}
      </button>
    </div>
  );
}
