// Opening transition (REFACTOR-PLAN.md §8) — the app name, shown briefly
// before the login screen. Short (~1.1s), skippable on any click/keypress,
// and genuinely inert (no timer, no animation at all) under
// prefers-reduced-motion rather than just a faster version of the same
// animation — index.css's global reduced-motion rule already zeroes CSS
// transition/animation durations, but the JS-driven auto-advance timer needs
// its own check since that's not something a CSS media query can reach.

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/LocaleContext';

const INTRO_DURATION_MS = 1100;

export function LandingPage() {
  const { t } = useLocale();
  const { isAuthenticated, isLoading } = useAuth();
  const [skipped, setSkipped] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (skipped) return;
    const timer = window.setTimeout(() => setSkipped(true), INTRO_DURATION_MS);
    function advance() {
      setSkipped(true);
    }
    window.addEventListener('pointerdown', advance);
    window.addEventListener('keydown', advance);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', advance);
      window.removeEventListener('keydown', advance);
    };
  }, [skipped]);

  if (skipped) {
    if (isLoading) return null;
    return <Navigate to={isAuthenticated ? '/home' : '/login'} replace />;
  }

  return (
    <div
      className="min-h-dvh flex items-center justify-center bg-stone-950 text-stone-100 cursor-pointer px-6"
      style={{ background: 'radial-gradient(120% 100% at 15% 0%, var(--color-stone-800) 0%, var(--color-stone-950) 55%)' }}
    >
      <div className="text-center animate-[fadeIn_0.9s_ease-out] motion-reduce:animate-none">
        <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-wide text-amber-500">Loresmith</h1>
        <p className="mt-3 text-xs sm:text-sm uppercase tracking-[0.3em] text-stone-500">{t('landing.tagline')}</p>
      </div>
      <span className="sr-only">{t('landing.skipHint')}</span>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
