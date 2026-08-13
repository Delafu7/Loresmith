// CRUD mutations for map elements. No optimistic/onSuccess cache writes, on
// purpose — MAP_ELEMENTS_CHANGED arriving over the socket (useEncounterLive)
// is the single source of truth, same discipline as BattleMap.tsx's
// positionMutation/ParticipantSheetPanel's faction mutation.
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { GmVisibility, MapElementType } from '../../lib/types';

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

// GM-only visibility layer — bulk reveal/hide for BattleMap.tsx's
// multi-select toolbar.
export function useSetMapElementsVisibilityBatch(encounterId: string) {
  return useMutation({
    mutationFn: (body: { elementIds: string[]; visibility: GmVisibility; ownerUserId?: string | null }) =>
      api.patch(`/encounters/${encounterId}/map/elements/visibility/batch`, body),
  });
}
