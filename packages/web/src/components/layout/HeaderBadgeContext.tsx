import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface HeaderBadgeContextValue {
  label: string | null;
  setLabel: (label: string | null) => void;
}

const HeaderBadgeContext = createContext<HeaderBadgeContextValue | null>(null);

/*
 * Right-aligned identity badge in AppHeader (e.g. "DM"/"PLAYER" while inside
 * a campaign) — a single slot, not depth-stacked like BreadcrumbContext,
 * since only one page-level "who am I here" indicator is ever shown at a
 * time. Kept out of the left sidebar (where it used to live, under the
 * campaign name) so every identity/account indicator — role, avatar, name —
 * consistently lives on the right, next to UserMenu.
 */
export function HeaderBadgeProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  return <HeaderBadgeContext.Provider value={{ label, setLabel }}>{children}</HeaderBadgeContext.Provider>;
}

function useHeaderBadgeContext(): HeaderBadgeContextValue {
  const ctx = useContext(HeaderBadgeContext);
  if (!ctx) throw new Error('useHeaderBadge must be used within HeaderBadgeProvider (see AppLayout)');
  return ctx;
}

export function useHeaderBadgeLabel(): string | null {
  return useHeaderBadgeContext().label;
}

/** Sets the header's right-side identity badge text for as long as the calling component stays mounted. */
export function useHeaderBadge(label: string | null): void {
  const { setLabel } = useHeaderBadgeContext();
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}
