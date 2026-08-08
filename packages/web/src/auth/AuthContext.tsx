import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignRole, Locale, Membership, TextSize, UiTheme, UnitSystem, User } from '../lib/types';
import { getSocket } from '../lib/socket';

export interface MeResponse {
  user: User;
  memberships: Membership[];
}

interface AuthContextValue {
  user: User | null;
  memberships: Membership[];
  isLoading: boolean;
  isAuthenticated: boolean;
  roleForCampaign: (campaignId: string) => CampaignRole | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loginError: string | null;
  registerError: string | null;
  setTheme: (theme: UiTheme) => void;
  themePending: boolean;
  setLocale: (locale: Locale) => void;
  localePending: boolean;
  setTextSize: (textSize: TextSize) => void;
  textSizePending: boolean;
  setUnitSystem: (unitSystem: UnitSystem) => void;
  unitSystemPending: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api.post<{ user: User }>('/auth/login', input),
    onSuccess: () => {
      const socket = getSocket();
      socket.disconnect();
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: (input: { email: string; displayName: string; password: string }) =>
      api.post<{ user: User }>('/auth/register', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSuccess: () => {
      const socket = getSocket();
      socket.disconnect();
      queryClient.clear();
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const themeMutation = useMutation({
    mutationFn: (uiTheme: UiTheme) => api.patch<{ user: User }>('/auth/me/theme', { uiTheme }),
    onSuccess: (data) => {
      queryClient.setQueryData<MeResponse>(['me'], (prev) => (prev ? { ...prev, user: data.user } : prev));
    },
  });

  const localeMutation = useMutation({
    mutationFn: (locale: Locale) => api.patch<{ user: User }>('/auth/me/locale', { locale }),
    onSuccess: (data) => {
      queryClient.setQueryData<MeResponse>(['me'], (prev) => (prev ? { ...prev, user: data.user } : prev));
    },
  });

  const textSizeMutation = useMutation({
    mutationFn: (textSize: TextSize) => api.patch<{ user: User }>('/auth/me/text-size', { textSize }),
    onSuccess: (data) => {
      queryClient.setQueryData<MeResponse>(['me'], (prev) => (prev ? { ...prev, user: data.user } : prev));
    },
  });

  const unitSystemMutation = useMutation({
    mutationFn: (unitSystem: UnitSystem) => api.patch<{ user: User }>('/auth/me/unit-system', { unitSystem }),
    onSuccess: (data) => {
      queryClient.setQueryData<MeResponse>(['me'], (prev) => (prev ? { ...prev, user: data.user } : prev));
    },
  });

  // Applied as soon as the logged-in user's theme is known (including right
  // after login/register/refresh) — every `amber-*`/`stone-*` Tailwind class
  // anywhere in the app re-colors via index.css's [data-theme] overrides, no
  // per-component change needed. Logged-out visitors (login/register pages)
  // get the default :root values (ember), matching "ember theme as default".
  useEffect(() => {
    if (meQuery.data?.user) {
      document.documentElement.dataset.theme = meQuery.data.user.uiTheme;
    }
  }, [meQuery.data?.user?.uiTheme]);

  // Same shape as the theme effect above — index.css's [data-text-size="large"]
  // scales the root font-size, so every existing rem-based Tailwind text-*
  // class scales with it, no per-component change needed.
  useEffect(() => {
    if (meQuery.data?.user) {
      document.documentElement.dataset.textSize = meQuery.data.user.textSize;
    }
  }, [meQuery.data?.user?.textSize]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      memberships: meQuery.data?.memberships ?? [],
      isLoading: meQuery.isLoading,
      isAuthenticated: !!meQuery.data?.user,
      roleForCampaign: (campaignId: string) =>
        meQuery.data?.memberships.find((m) => m.campaignId === campaignId)?.role ?? null,
      login: async (email, password) => {
        await loginMutation.mutateAsync({ email, password });
      },
      register: async (email, displayName, password) => {
        await registerMutation.mutateAsync({ email, displayName, password });
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
      loginError: loginMutation.error ? describeError(loginMutation.error) : null,
      registerError: registerMutation.error ? describeError(registerMutation.error) : null,
      setTheme: (theme: UiTheme) => themeMutation.mutate(theme),
      themePending: themeMutation.isPending,
      setLocale: (locale: Locale) => localeMutation.mutate(locale),
      localePending: localeMutation.isPending,
      setTextSize: (textSize: TextSize) => textSizeMutation.mutate(textSize),
      textSizePending: textSizeMutation.isPending,
      setUnitSystem: (unitSystem: UnitSystem) => unitSystemMutation.mutate(unitSystem),
      unitSystemPending: unitSystemMutation.isPending,
    }),
    [
      meQuery.data,
      meQuery.isLoading,
      loginMutation,
      registerMutation,
      logoutMutation,
      themeMutation,
      localeMutation,
      textSizeMutation,
      unitSystemMutation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
