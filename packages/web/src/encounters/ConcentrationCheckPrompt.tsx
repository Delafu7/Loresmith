import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ConcentrationCheckPromptedEvent } from '../lib/socketTypes';
import { useSocket } from '../lib/SocketContext';
import { useLocale } from '../i18n/LocaleContext';

interface Prompt extends ConcentrationCheckPromptedEvent {
  key: string;
}

/**
 * Phase 2 "concentration-broken save prompt" — server targets this event at
 * exactly the DM and the concentrating character's controller (see
 * sockets/broadcast.ts's broadcastConcentrationCheckPrompted), so any socket
 * that receives one is meant to see it; no further client-side filtering.
 * Deliberately does NOT roll the save itself — the DC is shown here, but the
 * actual Constitution save is whatever CON row the character's own Saving
 * Throws panel already rolls (correct modifier, proficiency, hidden-roll
 * option and all — duplicating that math here would be a second, easier-to-
 * drift copy of it). "Resolve this save" is DM-only "remove the effect" (it
 * failed) or a plain dismiss (passed, or just clearing the banner) —
 * removing reuses the existing DELETE /effects/:id (services/effects.ts's
 * removeEffect, already DM-only), so no new mutation exists purely for this.
 */
export function ConcentrationCheckPrompt({ encounterId, isDm }: { encounterId: string; isDm: boolean }) {
  const { t } = useLocale();
  const { socket } = useSocket();
  const [prompts, setPrompts] = useState<Prompt[]>([]);

  useEffect(() => {
    function onPrompt(payload: ConcentrationCheckPromptedEvent) {
      if (payload.encounterId !== encounterId) return;
      setPrompts((prev) => [...prev, { ...payload, key: `${payload.effectId}-${payload.serverTimestamp}` }]);
    }
    socket.on('CONCENTRATION_CHECK_PROMPTED', onPrompt);
    return () => {
      socket.off('CONCENTRATION_CHECK_PROMPTED', onPrompt);
    };
  }, [socket, encounterId]);

  const removeEffectMutation = useMutation({
    mutationFn: (effectId: string) => api.delete(`/effects/${effectId}`),
  });

  function dismiss(key: string) {
    setPrompts((prev) => prev.filter((p) => p.key !== key));
  }

  if (prompts.length === 0) return null;

  return (
    <div className="fixed top-14 left-1/2 z-50 w-[min(28rem,calc(100vw-1rem))] -translate-x-1/2 space-y-2">
      {prompts.map((p) => (
        <div key={p.key} className="rounded-md border border-amber-600 bg-stone-900 p-3 text-sm shadow-lg">
          <p className="font-semibold text-amber-400">{t('encounters.concentration.title')}</p>
          <p className="text-stone-300">{t('encounters.concentration.body', { effect: p.effectName, dc: p.dc, damage: p.damage })}</p>
          <div className="mt-2 flex gap-2">
            {isDm && (
              <button
                type="button"
                disabled={removeEffectMutation.isPending}
                onClick={() => {
                  removeEffectMutation.mutate(p.effectId);
                  dismiss(p.key);
                }}
                className="rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-50 px-2 py-1 text-xs font-medium text-white"
              >
                {t('encounters.concentration.failed')}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(p.key)}
              className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
            >
              {t('encounters.concentration.dismiss')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
