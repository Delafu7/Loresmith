import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface BreadcrumbSegment {
  label: string;
  /** Omit on the trailing (current) segment — it renders as plain text, not a link. */
  to?: string;
}

interface BreadcrumbContextValue {
  register: (depth: number, segments: BreadcrumbSegment[]) => void;
  unregister: (depth: number) => void;
  segments: BreadcrumbSegment[];
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

/*
 * Breadcrumb trail (nav point 7: "Home › Campaign › Session › Encounter,
 * with every level navigable"). Pages register their own segment(s) at a
 * fixed `depth` via `useBreadcrumb` rather than the trail being derived from
 * the route config, since several levels need fetched data (campaign name,
 * character name, active encounter name) that only the page component has.
 * Depth-keyed (not registration-order-keyed) so a parent layout
 * (CampaignShell) and a nested detail page (CharacterSheetPage) can each own
 * a fixed slot in the trail regardless of React's child-before-parent effect
 * cleanup order.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [byDepth, setByDepth] = useState<Record<number, BreadcrumbSegment[]>>({});

  const value = useMemo<BreadcrumbContextValue>(
    () => ({
      register: (depth, segments) => setByDepth((prev) => ({ ...prev, [depth]: segments })),
      unregister: (depth) =>
        setByDepth((prev) => {
          if (!(depth in prev)) return prev;
          const next = { ...prev };
          delete next[depth];
          return next;
        }),
      segments: Object.keys(byDepth)
        .map(Number)
        .sort((a, b) => a - b)
        .flatMap((depth) => byDepth[depth] ?? []),
    }),
    [byDepth],
  );

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

function useBreadcrumbContext(): BreadcrumbContextValue {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) throw new Error('useBreadcrumb must be used within BreadcrumbProvider (see AppLayout)');
  return ctx;
}

export function useBreadcrumbTrail(): BreadcrumbSegment[] {
  return useBreadcrumbContext().segments;
}

/** Registers this page's breadcrumb segment(s) at `depth` for as long as it stays mounted. */
export function useBreadcrumb(depth: number, segments: BreadcrumbSegment[]): void {
  const { register, unregister } = useBreadcrumbContext();
  const depKey = segments.map((s) => `${s.label}|${s.to ?? ''}`).join('>>');

  useEffect(() => {
    register(depth, segments);
    return () => unregister(depth);
    // depKey captures every value segments depends on; segments itself is a
    // fresh array each render and would otherwise re-register every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth, depKey]);
}
