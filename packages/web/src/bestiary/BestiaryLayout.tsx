// Shared chrome for the global bestiary (REFACTOR-PLAN.md §1/§8): a
// top-level, cross-campaign entry point — distinct from the per-campaign
// "Bestiary" tab inside CampaignShell (kept as-is; that one manages a single
// campaign's homebrew + spawns instances into that campaign's encounters).
// This one is read/browse-first: Basic (global catalog) vs. Campaign-specific
// (homebrew, picked per campaign), each creature landing on its own
// `/creature/:id` sheet.

import { Link, NavLink, Outlet } from 'react-router-dom';

export function BestiaryLayout() {
  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <Link to="/home" className="text-xs text-stone-500 hover:text-stone-300">
            ← Home
          </Link>
          <h1 className="text-xl font-semibold">Bestiary</h1>
        </div>
        <nav className="flex gap-1">
          <BestiaryTab to="/bestiary/basic" label="Basic creatures" />
          <BestiaryTab to="/bestiary/campaign" label="Campaign-specific" />
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function BestiaryTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          isActive ? 'bg-amber-950 text-amber-400' : 'text-stone-300 hover:bg-stone-800'
        }`
      }
    >
      {label}
    </NavLink>
  );
}
