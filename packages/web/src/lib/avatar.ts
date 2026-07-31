// Deterministic per-entity avatar tint — the same id always gets the same
// color across a session/reload, cycling through the app's existing
// amber/stone theme slots (design-tokens.md: "amber-500/600/700 = avatar
// fill variety") rather than inventing new hardcoded hex colors, so it still
// repaints correctly under every theme (ember/crimson/amber) and dark mode
// alike. Shared by DashboardPage's character cards and the app header's user
// menu avatar (components/layout/UserMenu.tsx).
export const AVATAR_COLORS = ['bg-amber-600', 'bg-amber-500', 'bg-amber-700', 'bg-stone-600', 'bg-stone-500'];

export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase();
}
