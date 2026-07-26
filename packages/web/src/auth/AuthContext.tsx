import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Membership, UiTheme, User } from '../lib/types';
import { getSocket } from '../lib/socket';

interface MeResponse {
  user: User;
  memberships: Membership[];
}

interface AuthContextValue {
  user: User | null;
  memberships: Membership[];
  isLoading: boolean;
  isAuthenticated: boolean;
  roleForCampaign: (campaignId: number) => 'dm' | 'player' | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, displayName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loginError: string | null;
  registerError: string | null;
  setTheme: (theme: UiTheme) => void;
  themePending: boolean;
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

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      memberships: meQuery.data?.memberships ?? [],
      isLoading: meQuery.isLoading,
      isAuthenticated: !!meQuery.data?.user,
      roleForCampaign: (campaignId: number) =>
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
    }),
    [meQuery.data, meQuery.isLoading, loginMutation, registerMutation, logoutMutation, themeMutation],
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
