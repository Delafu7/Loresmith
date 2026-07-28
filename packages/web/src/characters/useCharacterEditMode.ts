import type { Character, CampaignRole } from '../lib/types';

export type CharacterEditMode = 'read' | 'edit-full' | 'edit-own';

// Resolves once per character-sheet render, rather than scattering
// ownership checks per field (PLAN.md §6.2). The DM can edit anything in
// their campaign; a player can edit only a PC they own; everyone else reads.
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
