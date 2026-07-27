import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';

export function CampaignListPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const campaignsQuery = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<{ campaigns: Campaign[] }>('/campaigns'),
  });

  const [name, setName] = useState('');
  const [srdEdition, setSrdEdition] = useState<'2014' | '2024'>('2024');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ campaign: Campaign }>('/campaigns', {
        name,
        srdEdition,
        description: description || undefined,
      }),
    onSuccess: () => {
      setName('');
      setDescription('');
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Campaigns</h1>
        <div className="flex items-center gap-4 text-sm text-stone-400">
          <span>{user?.displayName}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-stone-700 px-3 py-1.5 hover:bg-stone-800"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Your campaigns</h2>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold px-4 py-2 text-sm"
          >
            {showCreate ? 'Cancel' : 'New campaign'}
          </button>
        </div>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 bg-stone-900 border border-stone-800 rounded-lg p-5 space-y-4"
          >
            <div>
              <label htmlFor="campaignName" className="block text-sm font-medium text-stone-300 mb-1">
                Name
              </label>
              <input
                id="campaignName"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label htmlFor="edition" className="block text-sm font-medium text-stone-300 mb-1">
                SRD edition
              </label>
              <select
                id="edition"
                value={srdEdition}
                onChange={(e) => setSrdEdition(e.target.value as '2014' | '2024')}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100"
              >
                <option value="2024">2024</option>
                <option value="2014">2014</option>
              </select>
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-stone-300 mb-1">
                Description (optional)
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100"
              />
            </div>
            {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-stone-950 font-semibold px-4 py-2 text-sm"
            >
              {createMutation.isPending ? 'Creating…' : 'Create campaign'}
            </button>
          </form>
        )}

        {campaignsQuery.isLoading && <Loading />}
        {campaignsQuery.isError && <ErrorBanner message={errorMessage(campaignsQuery.error)} />}
        {campaignsQuery.data && campaignsQuery.data.campaigns.length === 0 && (
          <EmptyState message="No campaigns yet. Create one to get started." />
        )}

        <ul className="space-y-2">
          {campaignsQuery.data?.campaigns.map((c) => (
            <li key={c.id}>
              <Link
                to={`/campaigns/${c.id}/characters`}
                className="block rounded-lg border border-stone-800 bg-stone-900 hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-100">{c.name}</span>
                  <span className="text-xs uppercase tracking-wide text-stone-500">
                    {c.my_role} · SRD {c.srd_edition}
                  </span>
                </div>
                {c.description && <p className="text-stone-400 text-sm mt-1">{c.description}</p>}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
