// Pure client-side mirror of services/encounters.ts's computeValidatedMoveCost
// decision tree (mode/status/turn — never budget, that's server-computed and
// never re-derived here, same discipline BattleMap.tsx's own header comment
// already documents for movement cost). Used only to enable/disable drag and
// the tap-to-move target layer — the server remains the sole source of
// truth and re-validates every move regardless of what this returns.
import type { EncounterMode, EncounterStatus } from '../lib/types';

export function canMoveToken(
  encounter: { mode: EncounterMode; status: EncounterStatus; currentTurnIndex: number },
  participant: { turnOrder: number },
  isOwnToken: boolean,
  isDm: boolean,
): boolean {
  if (isDm) return true;
  if (!isOwnToken) return false;
  if (encounter.mode === 'exploration') return true;
  if (encounter.status !== 'active') return true;
  return participant.turnOrder === encounter.currentTurnIndex;
}
