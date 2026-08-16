// Selectable attacks + server-validated damage application (REFACTOR-PLAN.md
// §6). Shared between monster catalog actions (StatBlockEntry[]) and a
// character's structured character_attacks rows via the NormalizedAttack
// adapter shape below — one component, not two drifting implementations.
//
// The attack roll (d20 vs AC) reuses the existing DiceRoller unchanged. The
// damage half is NEW: it calls the server-side apply-damage endpoint
// (POST /characters/:id/apply-damage or /monster-instances/:id/apply-damage)
// against a DM-chosen TARGET, rather than the old pattern of an independent
// DiceRoller that only ever logged a number nobody applied. The server rolls
// the dice, doubles them on a crit, and applies the target's actual
// resistance/vulnerability/immunity — this component never computes that
// math itself, only displays the breakdown the server returns (always shown,
// per REFACTOR-PLAN.md §6: "never just a final number").

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { DiceRoller, keptDieIndex } from '../components/DiceRoller';
import { parseDiceExpression } from '../components/QuickDiceRoller';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';
import { useDamageTypesCatalog } from '../lib/useCatalog';
import type { CharacterAttack, DiceRoll, MonsterInstance, PendingActionRequest, SnapshotParticipant } from '../lib/types';

export interface NormalizedAttack {
  key: string;
  name: string;
  attackBonus?: number | null;
  damageDice?: string | null;
  damageType?: string | null;
  saveDc?: number | null;
  saveAbilityIndex?: string | null;
  /** character_attacks.id, when this attack comes from a PC's structured attack
   * list — lets the combat log reference the real catalog row, not just free
   * text. Absent for monster catalog actions (no such row exists for those). */
  characterAttackId?: string | null;
}

export interface AttackTarget {
  participantId: string;
  name: string;
  characterId: string | null;
  monsterInstanceId: string | null;
  // Proactive damage-type hint (Iteration 4) — already role-redacted by the
  // server before this ever reaches the client (monsters.ts's
  // resolveReveals/redactEntityFields: absent/undefined for a player role
  // until the DM reveals it, always the true value for the DM), so this
  // component never needs its own redaction logic. Undefined for character
  // targets (weaknesses only exist on monster instances).
  damageVulnerabilities?: string[] | null;
  damageResistances?: string[] | null;
  damageImmunities?: string[] | null;
}

interface ApplyDamageResponse {
  appliedDamage: number;
  rawTotal: number;
  breakdown: {
    diceTotal: number;
    modifier: number;
    resistanceApplied: boolean;
    vulnerabilityApplied: boolean;
    immune: boolean;
  };
}

export function AttackRoller({
  attacks,
  rollerCharacterId,
  rollerMonsterInstanceId,
  encounterId,
  rollerParticipantId,
  targets,
  initialTargetParticipantId,
}: {
  attacks: NormalizedAttack[];
  rollerCharacterId?: string | null;
  rollerMonsterInstanceId?: string | null;
  encounterId: string;
  /** The roller's own combat_participants id — present whenever this
   * renders inside a live encounter (every current call site has it), used
   * only for the best-effort action-economy spend below; absent, the attack
   * roll still works exactly as before, just without that side effect. */
  rollerParticipantId?: string;
  /** Every other live participant this roller could plausibly hit — the DM
   * picks which one actually takes the damage. */
  targets: AttackTarget[];
  /** Pre-selects the target dropdown — ParticipantSheetPanel's "take action
   * against this target" entry point. Purely a UI convenience: the target
   * can still be changed, and this has no effect if the id isn't in `targets`. */
  initialTargetParticipantId?: string;
}) {
  const rollable = attacks.filter((a) => a.attackBonus != null || a.damageDice != null || a.saveDc != null);
  if (rollable.length === 0) return null;

  return (
    <div className="space-y-2">
      {rollable.map((attack) => (
        <AttackRow
          key={attack.key}
          attack={attack}
          encounterId={encounterId}
          rollerParticipantId={rollerParticipantId}
          targets={targets}
          rollerCharacterId={rollerCharacterId}
          rollerMonsterInstanceId={rollerMonsterInstanceId}
          initialTargetParticipantId={initialTargetParticipantId}
        />
      ))}
    </div>
  );
}

function AttackRow({
  attack,
  encounterId,
  rollerParticipantId,
  targets,
  rollerCharacterId,
  rollerMonsterInstanceId,
  initialTargetParticipantId,
}: {
  attack: NormalizedAttack;
  encounterId: string;
  rollerParticipantId?: string;
  targets: AttackTarget[];
  rollerCharacterId?: string | null;
  rollerMonsterInstanceId?: string | null;
  initialTargetParticipantId?: string;
}) {
  const { t } = useLocale();
  const damageTypesQuery = useDamageTypesCatalog();
  const [lastAttackRoll, setLastAttackRoll] = useState<DiceRoll | null>(null);
  // Bug fix: this used to be `useState<number | ''>('')` with `Number(e.target.value)`
  // on change — participantId is a UUID string (post uuid-primary-keys
  // migration), so `Number(uuid)` is always NaN and `target` below could
  // never match, silently disabling "Apply damage" for every attack. Left
  // over from before that migration; caught while wiring the pre-fill prop.
  const [targetId, setTargetId] = useState<string>(initialTargetParticipantId ?? '');
  useEffect(() => {
    if (initialTargetParticipantId) setTargetId(initialTargetParticipantId);
  }, [initialTargetParticipantId]);
  const parsedDamage = attack.damageDice ? parseDiceExpression(attack.damageDice) : null;
  const isSaveBased = attack.saveDc != null;

  // Best-effort action-economy spend (Phase 7): an attack roll marks the
  // action slot used when it's free, but NEVER blocks the roll itself —
  // Extra Attack (a second attack that's part of the SAME action) and
  // opportunity attacks (a reaction, not tracked per-trigger here) aren't
  // modeled as separate cases, so treating "already used" as an error would
  // incorrectly block them. Errors from this mutation are intentionally
  // swallowed (no ErrorBanner, no thrown promise) — see onError below.
  const spendActionMutation = useMutation({
    mutationFn: () => {
      if (!rollerParticipantId) return Promise.resolve();
      return api.patch(`/encounters/${encounterId}/participants/${rollerParticipantId}/action-economy`, { spend: 'action' });
    },
    onError: () => {}, // best-effort only — already-used/off-turn/etc. are not user-facing errors here
  });

  // docs/rules/attacks-and-damage.md §1.5/§3: a 20 only counts as a crit if
  // it's the KEPT die — never the discarded one under disadvantage.
  const isCritical =
    !isSaveBased && lastAttackRoll != null && lastAttackRoll.d20_rolls[keptDieIndex(lastAttackRoll.d20_rolls, lastAttackRoll.keep)] === 20;

  const target = targets.find((t) => t.participantId === targetId);

  // Proactive damage-type hint (Iteration 4) — the post-hit breakdown below
  // already shows resist/vulnerable/immune AFTER applying damage; this
  // surfaces the same fact BEFORE the roller commits, using weakness data
  // that's already fetched and already role-redacted (see AttackTarget's
  // damageResistances/Vulnerabilities/Immunities comment). Absent for
  // character targets and for an un-revealed monster, so this silently
  // renders nothing rather than a false "no weakness" claim.
  const weaknessHint: 'immune' | 'vulnerable' | 'resistant' | null =
    target && attack.damageType
      ? target.damageImmunities?.includes(attack.damageType)
        ? 'immune'
        : target.damageVulnerabilities?.includes(attack.damageType)
          ? 'vulnerable'
          : target.damageResistances?.includes(attack.damageType)
            ? 'resistant'
            : null
      : null;

  // Combat log (nav point 2) — recorded once damage actually lands, not on
  // the attack roll alone, since that's the point every field (result,
  // damage) is finally known. Best-effort: swallowed on error, same as the
  // action-economy spend above — a logging failure must never look like the
  // attack itself failed, and the damage has already been applied server-side
  // by the time this fires.
  const recordActionMutation = useMutation({
    mutationFn: (vars: { appliedDamage: number }) => {
      if (!rollerParticipantId || !target) return Promise.resolve();
      const damageTypeId = damageTypesQuery.data?.damageTypes.find((dt) => dt.index_key === attack.damageType)?.id;
      return api.post(`/encounters/${encounterId}/actions`, {
        actorParticipantId: rollerParticipantId,
        targetParticipantIds: [target.participantId],
        // No ranged/melee distinction is tracked anywhere in this app's
        // attack data today (character_attacks/monster actions have no
        // range field) — attack-roll-based defaults to melee, save-based to
        // spell, the closest reasonable default per 5e convention rather
        // than a guess with no basis.
        actionType: isSaveBased ? 'spell' : 'melee_attack',
        meansCharacterAttackId: attack.characterAttackId ?? undefined,
        meansLabel: attack.name,
        diceRollId: !isSaveBased ? (lastAttackRoll?.id ?? undefined) : undefined,
        resultKind: isSaveBased ? 'save_fail' : 'hit',
        damageAmount: vars.appliedDamage,
        damageTypeId,
      });
    },
    onError: () => {},
  });

  const applyDamageMutation = useMutation({
    mutationFn: () => {
      if (!target || !parsedDamage) throw new Error('No target selected');
      const path = target.characterId != null ? `/characters/${target.characterId}/apply-damage` : `/monster-instances/${target.monsterInstanceId}/apply-damage`;
      return api.post<ApplyDamageResponse | { pending: true; request: PendingActionRequest }>(path, {
        diceSides: parsedDamage.sides,
        diceCount: parsedDamage.count,
        modifier: parsedDamage.modifier,
        damageType: attack.damageType ?? null,
        // Security major M3 — the server no longer trusts a client-asserted
        // isCritical; it re-derives criticality itself from the referenced
        // attack roll's actual stored d20. Save-based effects never crit
        // (docs/rules/attacks-and-damage.md §1.6), so no roll is sent for
        // those regardless of what a prior attack roll happened to be.
        attackRollId: !isSaveBased ? (lastAttackRoll?.id ?? undefined) : undefined,
        rollContext: `${attack.name}${target ? ` → ${target.name}` : ''}`,
        encounterId,
        // Phase 1 "players attack from their own UI" — lets the server verify
        // a non-DM caller controls this participant and that it's their turn
        // (services/monsters.ts's authorizePlayerAttack); a no-op extra field
        // for the DM's own unconditional path.
        attackerParticipantId: rollerParticipantId,
      });
    },
    onSuccess: (data) => {
      // Phase 4 "DM pre-approval" — a pending request hasn't rolled/applied
      // anything yet, so there's nothing to log; the combat-log entry for the
      // eventual approved outcome is recorded by the DM's approval flow
      // (routes/pendingActions.ts), not here.
      if ('pending' in data) return;
      recordActionMutation.mutate({ appliedDamage: data.appliedDamage });
    },
  });

  return (
    <div className="rounded-md border border-stone-800 bg-stone-950 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-stone-200">{attack.name}</span>
        <span className="text-[10px] text-stone-500">
          {isSaveBased
            ? t('encounters.attackRoller.saveFormat', { dc: attack.saveDc ?? '', ability: attack.saveAbilityIndex?.toUpperCase() ?? '' })
            : attack.attackBonus != null
              ? t('encounters.attackRoller.toHit', { bonus: attack.attackBonus })
              : null}
          {attack.damageDice &&
            t('encounters.attackRoller.damageFormat', {
              dice: attack.damageDice,
              type: attack.damageType ? ` ${attack.damageType}` : '',
            })}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!isSaveBased && attack.attackBonus != null && (
          <DiceRoller
            rollType="attack"
            rollContext={`${attack.name} — attack roll`}
            modifier={attack.attackBonus}
            triggerLabel={t('encounters.attackRoller.attackTrigger')}
            onRoll={(roll) => {
              setLastAttackRoll(roll);
              spendActionMutation.mutate();
            }}
            characterId={rollerCharacterId ?? undefined}
            monsterInstanceId={rollerMonsterInstanceId ?? undefined}
            encounterId={encounterId}
            allowHiddenRoll
          />
        )}
        {parsedDamage && (
          <>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-[10px] text-stone-200"
            >
              <option value="">{t('encounters.attackRoller.targetPlaceholder')}</option>
              {targets.map((targetOption) => (
                <option key={targetOption.participantId} value={targetOption.participantId}>
                  {targetOption.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!target || applyDamageMutation.isPending}
              title={isCritical ? t('encounters.attackRoller.critTitle') : undefined}
              onClick={() => applyDamageMutation.mutate()}
              className={`rounded-md border px-2 py-1 text-[10px] font-semibold disabled:opacity-40 ${
                isCritical
                  ? 'border-emerald-600 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-950/70'
                  : 'border-stone-700 bg-stone-800 text-stone-200 hover:bg-stone-700'
              }`}
            >
              {isCritical ? t('encounters.attackRoller.applyDamageCrit') : t('encounters.attackRoller.applyDamage')}
            </button>
            {weaknessHint && (
              <span
                className={`text-[10px] font-medium ${
                  weaknessHint === 'immune' ? 'text-stone-500' : weaknessHint === 'vulnerable' ? 'text-red-400' : 'text-sky-400'
                }`}
              >
                {t(`encounters.attackRoller.weaknessHint.${weaknessHint}`, { type: attack.damageType ?? '' })}
              </span>
            )}
          </>
        )}
      </div>

      {applyDamageMutation.isError && <ErrorBanner message={errorMessage(applyDamageMutation.error)} />}
      {applyDamageMutation.data && 'pending' in applyDamageMutation.data && (
        <p className="text-[10px] text-amber-500">{t('encounters.pendingActions.submitted')}</p>
      )}
      {applyDamageMutation.data && !('pending' in applyDamageMutation.data) && (
        <p className="text-[10px] text-stone-400 font-mono tabular-nums">
          {t('encounters.attackRoller.rolled', { diceTotal: applyDamageMutation.data.breakdown.diceTotal })}
          {applyDamageMutation.data.breakdown.modifier !== 0 &&
            ` ${applyDamageMutation.data.breakdown.modifier >= 0 ? '+' : ''}${applyDamageMutation.data.breakdown.modifier}`}
          {' '}
          {t('encounters.attackRoller.equalsRawTotal', { total: applyDamageMutation.data.rawTotal })}
          {applyDamageMutation.data.breakdown.immune && (
            <span className="text-stone-500">{t('encounters.attackRoller.immuneApplied')}</span>
          )}
          {!applyDamageMutation.data.breakdown.immune && applyDamageMutation.data.breakdown.resistanceApplied && (
            <span className="text-sky-400">{t('encounters.attackRoller.resisted')}</span>
          )}
          {!applyDamageMutation.data.breakdown.immune && applyDamageMutation.data.breakdown.vulnerabilityApplied && (
            <span className="text-red-400">{t('encounters.attackRoller.vulnerable')}</span>
          )}
          {!applyDamageMutation.data.breakdown.immune && (
            <span className="text-amber-400 font-bold text-sm">
              {t('encounters.attackRoller.applied', { amount: applyDamageMutation.data.appliedDamage })}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// Every other live participant a roller could plausibly hit — moved here
// (out of CombatTracker.tsx, its original home) so BattleModePlayerPanel.tsx
// can reuse it too without a CombatTracker -> SessionScreen ->
// BattleModePlayerPanel -> CombatTracker import cycle (CombatTracker.tsx
// imports SessionScreen.tsx, which imports BattleModePlayerPanel.tsx).
export function attackTargetsFor(
  allParticipants: SnapshotParticipant[] | undefined,
  selfId: string,
  // Optional (Iteration 4) — when supplied, threads each monster target's
  // already-role-redacted weakness fields onto AttackTarget so AttackRoller
  // can show a proactive resist/vulnerable/immune hint before the roller
  // commits. Omitted entirely still works exactly as before.
  monsterInstances?: MonsterInstance[],
): AttackTarget[] {
  return (allParticipants ?? [])
    .filter((p) => p.participantId !== selfId)
    .map((p) => {
      const mi = p.monsterInstanceId != null ? monsterInstances?.find((m) => m.id === p.monsterInstanceId) : undefined;
      return {
        participantId: p.participantId,
        name: p.name,
        characterId: p.characterId,
        monsterInstanceId: p.monsterInstanceId,
        damageVulnerabilities: mi?.damage_vulnerabilities,
        damageResistances: mi?.damage_resistances,
        damageImmunities: mi?.damage_immunities,
      };
    });
}

// Split out only because it needs its own useQuery for character_attacks —
// a monster roller already has its attacks in hand (monster.actions, no
// fetch needed) and calls AttackRoller directly. Exported for reuse by
// ParticipantSheetPanel.tsx's "take action against this target" section and
// BattleModePlayerPanel.tsx's own attack trigger.
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
