import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCampaignShell } from './CampaignShell';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { Card, CardKicker } from '../components/ui/Card';
import { JournalTabs } from '../notes/JournalTabs';

interface ReferenceNotes {
  body: string;
  updated_at: string | null;
}

// Iteration 4 — one page, two halves. The GM-only notes half (rest rules,
// travel distances, anything crucial the DM wants at a glance) is a NEW,
// dedicated resource (see the migration's header comment for why this
// isn't a reuse of notes.ts or the removed hide/reveal engine); the coin
// table half is a static, edition-invariant reference every member sees.
export function CampaignReferencePage() {
  const { campaignId, role } = useCampaignShell();
  const { t } = useLocale();
  const isDm = role === 'dm';

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-4">
      <JournalTabs />
      <h2 className="text-lg font-semibold">{t('reference.title')}</h2>
      {isDm && <GmNotesSection campaignId={campaignId} />}
      <CoinValueTable />
    </div>
  );
}

function GmNotesSection({ campaignId }: { campaignId: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const queryKey = ['campaignReferenceNotes', campaignId];

  const notesQuery = useQuery({
    queryKey,
    queryFn: () => api.get<{ notes: ReferenceNotes }>(`/campaigns/${campaignId}/reference-notes`),
  });

  const [draft, setDraft] = useState('');
  // Same "don't clobber an in-progress edit" guard shape as
  // CharacterSheetPage.tsx's gmNotesDraft/editingGmNotes (Iteration 3
  // Increment 4's M9 fix) — a refetch triggered by anything else on this
  // page must never silently wipe an unsaved draft.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(notesQuery.data?.notes.body ?? '');
  }, [notesQuery.data?.notes.body, editing]);

  const saveMutation = useMutation({
    mutationFn: (body: string) => api.put<{ notes: ReferenceNotes }>(`/campaigns/${campaignId}/reference-notes`, { body }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  return (
    <Card>
      <CardKicker>{t('reference.gmNotesKicker')}</CardKicker>
      <p className="text-xs text-stone-500 mb-2">{t('reference.gmNotesHint')}</p>
      {notesQuery.isLoading && <Loading />}
      {notesQuery.isError && <ErrorBanner message={errorMessage(notesQuery.error)} />}
      {saveMutation.isError && <ErrorBanner message={errorMessage(saveMutation.error)} />}
      {notesQuery.data && (
        <textarea
          rows={8}
          value={draft}
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== (notesQuery.data?.notes.body ?? '')) saveMutation.mutate(draft);
          }}
          placeholder={t('reference.gmNotesPlaceholder')}
          className="w-full rounded-md bg-stone-800 border border-violet-900/60 px-3 py-2 text-stone-100 text-sm"
        />
      )}
    </Card>
  );
}

// Standard SRD exchange rates — unchanged between the 2014 and 2024
// editions, so edition-invariant and safe to render for every campaign
// without a srd_edition branch. Static, no fetch.
const COIN_ROWS: Array<{ key: 'cp' | 'sp' | 'ep' | 'gp' | 'pp'; cp: number }> = [
  { key: 'cp', cp: 1 },
  { key: 'sp', cp: 10 },
  { key: 'ep', cp: 50 },
  { key: 'gp', cp: 100 },
  { key: 'pp', cp: 1000 },
];

function CoinValueTable() {
  const { t } = useLocale();
  return (
    <Card>
      <CardKicker>{t('reference.coinsKicker')}</CardKicker>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left py-1 pr-3">{t('reference.coins.colName')}</th>
              <th className="text-left py-1 pr-3">{t('reference.coins.colAbbr')}</th>
              <th className="text-left py-1">{t('reference.coins.colValue')}</th>
            </tr>
          </thead>
          <tbody>
            {COIN_ROWS.map((row) => (
              <tr key={row.key} className="border-t border-stone-800">
                <td className="py-1 pr-3 text-stone-200">{t(`reference.coins.${row.key}`)}</td>
                <td className="py-1 pr-3 text-stone-400">{row.key}</td>
                <td className="py-1 text-stone-400">{t('reference.coins.valueInCp', { value: row.cp })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
