import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign, Character, CampaignMember } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { abilityModifier, formatModifier } from '../lib/dnd-math';
import { AbilityScoreGenerator } from './AbilityScoreGenerator';

export function CharactersListPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });

  const membersQuery = useQuery({
    queryKey: ['campaignMembers', campaignId],
    queryFn: () => api.get<{ members: CampaignMember[] }>(`/campaigns/${campaignId}/members`),
    enabled: role === 'dm',
  });

  const [form, setForm] = useState({
    name: '',
    isPc: role === 'player' ? true : true,
    ownerUserId: '',
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
    armorClass: 10,
    hpMax: 10,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ character: Character }>(`/campaigns/${campaignId}/characters`, {
        name: form.name,
        isPc: role === 'player' ? true : form.isPc,
        ownerUserId:
          role === 'player'
            ? user!.id
            : form.isPc
              ? form.ownerUserId || undefined
              : undefined,
        str: form.str,
        dex: form.dex,
        con: form.con,
        int: form.int,
        wis: form.wis,
        cha: form.cha,
        armorClass: form.armorClass,
        hpMax: form.hpMax,
      }),
    onSuccess: () => {
      setShowCreate(false);
      setForm((f) => ({ ...f, name: '' }));
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] });
    },
  });

  const allowRerollMutation = useMutation({
    mutationFn: (allowAbilityReroll: boolean) =>
      api.patch<{ campaign: Campaign }>(`/campaigns/${campaignId}`, { allowAbilityReroll }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
  });

  const players = membersQuery.data?.members.filter((m) => m.role === 'player') ?? [];
  const pcs = charactersQuery.data?.characters.filter((c) => c.is_pc) ?? [];
  const npcs = charactersQuery.data?.characters.filter((c) => !c.is_pc) ?? [];

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Characters</h2>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-4 py-2 text-sm"
        >
          {showCreate ? 'Cancel' : role === 'dm' ? 'New character' : 'Create my PC'}
        </button>
      </div>

      {role === 'dm' && (
        <label className="flex items-center gap-2 text-xs text-stone-400 mb-4">
          <input
            type="checkbox"
            checked={campaign.allow_ability_reroll}
            disabled={allowRerollMutation.isPending}
            onChange={(e) => allowRerollMutation.mutate(e.target.checked)}
          />
          Allow players to reroll ability scores
        </label>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 bg-stone-900 border border-stone-800 rounded-lg p-5 space-y-4">
          <div>
            <label htmlFor="charName" className="block text-sm font-medium text-stone-300 mb-1">
              Name
            </label>
            <input
              id="charName"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {role === 'dm' && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-stone-300">
                <input
                  type="radio"
                  checked={form.isPc}
                  onChange={() => setForm((f) => ({ ...f, isPc: true }))}
                />
                Player character
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-300">
                <input
                  type="radio"
                  checked={!form.isPc}
                  onChange={() => setForm((f) => ({ ...f, isPc: false }))}
                />
                NPC
              </label>
            </div>
          )}

          {role === 'dm' && form.isPc && (
            <div>
              <label htmlFor="owner" className="block text-sm font-medium text-stone-300 mb-1">
                Owning player
              </label>
              <select
                id="owner"
                required
                value={form.ownerUserId}
                onChange={(e) => setForm((f) => ({ ...f, ownerUserId: e.target.value }))}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100"
              >
                <option value="">Select a player…</option>
                {players.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.display_name} ({p.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          <AbilityScoreGenerator
            campaignId={campaignId}
            allowReroll={campaign.allow_ability_reroll}
            onApply={(scores) => setForm((f) => ({ ...f, ...scores }))}
          />

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((key) => (
              <div key={key}>
                <label htmlFor={key} className="block text-xs font-medium text-stone-400 mb-1 uppercase">
                  {key}
                </label>
                <input
                  id={key}
                  type="number"
                  min={1}
                  max={30}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }))}
                  className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100 text-center"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ac" className="block text-sm font-medium text-stone-300 mb-1">
                Armor Class
              </label>
              <input
                id="ac"
                type="number"
                min={0}
                value={form.armorClass}
                onChange={(e) => setForm((f) => ({ ...f, armorClass: Number(e.target.value) }))}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100"
              />
            </div>
            <div>
              <label htmlFor="hpMax" className="block text-sm font-medium text-stone-300 mb-1">
                Max HP
              </label>
              <input
                id="hpMax"
                type="number"
                min={1}
                value={form.hpMax}
                onChange={(e) => setForm((f) => ({ ...f, hpMax: Number(e.target.value) }))}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100"
              />
            </div>
          </div>

          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-4 py-2 text-sm"
          >
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {charactersQuery.isLoading && <Loading />}
      {charactersQuery.isError && <ErrorBanner message={errorMessage(charactersQuery.error)} />}

      <section className="mb-8">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-2">Player characters</h3>
        {pcs.length === 0 && <EmptyState message="No player characters yet." />}
        <ul className="grid sm:grid-cols-2 gap-3">
          {pcs.map((c) => (
            <CharacterCard key={c.id} character={c} campaignId={campaignId} />
          ))}
        </ul>
      </section>

      {role === 'dm' && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-2">NPCs</h3>
          {npcs.length === 0 && <EmptyState message="No NPCs yet." />}
          <ul className="grid sm:grid-cols-2 gap-3">
            {npcs.map((c) => (
              <CharacterCard key={c.id} character={c} campaignId={campaignId} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CharacterCard({ character, campaignId }: { character: Character; campaignId: string }) {
  return (
    <li>
      <Link
        to={`/campaigns/${campaignId}/characters/${character.id}`}
        className="block rounded-md bg-stone-900 shadow-sm hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-4 py-3"
      >
        <div className="flex items-center justify-between">
          <span className="font-medium text-stone-100">{character.name}</span>
          {!character.is_alive && <span className="text-xs text-red-400 font-semibold">DECEASED</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-stone-400 mt-1">
          <span>
            HP {character.hp_current}/{character.hp_max}
          </span>
          <span>AC {character.armor_class}</span>
          <span>DEX {formatModifier(abilityModifier(character.dex))}</span>
        </div>
      </Link>
    </li>
  );
}
