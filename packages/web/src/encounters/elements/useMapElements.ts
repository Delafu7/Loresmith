// CRUD mutations for map elements. No optimistic/onSuccess cache writes, on
// purpose — MAP_ELEMENTS_CHANGED arriving over the socket (useEncounterLive)
// is the single source of truth, same discipline as BattleMap.tsx's
// positionMutation/ParticipantSheetPanel's faction mutation.
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { DoorActionResult, GmVisibility, MapElementType } from '../../lib/types';

export interface CreateMapElementBody {
  type: MapElementType;
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  points?: { x: number; y: number }[];
  props: Record<string, unknown>;
  label?: string | null;
  visibility?: GmVisibility;
  ownerUserId?: string | null;
  locked?: boolean;
  zIndex?: number;
}

export interface UpdateMapElementBody {
  x1?: number;
  y1?: number;
  x2?: number | null;
  y2?: number | null;
  points?: { x: number; y: number }[] | null;
  props?: Record<string, unknown>;
  label?: string | null;
  visibility?: GmVisibility;
  ownerUserId?: string | null;
  locked?: boolean;
  zIndex?: number;
}

export function useCreateMapElement(encounterId: string) {
  return useMutation({
    mutationFn: (body: CreateMapElementBody) => api.post(`/encounters/${encounterId}/map/elements`, body),
  });
}

export function useUpdateMapElement(encounterId: string) {
  return useMutation({
    mutationFn: ({ elementId, patch }: { elementId: string; patch: UpdateMapElementBody }) =>
      api.patch(`/encounters/${encounterId}/map/elements/${elementId}`, patch),
  });
}

export function useDeleteMapElement(encounterId: string) {
  return useMutation({
    mutationFn: (elementId: string) => api.delete(`/encounters/${encounterId}/map/elements/${elementId}`),
  });
}

// Player-facing door interaction (open/close/force) — a genuinely different
// authorization/mutation surface from the CRUD hooks above (which stay
// DM-only server-side): the acting participant is the caller, not the DM,
// so this is scoped by participantId rather than just elementId. Same "no
// local cache write" discipline — MAP_ELEMENTS_CHANGED over the socket
// updates the door everywhere, this response is only for the immediate
// roll/success/message feedback the acting player sees.
export function useDoorAction(encounterId: string) {
  return useMutation({
    mutationFn: ({ participantId, elementId, action }: { participantId: string; elementId: string; action: 'open' | 'close' | 'force' }) =>
      api.post<DoorActionResult>(`/encounters/${encounterId}/participants/${participantId}/doors/${elementId}`, { action }),
  });
}

// GM-only visibility layer — bulk reveal/hide for BattleMap.tsx's
// multi-select toolbar.
export function useSetMapElementsVisibilityBatch(encounterId: string) {
  return useMutation({
    mutationFn: (body: { elementIds: string[]; visibility: GmVisibility; ownerUserId?: string | null }) =>
      api.patch(`/encounters/${encounterId}/map/elements/visibility/batch`, body),
  });
}
