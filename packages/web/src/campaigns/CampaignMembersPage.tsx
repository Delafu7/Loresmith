// DM-only members + invitations page — the first web UI for
// GET /campaigns/:id/members (previously only fetched read-only elsewhere,
// e.g. CharactersListPage.tsx's owner-picker) and for the email-invitation
// flow (POST/GET/DELETE /campaigns/:id/invitations). No settings page
// existed before this (see CampaignShell.tsx's own comment on
// ExportCampaignButton) — this is that page's first tenant.

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignInvitation, CampaignMember, CampaignRole, Character } from '../lib/types';
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
  const { campaignId, campaign, role } = useCampaignShell();
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
      <MembersList campaignId={campaignId} owningDmUserId={campaign.dm_user_id} />
      <InvitationsPanel campaignId={campaignId} />
    </div>
  );
}

function roleLabel(t: (key: TranslationKey) => string, role: CampaignRole): string {
  return role === 'dm' ? t('members.dmRole') : role === 'spectator' ? t('members.spectatorRole') : t('members.playerRole');
}

function MembersList({ campaignId, owningDmUserId }: { campaignId: string; owningDmUserId: string }) {
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
          <MemberRow key={m.id} member={m} campaignId={campaignId} isOwningDm={m.user_id === owningDmUserId} />
        ))}
      </ul>
    </Card>
  );
}

// Per-player character-creation controls (can_create_characters,
// max_characters) — DM-only, only meaningful for role='player' rows (the DM
// isn't subject to a character limit). Each control fires its own PATCH
// .../members/:userId immediately (checkbox on change, number field on
// blur — not on every keystroke) via services/campaigns.ts's updateMember.
//
// Iteration 3 major M6 — role change and remove were both fully implemented
// server-side (updateMember/removeMember) with no frontend caller at all.
// `isOwningDm` (this campaign's campaigns.dm_user_id row, distinct from
// "any member currently holding the 'dm' role") disables both controls for
// that one row: removeMember already 409s on it server-side ("delete the
// campaign instead"), and role-change has no equivalent guard, so changing
// it away from 'dm' here would strand the campaign's actual owner without
// DM access with no server-side safety net — simpler to just not offer it.
function MemberRow({ member, campaignId, isOwningDm }: { member: CampaignMember; campaignId: string; isOwningDm: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [maxCharactersInput, setMaxCharactersInput] = useState(member.max_characters?.toString() ?? '');

  const updateMutation = useMutation({
    mutationFn: (patch: { role?: CampaignRole; canCreateCharacters?: boolean; maxCharacters?: number | null }) =>
      api.patch<{ member: CampaignMember }>(`/campaigns/${campaignId}/members/${member.user_id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'members'] }),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete(`/campaigns/${campaignId}/members/${member.user_id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'members'] }),
  });

  function commitMaxCharacters() {
    const trimmed = maxCharactersInput.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      setMaxCharactersInput(member.max_characters?.toString() ?? ''); // revert invalid input
      return;
    }
    if (value === member.max_characters) return; // no-op, avoid a needless request
    updateMutation.mutate({ maxCharacters: value });
  }

  function handleRemove() {
    if (!window.confirm(t('members.removeConfirm', { name: member.display_name }))) return;
    removeMutation.mutate();
  }

  const pending = updateMutation.isPending || removeMutation.isPending;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-stone-100">{member.display_name}</span>
        <span className="block truncate text-[11px] text-stone-500">
          {member.email} · {t('members.joined', { date: formatTimestamp(member.joined_at) })}
        </span>
      </span>
      <div className="flex items-center gap-3 flex-shrink-0">
        {member.role === 'player' && (
          <>
            <label className="flex items-center gap-1.5 text-[11px] text-stone-400">
              <input
                type="checkbox"
                checked={member.can_create_characters}
                disabled={pending}
                onChange={(e) => updateMutation.mutate({ canCreateCharacters: e.target.checked })}
              />
              {t('members.canCreateCharacters')}
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-stone-400">
              {t('members.maxCharactersLabel')}
              <input
                type="number"
                min={0}
                placeholder={t('members.unlimited')}
                value={maxCharactersInput}
                disabled={pending}
                onChange={(e) => setMaxCharactersInput(e.target.value)}
                onBlur={commitMaxCharacters}
                className="w-16 rounded bg-stone-800 border border-stone-700 px-1.5 py-0.5 text-stone-100"
              />
            </label>
          </>
        )}
        {isOwningDm ? (
          <Badge variant="outline" title={t('members.owningDmHint')}>
            {roleLabel(t, member.role)}
          </Badge>
        ) : (
          <select
            value={member.role}
            disabled={pending}
            onChange={(e) => updateMutation.mutate({ role: e.target.value as CampaignRole })}
            className="min-h-9 rounded border border-stone-700 bg-stone-800 text-stone-200 text-xs px-2"
            aria-label={t('members.roleSelectAria', { name: member.display_name })}
          >
            <option value="dm">{t('members.dmRole')}</option>
            <option value="player">{t('members.playerRole')}</option>
            <option value="spectator">{t('members.spectatorRole')}</option>
          </select>
        )}
        {!isOwningDm && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={pending}
            className="min-h-9 px-1 text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
          >
            {removeMutation.isPending ? t('members.removing') : t('members.removeButton')}
          </button>
        )}
      </div>
      {updateMutation.isError && (
        <p className="w-full text-[11px] text-red-400">{errorMessage(updateMutation.error)}</p>
      )}
      {removeMutation.isError && (
        <p className="w-full text-[11px] text-red-400">{errorMessage(removeMutation.error)}</p>
      )}
    </li>
  );
}

function InvitationsPanel({ campaignId }: { campaignId: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CampaignRole>('player');
  // Iteration 2 "Character ownership vs. control" — optional invite-to-claim:
  // '' means "plain membership invite," unchanged from before this
  // iteration; a picked character id turns this into a claim invite (see
  // services/campaignInvitations.ts's acceptInvitation).
  const [claimCharacterId, setClaimCharacterId] = useState('');

  const invitationsQuery = useQuery({
    queryKey: ['campaign', campaignId, 'invitations'],
    queryFn: () => api.get<{ invitations: CampaignInvitation[] }>(`/campaigns/${campaignId}/invitations`),
  });

  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });
  const unclaimedPcs = (charactersQuery.data?.characters ?? []).filter((c) => c.is_pc && c.owner_user_id === null);
  const charactersById = new Map((charactersQuery.data?.characters ?? []).map((c) => [c.id, c]));

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ invitation: CampaignInvitation }>(`/campaigns/${campaignId}/invitations`, {
        email,
        role: inviteRole,
        characterId: claimCharacterId || undefined,
      }),
    onSuccess: () => {
      setEmail('');
      setClaimCharacterId('');
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
            <option value="spectator">{t('members.spectatorRole')}</option>
          </Select>
        </Field>
        {unclaimedPcs.length > 0 && (
          <Field label={t('members.claimCharacterLabel')} htmlFor="claimCharacter" className="min-w-[12rem]">
            <Select id="claimCharacter" value={claimCharacterId} onChange={(e) => setClaimCharacterId(e.target.value)}>
              <option value="">{t('members.claimCharacterNone')}</option>
              {unclaimedPcs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
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
                {inv.character_id != null &&
                  ` · ${t('members.claimsCharacter', { name: charactersById.get(inv.character_id)?.name ?? '?' })}`}
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
