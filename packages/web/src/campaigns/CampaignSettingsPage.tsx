// Iteration 3 major M7 — the first dedicated settings page for a campaign.
// updateCampaign/deleteCampaign (services/campaigns.ts) have been fully
// implemented and DM-gated server-side since early on; this is their first
// web UI (CampaignShell.tsx's ExportCampaignButton comment used to note "no
// dedicated settings page exists yet" — this is that page).

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign } from '../lib/types';
import { useCampaignShell } from './CampaignShell';
import { EmptyState, ErrorBanner, errorMessage } from '../components/Feedback';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card, CardKicker } from '../components/ui/Card';
import { useLocale } from '../i18n/LocaleContext';

export function CampaignSettingsPage() {
  const { t } = useLocale();
  const { campaignId, campaign, role } = useCampaignShell();

  if (role !== 'dm') {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-2xl mx-auto">
        <EmptyState message={t('settings.notDm')} />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-2xl mx-auto space-y-6">
      <h2 className="font-display text-lg font-medium">{t('settings.title')}</h2>
      <DetailsForm campaignId={campaignId} campaign={campaign} />
      <BastionsToggleSection campaignId={campaignId} campaign={campaign} />
      <ArchiveSection campaignId={campaignId} campaign={campaign} />
      <DangerZone campaignId={campaignId} campaignName={campaign.name} />
    </div>
  );
}

function DetailsForm({ campaignId, campaign }: { campaignId: string; campaign: Campaign }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? '');
  const [srdEdition, setSrdEdition] = useState<'2014' | '2024'>(campaign.srd_edition);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch<{ campaign: Campaign }>(`/campaigns/${campaignId}`, {
        name,
        description: description.trim() === '' ? null : description,
        srdEdition,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    saveMutation.mutate();
  }

  const dirty = name !== campaign.name || (description || null) !== campaign.description || srdEdition !== campaign.srd_edition;

  return (
    <Card className="gap-4">
      <CardKicker>{t('settings.detailsTitle')}</CardKicker>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label={t('settings.nameLabel')} htmlFor="campaignName">
          <Input id="campaignName" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('settings.descriptionLabel')} htmlFor="campaignDescription">
          <Textarea id="campaignDescription" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field
          label={t('settings.editionLabel')}
          htmlFor="campaignEdition"
          hint={t('settings.editionHint')}
        >
          <Select
            id="campaignEdition"
            value={srdEdition}
            onChange={(e) => setSrdEdition(e.target.value as '2014' | '2024')}
            className="max-w-[10rem]"
          >
            <option value="2024">2024</option>
            <option value="2014">2014</option>
          </Select>
        </Field>
        {saveMutation.isError && <ErrorBanner message={errorMessage(saveMutation.error)} />}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={!dirty || !name.trim() || saveMutation.isPending}>
            {saveMutation.isPending ? t('settings.saving') : t('settings.saveButton')}
          </Button>
          {saveMutation.isSuccess && !dirty && (
            <span className="text-xs text-stone-500">{t('settings.saved')}</span>
          )}
        </div>
      </form>
    </Card>
  );
}

// Phase 4 "Bastion tracking" — DM opt-in (docs/rules/bastions.md §1: "it's
// up to the DM to decide whether Bastions are available in a campaign"),
// same simple-boolean-toggle pattern as allow_ability_reroll.
function BastionsToggleSection({ campaignId, campaign }: { campaignId: string; campaign: Campaign }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: (bastionsEnabled: boolean) => api.patch<{ campaign: Campaign }>(`/campaigns/${campaignId}`, { bastionsEnabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] }),
  });

  return (
    <Card className="gap-3">
      <CardKicker>{t('settings.bastionsTitle')}</CardKicker>
      <p className="text-sm text-stone-400">{t('settings.bastionsHint')}</p>
      {toggleMutation.isError && <ErrorBanner message={errorMessage(toggleMutation.error)} />}
      <label className="flex items-center gap-2 text-sm text-stone-300">
        <input
          type="checkbox"
          checked={campaign.bastions_enabled}
          disabled={toggleMutation.isPending}
          onChange={(e) => toggleMutation.mutate(e.target.checked)}
        />
        {t('settings.bastionsEnabledLabel')}
      </label>
    </Card>
  );
}

function ArchiveSection({ campaignId, campaign }: { campaignId: string; campaign: Campaign }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const isArchived = campaign.archived_at !== null;

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) => api.patch<{ campaign: Campaign }>(`/campaigns/${campaignId}`, { archived }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  return (
    <Card className="gap-3">
      <CardKicker>{t('settings.archiveTitle')}</CardKicker>
      <p className="text-sm text-stone-400">{isArchived ? t('settings.archivedHint') : t('settings.activeHint')}</p>
      {archiveMutation.isError && <ErrorBanner message={errorMessage(archiveMutation.error)} />}
      <div>
        <Button
          variant="secondary"
          disabled={archiveMutation.isPending}
          onClick={() => archiveMutation.mutate(!isArchived)}
        >
          {archiveMutation.isPending
            ? t('settings.archiving')
            : isArchived
              ? t('settings.unarchiveButton')
              : t('settings.archiveButton')}
        </Button>
      </div>
    </Card>
  );
}

function DangerZone({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/campaigns/${campaignId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      navigate('/campaigns');
    },
  });

  function handleDelete() {
    // Irreversible and campaign-wide (every character/encounter/map/note
    // this campaign owns goes with it via cascade) — the one action on this
    // page that gets a typed-name confirm rather than a plain confirm(),
    // matching the severity of what's actually happening.
    const typed = window.prompt(t('settings.deleteConfirmPrompt', { name: campaignName }));
    if (typed !== campaignName) return;
    deleteMutation.mutate();
  }

  return (
    <Card className="gap-3 border border-red-900/50">
      <CardKicker>{t('settings.dangerTitle')}</CardKicker>
      <p className="text-sm text-stone-400">{t('settings.deleteHint')}</p>
      {deleteMutation.isError && <ErrorBanner message={errorMessage(deleteMutation.error)} />}
      <div>
        <Button variant="danger" disabled={deleteMutation.isPending} onClick={handleDelete}>
          {deleteMutation.isPending ? t('settings.deleting') : t('settings.deleteButton')}
        </Button>
      </div>
    </Card>
  );
}
