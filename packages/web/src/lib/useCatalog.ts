import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type {
  AbilityScoreCatalog,
  BackgroundCatalog,
  ClassCatalog,
  DamageTypeCatalog,
  EffectDefinitionCatalog,
  ItemCatalogEntry,
  RaceCatalog,
  SkillCatalog,
  SpellCatalogEntry,
  SubclassCatalog,
} from './types';

// Read-only reference data (PLAN.md §4.1: no write endpoints, seeded by
// migration/admin tooling). Cached aggressively — this data almost never
// changes within a session.

export function useAbilityScoresCatalog() {
  return useQuery({
    queryKey: ['catalog', 'ability-scores'],
    queryFn: () => api.get<{ abilityScores: AbilityScoreCatalog[] }>('/catalog/ability-scores'),
    staleTime: Infinity,
  });
}

export function useSkillsCatalog() {
  return useQuery({
    queryKey: ['catalog', 'skills'],
    queryFn: () => api.get<{ skills: SkillCatalog[] }>('/catalog/skills'),
    staleTime: Infinity,
  });
}

export function useDamageTypesCatalog() {
  return useQuery({
    queryKey: ['catalog', 'damage-types'],
    queryFn: () => api.get<{ damageTypes: DamageTypeCatalog[] }>('/catalog/damage-types'),
    staleTime: Infinity,
  });
}

export function useRacesCatalog(edition: '2014' | '2024' | 'both') {
  return useQuery({
    queryKey: ['catalog', 'races', edition],
    queryFn: () => api.get<{ races: RaceCatalog[] }>(`/catalog/races?edition=${edition}`),
    staleTime: Infinity,
  });
}

export function useBackgroundsCatalog(edition: '2014' | '2024' | 'both') {
  return useQuery({
    queryKey: ['catalog', 'backgrounds', edition],
    queryFn: () => api.get<{ backgrounds: BackgroundCatalog[] }>(`/catalog/backgrounds?edition=${edition}`),
    staleTime: Infinity,
  });
}

export function useClassesCatalog(edition: '2014' | '2024' | 'both') {
  return useQuery({
    queryKey: ['catalog', 'classes', edition],
    queryFn: () => api.get<{ classes: ClassCatalog[] }>(`/catalog/classes?edition=${edition}`),
    staleTime: Infinity,
  });
}

export function useSubclassesCatalog(edition: '2014' | '2024' | 'both') {
  return useQuery({
    queryKey: ['catalog', 'subclasses', edition],
    queryFn: () => api.get<{ subclasses: SubclassCatalog[] }>(`/catalog/subclasses?edition=${edition}`),
    staleTime: Infinity,
  });
}

export function useSpellsCatalog(edition: '2014' | '2024' | 'both') {
  return useQuery({
    queryKey: ['catalog', 'spells', edition],
    queryFn: () => api.get<{ spells: SpellCatalogEntry[] }>(`/catalog/spells?edition=${edition}`),
    staleTime: Infinity,
  });
}

export function useItemsCatalog(edition: '2014' | '2024' | 'both') {
  return useQuery({
    queryKey: ['catalog', 'items', edition],
    queryFn: () => api.get<{ items: ItemCatalogEntry[] }>(`/catalog/items?edition=${edition}`),
    staleTime: Infinity,
  });
}

export function useEffectDefinitionsCatalog(campaignId: number) {
  return useQuery({
    queryKey: ['catalog', 'effect-definitions', campaignId],
    queryFn: () =>
      api.get<{ effectDefinitions: EffectDefinitionCatalog[] }>(`/catalog/effect-definitions?campaignId=${campaignId}`),
    staleTime: Infinity,
  });
}
