// Operational backlog item "Offline rules/stat-block lookup" — registers
// the catalog-caching service worker (vite.config.ts's VitePWA plugin) and
// surfaces its two lifecycle events as toasts: "ready to browse the rules
// catalog offline" (first activation) and "a new version is available"
// (subsequent deploys). No other UI is warranted — this is a background
// capability, not a feature the user configures.
//
// `virtual:pwa-register/react` only exists when the app is actually built/
// served through Vite with the VitePWA plugin active — packages/web's
// vitest.config.ts is a separate, plugin-free config, so this module (and
// this component) is never imported by any test file, deliberately.

import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '../components/ui/Toast';
import { useLocale } from '../i18n/LocaleContext';

export function PwaUpdateNotifier() {
  const { t } = useLocale();
  const { showToast } = useToast();
  const announcedOfflineReady = useRef(false);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!offlineReady || announcedOfflineReady.current) return;
    announcedOfflineReady.current = true;
    showToast(t('pwa.offlineReady'));
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady, showToast, t]);

  useEffect(() => {
    if (!needRefresh) return;
    showToast(t('pwa.updateAvailable'), { label: t('pwa.reload'), onClick: () => void updateServiceWorker(true) });
    setNeedRefresh(false);
  }, [needRefresh, setNeedRefresh, showToast, t, updateServiceWorker]);

  return null;
}
