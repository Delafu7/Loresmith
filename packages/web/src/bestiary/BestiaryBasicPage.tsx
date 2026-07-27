import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { MonsterCatalogEntry } from '../lib/types';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Portrait } from '../components/Portrait';
import { Input, Select } from '../components/ui/Field';
import { formatCrLabel } from './formatCr';

export function BestiaryBasicPage() {
  const [search, setSearch] = useState('');
  const [creatureType, setCreatureType] = useState('');
  const [crMin, setCrMin] = useState('');
  const [crMax, setCrMax] = useState('');

  const params = new URLSearchParams({ edition: 'both' });
  if (creatureType) params.set('creatureType', creatureType);
  if (crMin) params.set('crMin', crMin);
  if (crMax) params.set('crMax', crMax);

  const monstersQuery = useQuery({
    queryKey: ['catalog', 'monsters', 'basic', creatureType, crMin, crMax],
    queryFn: () => api.get<{ monsters: MonsterCatalogEntry[] }>(`/catalog/monsters?${params.toString()}`),
  });

  const creatureTypes = useMemo(
    () => [...new Set(monstersQuery.data?.monsters.map((m) => m.creature_type) ?? [])].sort(),
    [monstersQuery.data],
  );

  const filtered = (monstersQuery.data?.monsters ?? []).filter(
    (m) => !search || m.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Input
          type="search"
          placeholder="Search creatures…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2 sm:w-48"
        />
        <Select value={creatureType} onChange={(e) => setCreatureType(e.target.value)} className="sm:w-40">
          <option value="">All types</option>
          {creatureTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          placeholder="CR min"
          value={crMin}
          onChange={(e) => setCrMin(e.target.value)}
          className="sm:w-24"
        />
        <Input
          type="number"
          placeholder="CR max"
          value={crMax}
          onChange={(e) => setCrMax(e.target.value)}
          className="sm:w-24"
        />
      </div>

      {monstersQuery.isLoading && <Loading />}
      {monstersQuery.isError && <ErrorBanner message={errorMessage(monstersQuery.error)} />}
      {filtered.length === 0 && !monstersQuery.isLoading && <EmptyState message="No creatures match this filter." />}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
        {filtered.map((m) => (
          <Link
            key={m.id}
            to={`/creature/${m.id}`}
            className="rounded-md bg-stone-900 shadow-sm hover:bg-stone-800/70 transition-colors overflow-hidden group"
          >
            <div className="aspect-square bg-stone-950 flex items-center justify-center">
              <Portrait fileUrl={m.image_url} alt={m.name} size="xl" placeholderLabel={m.name} />
            </div>
            <div className="p-3">
              <p className="font-medium text-stone-100 truncate group-hover:text-amber-400">{m.name}</p>
              <p className="text-xs text-stone-500">
                CR {formatCrLabel(m.challenge_rating)} · {m.creature_type}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
