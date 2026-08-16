// Phase 4 "DM approval before a player-submitted action resolves" — the
// DM's review queue: every request currently pending for this encounter,
// with an Approve/Reject pair per row. Approving replays the exact queued
// input server-side (services/pendingActions.ts's dispatch in
// routes/pendingActions.ts) — this component never re-derives or previews
// the outcome, it only shows what was submitted and lets the DM decide.
import { usePendingActions } from './usePendingActions';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';
import type { TranslationKey } from '../i18n/LocaleContext';
import type { PendingActionRequest, SnapshotParticipant } from '../lib/types';

const KIND_LABEL_KEY: Record<PendingActionRequest['kind'], TranslationKey> = {
  attack_character: 'encounters.pendingActions.kind.attack',
  attack_monster: 'encounters.pendingActions.kind.attack',
  cast: 'encounters.pendingActions.kind.cast',
  shove: 'encounters.pendingActions.kind.shove',
  grapple: 'encounters.pendingActions.kind.grapple',
};

export function PendingActionsQueue({ encounterId, participants }: { encounterId: string; participants: SnapshotParticipant[] }) {
  const { t } = useLocale();
  const { query, approveMutation, rejectMutation } = usePendingActions(encounterId);
  const pending = (query.data?.requests ?? []).filter((r) => r.status === 'pending');

  if (pending.length === 0) return null;

  const nameFor = (participantId: string) => participants.find((p) => p.participantId === participantId)?.name ?? participantId;

  return (
    <div className="rounded-md border border-amber-800/60 bg-amber-950/10 p-3 space-y-2">
      <h3 className="text-xs uppercase text-amber-500">{t('encounters.pendingActions.title', { count: pending.length })}</h3>
      <ul className="space-y-1.5">
        {pending.map((request) => (
          <li key={request.id} className="rounded-md border border-stone-800 bg-stone-900 p-2 text-xs space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-stone-200">
                <span className="font-medium">{nameFor(request.actor_participant_id)}</span>
                {' — '}
                <span className="text-stone-400">{t(KIND_LABEL_KEY[request.kind])}</span>
                {request.label && request.label !== 'Attack' && request.label !== 'Cast' && (
                  <span className="text-stone-500"> ({request.label})</span>
                )}
                {request.target_participant_ids.length > 0 && (
                  <span className="text-stone-500">
                    {' '}
                    → {request.target_participant_ids.map((id) => nameFor(id)).join(', ')}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                  onClick={() => approveMutation.mutate(request.id)}
                  className="rounded-md border border-emerald-700 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-950/70 disabled:opacity-40 px-2 py-1 font-semibold"
                >
                  {t('encounters.pendingActions.approve')}
                </button>
                <button
                  type="button"
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                  onClick={() => rejectMutation.mutate(request.id)}
                  className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-300 px-2 py-1"
                >
                  {t('encounters.pendingActions.reject')}
                </button>
              </div>
            </div>
            {request.error && <p className="text-red-400">{t('encounters.pendingActions.lastAttemptFailed', { error: request.error })}</p>}
          </li>
        ))}
      </ul>
      {approveMutation.isError && <ErrorBanner message={errorMessage(approveMutation.error)} />}
      {rejectMutation.isError && <ErrorBanner message={errorMessage(rejectMutation.error)} />}
    </div>
  );
}
