// Phase 4 "Bastion tracking" — campaign-level list + create. See
// docs/rules/bastions.md for the rules writeup and services/bastions.ts for
// the server-side authorization model this page mirrors: a Bastion belongs
// to one character, so create/manage is owner-or-DM, not DM-only.

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Bastion, Character } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Select } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card, CardKicker } from '../components/ui/Card';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/LocaleContext';

const STATUS_COLOR: Record<Bastion['status'], string> = {
  active: 'text-emerald-400',
  fallen: 'text-red-400',
  abandoned: 'text-stone-500',
};

export function BastionsPage() {
  const { t } = useLocale();
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);

  const bastionsQuery = useQuery({
    queryKey: ['bastions', campaignId],
    queryFn: () => api.get<{ bastions: Bastion[] }>(`/campaigns/${campaignId}/bastions`),
    enabled: campaign.bastions_enabled,
  });
  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
    enabled: campaign.bastions_enabled,
  });

  if (!campaign.bastions_enabled) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <EmptyState
          message={role === 'dm' ? t('bastions.notEnabledDmHint') : t('bastions.notEnabledHint')}
          action={role === 'dm' ? <Link to="../settings" className="text-amber-500 hover:text-amber-400 text-sm">{t('bastions.goToSettings')}</Link> : undefined}
        />
      </div>
    );
  }

  const characters = charactersQuery.data?.characters ?? [];
  const eligibleCharacters = characters.filter((c) => c.is_pc && (role === 'dm' || c.owner_user_id === user?.id));
  const bastions = bastionsQuery.data?.bastions ?? [];
  const characterName = (id: string) => characters.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-medium">{t('bastions.title')}</h2>
        {eligibleCharacters.length > 0 && (
          <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('bastions.cancel') : t('bastions.newBastion')}
          </Button>
        )}
      </div>

      {showCreate && (
        <CreateBastionForm campaignId={campaignId} characters={eligibleCharacters} onClose={() => setShowCreate(false)} />
      )}

      {bastionsQuery.isLoading && <Loading />}
      {bastionsQuery.isError && <ErrorBanner message={errorMessage(bastionsQuery.error)} />}
      {bastionsQuery.data && bastions.length === 0 && <EmptyState message={t('bastions.noBastions')} />}

      <ul className="space-y-3">
        {bastions.map((bastion) => (
          <li key={bastion.id}>
            <Link to={bastion.id}>
              <Card interactive className="gap-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-stone-100">
                    {bastion.name || t('bastions.unnamed')} <span className="text-stone-500 text-sm">— {characterName(bastion.owner_character_id)}</span>
                  </h3>
                  <span className={`text-xs uppercase font-semibold ${STATUS_COLOR[bastion.status]}`}>{t(`bastions.status.${bastion.status}`)}</span>
                </div>
                <p className="text-xs text-stone-500">
                  {t('bastions.summaryLine', { bp: bastion.bastion_points, defenders: bastion.bastion_defenders })}
                </p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreateBastionForm({ campaignId, characters, onClose }: { campaignId: string; characters: Character[]; onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [ownerCharacterId, setOwnerCharacterId] = useState(characters[0]?.id ?? '');

  const createMutation = useMutation({
    mutationFn: () => api.post<{ bastion: Bastion }>(`/campaigns/${campaignId}/bastions`, { ownerCharacterId }),
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['bastions', campaignId] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ownerCharacterId) return;
    createMutation.mutate();
  }

  return (
    <Card as="form" onSubmit={handleSubmit} className="mb-6 gap-3">
      <CardKicker>{t('bastions.newBastion')}</CardKicker>
      <Field label={t('bastions.characterLabel')} htmlFor="bastionOwnerCharacter" hint={t('bastions.characterHint')}>
        <Select id="bastionOwnerCharacter" value={ownerCharacterId} onChange={(e) => setOwnerCharacterId(e.target.value)}>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
      <div>
        <Button type="submit" variant="primary" disabled={createMutation.isPending || !ownerCharacterId}>
          {createMutation.isPending ? t('bastions.saving') : t('bastions.createButton')}
        </Button>
      </div>
    </Card>
  );
}
