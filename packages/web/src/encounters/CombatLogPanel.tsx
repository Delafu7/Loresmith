// Combat log (nav point 2) — reads the append-only combat_actions ledger
// (services/combatActions.ts), rendering structured rows as one readable
// line each ("Aria attacks Goblin Scout with Shortbow → 14 (hit) → 6
// piercing damage") built from fields, never string-parsed. Same
// history-page + live-socket-events shape as DiceRollHistoryPage.tsx: a
// manual offset cursor for "load earlier," ACTION_RECORDED events prepended
// as they arrive, source-prefixed keys so a live row that later also shows
// up in a page fetch is a harmless duplicate render, not a key collision.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ActionRecordedEvent, CombatActionWire, EffectExpiredEvent } from '../lib/socketTypes';
import type { SnapshotParticipant } from '../lib/types';
import { useSocket } from '../lib/SocketContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Button } from '../components/ui/Button';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';

const VERB_KEYS: Record<string, TranslationKey> = {
  melee_attack: 'encounters.combatLog.verbMeleeAttack',
  ranged_attack: 'encounters.combatLog.verbRangedAttack',
  spell: 'encounters.combatLog.verbSpell',
  ability: 'encounters.combatLog.verbAbility',
  item: 'encounters.combatLog.verbItem',
  healing: 'encounters.combatLog.verbHealing',
  movement: 'encounters.combatLog.verbMovement',
  other: 'encounters.combatLog.verbOther',
};

const RESULT_KEYS: Record<string, TranslationKey> = {
  hit: 'encounters.combatLog.resultHit',
  miss: 'encounters.combatLog.resultMiss',
  save_success: 'encounters.combatLog.resultSaveSuccess',
  save_fail: 'encounters.combatLog.resultSaveFail',
  effect: 'encounters.combatLog.resultEffect',
};

const PAGE_SIZE = 30;

// A condition/effect wearing off used to clear silently (useEncounterLive.ts's
// onEffectExpired only ever mutated the participant's effects array) — the DM
// had no way to notice short of staring at the badges. This is a client-only,
// non-persisted notice (there's no combat_actions row for an expiry, so it
// can't reuse CombatActionWire/ACTION_RECORDED's server-paginated shape),
// shown at the top of the same log surface rather than inventing a separate
// toast system.
interface ExpiryNotice {
  key: string;
  effectName: string;
  targetName: string;
}

export function CombatLogPanel({ encounterId, participants }: { encounterId: string; participants?: SnapshotParticipant[] }) {
  const { t } = useLocale();
  const { socket } = useSocket();
  const [offset, setOffset] = useState(0);
  const [historyActions, setHistoryActions] = useState<CombatActionWire[]>([]);
  const [liveActions, setLiveActions] = useState<CombatActionWire[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [expiryNotices, setExpiryNotices] = useState<ExpiryNotice[]>([]);

  const pageQuery = useQuery({
    queryKey: ['encounter', encounterId, 'actions', offset],
    queryFn: () => api.get<{ actions: CombatActionWire[] }>(`/encounters/${encounterId}/actions?limit=${PAGE_SIZE}&offset=${offset}`),
  });

  useEffect(() => {
    if (!pageQuery.data) return;
    setHistoryActions((prev) => [...prev, ...pageQuery.data.actions]);
    setHasMore(pageQuery.data.actions.length === PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageQuery.data]);

  useEffect(() => {
    function onActionRecorded(payload: ActionRecordedEvent) {
      if (payload.encounterId !== encounterId) return;
      setLiveActions((prev) => {
        if (prev.some((a) => a.id === payload.action.id)) return prev;
        return [payload.action, ...prev];
      });
    }
    socket.on('ACTION_RECORDED', onActionRecorded);
    return () => {
      socket.off('ACTION_RECORDED', onActionRecorded);
    };
  }, [socket, encounterId]);

  useEffect(() => {
    function onEffectExpired(payload: EffectExpiredEvent) {
      if (payload.encounterId !== encounterId) return;
      const target = participants?.find((p) =>
        payload.targetType === 'character' ? p.characterId === payload.targetId : p.monsterInstanceId === payload.targetId,
      );
      setExpiryNotices((prev) => [
        { key: `${payload.effectId}-${payload.seq}`, effectName: payload.name, targetName: target?.name ?? '?' },
        ...prev,
      ].slice(0, 20));
    }
    socket.on('EFFECT_EXPIRED', onEffectExpired);
    return () => {
      socket.off('EFFECT_EXPIRED', onEffectExpired);
    };
  }, [socket, encounterId, participants]);

  const isInitialLoading = pageQuery.isLoading && offset === 0 && historyActions.length === 0;
  const isEmpty = !isInitialLoading && liveActions.length === 0 && historyActions.length === 0 && expiryNotices.length === 0;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-stone-500">{t('encounters.combatLog.title')}</h3>
      {isInitialLoading && <Loading label={t('encounters.combatLog.loading')} />}
      {pageQuery.isError && <ErrorBanner message={errorMessage(pageQuery.error)} />}
      {isEmpty && <EmptyState message={t('encounters.combatLog.empty')} />}

      <ol className="space-y-1.5">
        {expiryNotices.map((notice) => (
          <li key={notice.key} className="rounded-md border border-amber-900/40 bg-amber-950/10 px-2.5 py-1.5 text-xs text-amber-300">
            {t('encounters.combatLog.effectExpired', { effect: notice.effectName, target: notice.targetName })}
          </li>
        ))}
        {liveActions.map((action) => (
          <CombatLogRow key={`live-${action.id}`} action={action} />
        ))}
        {historyActions.map((action) => (
          <CombatLogRow key={`hist-${action.id}`} action={action} />
        ))}
      </ol>

      {hasMore && historyActions.length > 0 && (
        <Button variant="ghost" size="sm" disabled={pageQuery.isFetching} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
          {pageQuery.isFetching ? t('encounters.combatLog.loading') : t('encounters.combatLog.loadMore')}
        </Button>
      )}
    </div>
  );
}

function CombatLogRow({ action }: { action: CombatActionWire }) {
  const { t } = useLocale();
  const verbKey = VERB_KEYS[action.actionType] ?? VERB_KEYS.other!;
  const targetNames = action.targets.map((tg) => tg.name).join(', ');
  const resultKey = RESULT_KEYS[action.resultKind];

  return (
    <li className="rounded-md border border-stone-800 bg-stone-900 px-2.5 py-1.5 text-xs text-stone-300">
      <span className="font-medium text-stone-100">{action.actorName}</span> {t(verbKey)}
      {targetNames && <span className="font-medium text-stone-100"> {targetNames}</span>}
      {action.meansName && t('encounters.combatLog.withMeans', { means: action.meansName })}
      {action.diceRollTotal != null &&
        resultKey &&
        t('encounters.combatLog.rollResult', { roll: action.diceRollTotal, result: t(resultKey) })}
      {action.damageAmount != null
        ? t('encounters.combatLog.damageLine', {
            amount: action.damageAmount,
            type: action.damageTypeName ? ` ${action.damageTypeName}` : '',
          })
        : action.effectDescription && t('encounters.combatLog.effectLine', { effect: action.effectDescription })}
    </li>
  );
}
