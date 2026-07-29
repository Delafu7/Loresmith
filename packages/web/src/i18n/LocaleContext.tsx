import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { Locale } from '../lib/types';
import { en } from './dictionaries/en/index.js';
import { es } from './dictionaries/es/index.js';
import { fr } from './dictionaries/fr/index.js';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'es', 'fr'];

const STORAGE_KEY = 'locale';
const DICTIONARIES: Record<Locale, typeof en> = { en, es, fr };

// Every dot-joined path through the (leaf-string) dictionary shape, e.g.
// 'login.title' | 'dashboard.welcome' | ... — gives t() compile-time
// checking against typos/renames instead of a plain `string` key.
type DotPaths<T, Prefix extends string = ''> = T extends string
  ? Prefix
  : { [K in keyof T & string]: DotPaths<T[K], Prefix extends '' ? K : `${Prefix}.${K}`> }[keyof T & string];

export type TranslationKey = DotPaths<typeof en>;

function getPath(dict: object, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), dict);
  return typeof value === 'string' ? value : undefined;
}

function detectBrowserLocale(): Locale {
  const lang = navigator.language.slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as string[]).includes(lang) ? (lang as Locale) : 'en';
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  localePending: boolean;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Interface language (i18n first pass — see en.ts for exact scope). Source
 * of truth: the signed-in user's saved `locale` (persisted server-side,
 * same pattern as ui_theme) once authenticated; a logged-out visitor
 * (login/register) gets a locale guessed from the browser, remembered in
 * localStorage across the auth flow so a choice made pre-login survives the
 * redirect into /home. Must render inside AuthProvider — it reads the
 * current user via useAuth() to decide which of those two sources applies.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, setLocale: persistUserLocale, localePending } = useAuth();

  const [guestLocale, setGuestLocale] = useState<Locale>(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) return stored as Locale;
    return detectBrowserLocale();
  });

  const locale: Locale = isAuthenticated && user ? user.locale : guestLocale;

  const setLocale = useCallback(
    (next: Locale) => {
      if (isAuthenticated) {
        persistUserLocale(next);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
        setGuestLocale(next);
      }
    },
    [isAuthenticated, persistUserLocale],
  );

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const template = getPath(DICTIONARIES[locale], key) ?? getPath(en, key) ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''));
    },
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, localePending: isAuthenticated && localePending, t }),
    [locale, setLocale, isAuthenticated, localePending, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
