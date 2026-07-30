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

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { DiceRoller, keptDieIndex } from '../components/DiceRoller';
import { parseDiceExpression } from '../components/QuickDiceRoller';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';
import type { DiceRoll } from '../lib/types';

export interface NormalizedAttack {
  key: string;
  name: string;
  attackBonus?: number | null;
  damageDice?: string | null;
  damageType?: string | null;
  saveDc?: number | null;
  saveAbilityIndex?: string | null;
}

export interface AttackTarget {
  participantId: string;
  name: string;
  characterId: string | null;
  monsterInstanceId: string | null;
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
}: {
  attack: NormalizedAttack;
  encounterId: string;
  rollerParticipantId?: string;
  targets: AttackTarget[];
  rollerCharacterId?: string | null;
  rollerMonsterInstanceId?: string | null;
}) {
  const { t } = useLocale();
  const [lastAttackRoll, setLastAttackRoll] = useState<DiceRoll | null>(null);
  const [targetId, setTargetId] = useState<number | ''>('');
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

  const applyDamageMutation = useMutation({
    mutationFn: () => {
      if (!target || !parsedDamage) throw new Error('No target selected');
      const path = target.characterId != null ? `/characters/${target.characterId}/apply-damage` : `/monster-instances/${target.monsterInstanceId}/apply-damage`;
      return api.post<ApplyDamageResponse>(path, {
        diceSides: parsedDamage.sides,
        diceCount: parsedDamage.count,
        modifier: parsedDamage.modifier,
        damageType: attack.damageType ?? null,
        // Save-based effects never crit (docs/rules/attacks-and-damage.md
        // §1.6) — this component never sends isCritical:true for one,
        // regardless of what a prior attack roll happened to be.
        isCritical: isSaveBased ? false : isCritical,
        rollContext: `${attack.name}${target ? ` → ${target.name}` : ''}`,
        encounterId,
      });
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
          />
        )}
        {parsedDamage && (
          <>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : '')}
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
          </>
        )}
      </div>

      {applyDamageMutation.isError && <ErrorBanner message={errorMessage(applyDamageMutation.error)} />}
      {applyDamageMutation.data && (
        <p className="text-[10px] text-stone-400">
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
            <span className="text-amber-400 font-semibold">
              {t('encounters.attackRoller.applied', { amount: applyDamageMutation.data.appliedDamage })}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
