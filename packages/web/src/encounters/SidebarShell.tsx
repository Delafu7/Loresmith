// Collapse chrome for the VTT roster sidebar (PartyStatsSidebar), reused by
// both MapSectionPage.tsx and SessionScreen.tsx so the sidebar is present by
// default on every screen that shows the battle map, not just MapSectionPage
// — collapsing is an explicit user action (this toggle button) whose choice
// persists via lib/liveMapState.ts's isSidebarCollapsed/setSidebarCollapsed,
// same fail-open-on-storage-error localStorage pattern the live-map
// minimize/restore flow already uses. Static Tailwind width classes (not an
// interpolated `w-[${px}px]`) so the class scanner can see both — see
// factionStyle.ts's header comment for the same constraint.
import { useState, type ReactNode } from 'react';
import { isSidebarCollapsed, setSidebarCollapsed } from '../lib/liveMapState';
import { useLocale } from '../i18n/LocaleContext';

export function SidebarShell({ children }: { children: ReactNode }) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(isSidebarCollapsed);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      setSidebarCollapsed(next);
      return next;
    });
  }

  return (
    <div className={`flex min-h-0 flex-shrink-0 flex-col gap-2 ${collapsed ? 'w-9' : 'w-[280px]'}`}>
      <button
        type="button"
        onClick={toggle}
        title={t(collapsed ? 'encounters.sidebar.expand' : 'encounters.sidebar.collapse')}
        aria-label={t(collapsed ? 'encounters.sidebar.expand' : 'encounters.sidebar.collapse')}
        aria-expanded={!collapsed}
        className="flex-shrink-0 min-h-9 rounded-md bg-stone-900 shadow-sm px-2 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-200"
      >
        {collapsed ? '☰' : t('encounters.sidebar.collapseLabel')}
      </button>
      {!collapsed && <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">{children}</div>}
    </div>
  );
}
