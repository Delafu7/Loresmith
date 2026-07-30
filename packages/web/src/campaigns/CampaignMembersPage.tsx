// DM-only members + invitations page — the first web UI for
// GET /campaigns/:id/members (previously only fetched read-only elsewhere,
// e.g. CharactersListPage.tsx's owner-picker) and for the email-invitation
// flow (POST/GET/DELETE /campaigns/:id/invitations). No settings page
// existed before this (see CampaignShell.tsx's own comment on
// ExportCampaignButton) — this is that page's first tenant.

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignInvitation, CampaignMember, CampaignRole } from '../lib/types';
import { useCampaignShell } from './CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input, Select } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card, CardKicker } from '../components/ui/Card';
import { Badge, type BadgeVariant } from '../components/ui/Badge';
import { formatTimestamp } from '../lib/dates';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';

const STATUS_BADGE_VARIANT: Record<CampaignInvitation['status'], BadgeVariant> = {
  pending: 'accent',
  accepted: 'outline',
  revoked: 'danger',
};

export function CampaignMembersPage() {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const isDm = role === 'dm';

  if (!isDm) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <EmptyState message={t('members.notDm')} />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-6">
      <h2 className="font-display text-lg font-medium">{t('members.title')}</h2>
      <MembersList campaignId={campaignId} />
      <InvitationsPanel campaignId={campaignId} />
    </div>
  );
}

function roleLabel(t: (key: TranslationKey) => string, role: CampaignRole): string {
  return role === 'dm' ? t('members.dmRole') : t('members.playerRole');
}

function MembersList({ campaignId }: { campaignId: string }) {
  const { t } = useLocale();
  const membersQuery = useQuery({
    queryKey: ['campaign', campaignId, 'members'],
    queryFn: () => api.get<{ members: CampaignMember[] }>(`/campaigns/${campaignId}/members`),
  });

  return (
    <Card>
      <CardKicker>{t('members.memberListTitle')}</CardKicker>
      {membersQuery.isLoading && <Loading />}
      {membersQuery.isError && <ErrorBanner message={errorMessage(membersQuery.error)} />}
      <ul className="mt-1 divide-y divide-stone-800">
        {membersQuery.data?.members.map((m) => (
          <MemberRow key={m.id} member={m} />
        ))}
      </ul>
    </Card>
  );
}

function MemberRow({ member }: { member: CampaignMember }) {
  const { t } = useLocale();
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-stone-100">{member.display_name}</span>
        <span className="block truncate text-[11px] text-stone-500">
          {member.email} · {t('members.joined', { date: formatTimestamp(member.joined_at) })}
        </span>
      </span>
      <div className="flex items-center gap-3 flex-shrink-0">
        <Badge variant="outline">{roleLabel(t, member.role)}</Badge>
      </div>
    </li>
  );
}

function InvitationsPanel({ campaignId }: { campaignId: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CampaignRole>('player');

  const invitationsQuery = useQuery({
    queryKey: ['campaign', campaignId, 'invitations'],
    queryFn: () => api.get<{ invitations: CampaignInvitation[] }>(`/campaigns/${campaignId}/invitations`),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<{ invitation: CampaignInvitation }>(`/campaigns/${campaignId}/invitations`, { email, role: inviteRole }),
    onSuccess: () => {
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'invitations'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => api.delete(`/campaigns/${campaignId}/invitations/${invitationId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'invitations'] }),
  });

  function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    createMutation.mutate();
  }

  const invitations = invitationsQuery.data?.invitations ?? [];

  return (
    <Card className="gap-4">
      <CardKicker>{t('members.invitationsTitle')}</CardKicker>

      <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-2">
        <Field label={t('members.inviteEmailLabel')} htmlFor="inviteEmail" className="min-w-[14rem] flex-1">
          <Input id="inviteEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('members.inviteRoleLabel')} htmlFor="inviteRole" className="w-32">
          <Select id="inviteRole" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as CampaignRole)}>
            <option value="player">{t('members.playerRole')}</option>
            <option value="dm">{t('members.dmRole')}</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={createMutation.isPending}>
          {createMutation.isPending ? t('members.inviting') : t('members.inviteButton')}
        </Button>
      </form>
      {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
      {revokeMutation.isError && <ErrorBanner message={errorMessage(revokeMutation.error)} />}

      {invitationsQuery.isLoading && <Loading />}
      {invitations.length === 0 && !invitationsQuery.isLoading && <EmptyState message={t('members.noInvitations')} />}
      <ul className="divide-y divide-stone-800">
        {invitations.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between gap-2 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-stone-100">{inv.invited_email}</span>
              <span className="block truncate text-[11px] text-stone-500">
                {roleLabel(t, inv.role)} · {t('members.invitedOn', { date: formatTimestamp(inv.created_at) })}
              </span>
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant={STATUS_BADGE_VARIANT[inv.status]}>{t(`members.${inv.status}Badge`)}</Badge>
              {inv.status === 'pending' && (
                <button
                  type="button"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(inv.id)}
                  className="min-h-11 px-1 text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                >
                  {revokeMutation.isPending ? t('members.revoking') : t('members.revokeButton')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
