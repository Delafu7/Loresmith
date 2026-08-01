import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign } from '../lib/types';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';
import { useBreadcrumb } from '../components/layout/BreadcrumbContext';

// Phase 4: JSON campaign import — always creates a brand-new campaign owned
// by the current user (services/campaignImport.ts never overwrites/merges
// into an existing one), so it lives right next to "New campaign" as an
// alternative way to populate one, not as a per-campaign settings action.
function ImportCampaignButton({ onImported }: { onImported: (campaignId: string) => void }) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<unknown>(null);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(t('campaigns.invalidJsonFile'));
      }
      return api.post<{ campaignId: string }>('/campaigns/import', data);
    },
    onSuccess: (data) => onImported(data.campaignId),
    onError: (err) => setError(err),
  });

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-choosing the same file after an error
    if (!file) return;
    setError(null);
    importMutation.mutate(file);
  }

  return (
    <div>
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChosen} className="hidden" />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={importMutation.isPending}
        className="rounded-md border border-stone-700 text-stone-300 hover:bg-stone-800 active:bg-stone-800/70 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-4 py-2 text-sm"
      >
        {importMutation.isPending ? t('campaigns.importing') : t('campaigns.importButton')}
      </button>
      {error !== null && <ErrorBanner message={errorMessage(error)} />}
    </div>
  );
}

export function CampaignListPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  useBreadcrumb(1, [{ label: t('campaigns.title') }]);

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
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="text-lg font-medium">{t('campaigns.yourCampaigns')}</h2>
          <div className="flex items-center gap-2">
            <ImportCampaignButton
              onImported={(campaignId) => {
                void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
                navigate(`/campaigns/${campaignId}`);
              }}
            />
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-4 py-2 text-sm"
            >
              {showCreate ? t('campaigns.cancel') : t('campaigns.newCampaign')}
            </button>
          </div>
        </div>

        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="mb-6 bg-stone-900 border border-stone-800 rounded-lg p-5 space-y-4"
          >
            <div>
              <label htmlFor="campaignName" className="block text-sm font-medium text-stone-300 mb-1">
                {t('campaigns.nameLabel')}
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
                {t('campaigns.editionLabel')}
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
                {t('campaigns.descriptionLabel')}
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
              className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-4 py-2 text-sm"
            >
              {createMutation.isPending ? t('campaigns.creating') : t('campaigns.createButton')}
            </button>
          </form>
        )}

        {campaignsQuery.isLoading && <Loading />}
        {campaignsQuery.isError && <ErrorBanner message={errorMessage(campaignsQuery.error)} />}
        {campaignsQuery.data && campaignsQuery.data.campaigns.length === 0 && (
          <EmptyState message={t('campaigns.noCampaigns')} />
        )}

        <ul className="space-y-2">
          {campaignsQuery.data?.campaigns.map((c) => (
            <li key={c.id}>
              <Link
                to={`/campaigns/${c.id}`}
                className="block rounded-md bg-stone-900 shadow-sm hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-stone-100">{c.name}</span>
                  <span className="text-xs uppercase tracking-wide text-stone-500">
                    {t('campaigns.srdLine', { role: c.my_role ?? '', edition: c.srd_edition })}
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
