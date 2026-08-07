import type { Character, CampaignRole } from '../lib/types';

export type CharacterEditMode = 'read' | 'edit-full' | 'edit-own';

// Resolves once per character-sheet render, rather than scattering
// ownership checks per field (PLAN.md §6.2). The DM can edit anything in
// their campaign; a player can edit only a PC they own; everyone else reads.
// This is the OWNERSHIP gate — it governs sheet-editing (ability scores,
// classes, skills/saves proficiency, spell learn/unlearn, inventory
// add/remove, attacks). See useCharacterCanAct below for the separate
// CONTROL gate.
export function useCharacterEditMode(
  character: Character | undefined,
  role: CampaignRole | null,
  userId: string | undefined,
): CharacterEditMode {
  if (!character || !role || userId === undefined) return 'read';
  if (role === 'dm') return 'edit-full';
  if (character.is_pc && character.owner_user_id === userId) return 'edit-own';
  return 'read';
}

// Iteration 3 blocker fix — "Character ownership vs. control" (shipped
// server-side in Iteration 2) had no frontend counterpart: a player who's
// been delegated control of a PC they don't own got a fully read-only sheet,
// because every "can I act" gate on this page reused useCharacterEditMode
// (ownership-only) instead of asking "am I the current controller." Mirrors
// the server's own authorizeCharacterAction/requireControllerOrDm split
// (services/characters.ts) exactly: controller_user_id, when set, is
// authoritative; NULL defers to owner_user_id. Governs "act right now"
// controls only — HP adjustment, resource-pool/spell-slot spend & recover,
// and the dice-roll trigger next to skills/saves. Never grants sheet-edit
// rights (delegating control never delegates ownership).
export function useCharacterCanAct(
  character: Character | undefined,
  role: CampaignRole | null,
  userId: string | undefined,
): boolean {
  if (!character || !role || userId === undefined) return false;
  if (role === 'dm') return true;
  if (!character.is_pc) return false;
  const effectiveController = character.controller_user_id ?? character.owner_user_id;
  return effectiveController === userId;
}
