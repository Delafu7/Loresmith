import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign, Character, CampaignMember } from '../lib/types';
import type { CharactersUpdatedEvent } from '../lib/socketTypes';
import { useAuth } from '../auth/AuthContext';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useSocket } from '../lib/SocketContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { abilityModifier, formatModifier } from '../lib/dnd-math';
import { AbilityScoreGenerator } from './AbilityScoreGenerator';
import { useFormDraft } from '../lib/useFormDraft';
import { useLocale } from '../i18n/LocaleContext';

function emptyCharacterForm() {
  return {
    name: '',
    isPc: true,
    ownerUserId: '',
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
    armorClass: 10,
    hpMax: 10,
  };
}

export function CharactersListPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [showCreate, setShowCreate] = useState(false);

  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });

  // A DM's NPC reveal/hide should refresh this list live for every connected
  // player — same "bare invalidation signal" contract as BESTIARY_UPDATED/
  // LOCATIONS_FACTIONS_UPDATED (see sockets/broadcast.ts's
  // broadcastCharactersUpdated).
  useEffect(() => {
    function onUpdated(payload: CharactersUpdatedEvent) {
      if (payload.campaignId !== campaignId) return;
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] });
    }
    socket.on('CHARACTERS_UPDATED', onUpdated);
    return () => {
      socket.off('CHARACTERS_UPDATED', onUpdated);
    };
  }, [socket, campaignId, queryClient]);

  // Not DM-only — GET /:id/members is open to any campaign member, and a
  // player needs their OWN row here to know their can_create_characters/
  // max_characters state (see myMembership/atCharacterLimit below).
  const membersQuery = useQuery({
    queryKey: ['campaignMembers', campaignId],
    queryFn: () => api.get<{ members: CampaignMember[] }>(`/campaigns/${campaignId}/members`),
  });

  // Draft-persisted per campaign+role so a half-filled "create character"
  // form (ability scores rolled, name typed) survives an accidental
  // navigation away — see lib/useFormDraft.ts.
  const [form, setForm, clearDraft] = useFormDraft(`draft:character:new:${campaignId}:${role}`, emptyCharacterForm);

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
      setForm(emptyCharacterForm());
      clearDraft();
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

  // Per-player character-creation controls (Phase 6) — DM is never subject
  // to these, so this only matters when role === 'player'.
  const myMembership = membersQuery.data?.members.find((m) => m.user_id === user?.id);
  const myOwnedPcCount = pcs.filter((c) => c.owner_user_id === user?.id).length;
  const creationBlockedReason: 'disabled' | 'limitReached' | null =
    role === 'player' && myMembership
      ? !myMembership.can_create_characters
        ? 'disabled'
        : myMembership.max_characters !== null && myOwnedPcCount >= myMembership.max_characters
          ? 'limitReached'
          : null
      : null;

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{t('characters.list.title')}</h2>
        <div className="flex items-center gap-2">
          {creationBlockedReason === null ? (
            <Link
              to="new"
              className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 font-semibold px-4 py-2 text-sm"
            >
              {role === 'dm' ? t('characters.list.newCharacter') : t('characters.list.createMyPc')}
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="rounded-md border border-amber-500 text-amber-500 opacity-45 cursor-not-allowed font-semibold px-4 py-2 text-sm"
            >
              {role === 'dm' ? t('characters.list.newCharacter') : t('characters.list.createMyPc')}
            </span>
          )}
          <button
            type="button"
            disabled={creationBlockedReason !== null}
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-md border border-stone-600 text-stone-200 hover:bg-stone-100/5 disabled:opacity-45 disabled:cursor-not-allowed px-3 py-2 text-xs"
          >
            {showCreate ? t('common.cancel') : t('characters.list.quickCreate')}
          </button>
        </div>
      </div>

      {creationBlockedReason === 'disabled' && (
        <p className="text-xs text-stone-500 mb-4">{t('characters.list.creationDisabled')}</p>
      )}
      {creationBlockedReason === 'limitReached' && (
        <p className="text-xs text-stone-500 mb-4">
          {t('characters.list.creationLimitReached', { max: myMembership!.max_characters! })}
        </p>
      )}

      {role === 'dm' && (
        <label className="flex items-center gap-2 text-xs text-stone-400 mb-4">
          <input
            type="checkbox"
            checked={campaign.allow_ability_reroll}
            disabled={allowRerollMutation.isPending}
            onChange={(e) => allowRerollMutation.mutate(e.target.checked)}
          />
          {t('characters.list.allowReroll')}
        </label>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 bg-stone-900 border border-stone-800 rounded-lg p-5 space-y-4">
          <div>
            <label htmlFor="charName" className="block text-sm font-medium text-stone-300 mb-1">
              {t('characters.list.nameLabel')}
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
                {t('characters.common.playerCharacter')}
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-300">
                <input
                  type="radio"
                  checked={!form.isPc}
                  onChange={() => setForm((f) => ({ ...f, isPc: false }))}
                />
                {t('characters.common.npc')}
              </label>
            </div>
          )}

          {role === 'dm' && form.isPc && (
            <div>
              <label htmlFor="owner" className="block text-sm font-medium text-stone-300 mb-1">
                {t('characters.list.owningPlayer')}
              </label>
              {/* Not required — a DM may leave a PC unassigned and attach an
                  owner later by email (AssignOwnerControl below), same as an
                  imported campaign's PCs always start out (campaignImport.ts). */}
              <select
                id="owner"
                value={form.ownerUserId}
                onChange={(e) => setForm((f) => ({ ...f, ownerUserId: e.target.value }))}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100"
              >
                <option value="">{t('characters.list.leaveUnassigned')}</option>
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
                {t('characters.common.armorClass')}
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
                {t('characters.list.maxHp')}
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
            {createMutation.isPending ? t('characters.list.creating') : t('common.create')}
          </button>
        </form>
      )}

      {charactersQuery.isLoading && <Loading />}
      {charactersQuery.isError && <ErrorBanner message={errorMessage(charactersQuery.error)} />}

      <section className="mb-8">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-2">{t('characters.list.playerCharactersHeading')}</h3>
        {pcs.length === 0 && <EmptyState message={t('characters.list.noPcs')} />}
        <ul className="grid sm:grid-cols-2 gap-3">
          {pcs.map((c) => (
            <CharacterCard key={c.id} character={c} campaignId={campaignId} isDm={role === 'dm'} players={players} />
          ))}
        </ul>
      </section>

      {role === 'dm' && (
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-2">{t('characters.list.npcsHeading')}</h3>
          {npcs.length === 0 && <EmptyState message={t('characters.list.noNpcs')} />}
          <ul className="grid sm:grid-cols-2 gap-3">
            {npcs.map((c) => (
              <CharacterCard key={c.id} character={c} campaignId={campaignId} isDm={role === 'dm'} players={players} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CharacterCard({
  character,
  campaignId,
  isDm,
  players,
}: {
  character: Character;
  campaignId: string;
  isDm: boolean;
  players: CampaignMember[];
}) {
  const { t } = useLocale();
  return (
    <li className="rounded-md bg-stone-900 shadow-sm hover:border-amber-700 hover:bg-stone-800/60 transition-colors">
      <Link to={`/campaigns/${campaignId}/characters/${character.id}`} className="block px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-medium text-stone-100 flex items-center gap-2">
            {character.name}
            {isDm && !character.is_pc && !character.visible_to_players && (
              <span className="rounded-full border border-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                {t('characters.list.hiddenBadge')}
              </span>
            )}
          </span>
          {!character.is_alive && <span className="text-xs text-red-400 font-semibold uppercase">{t('characters.common.deceased')}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-stone-400 mt-1">
          <span>
            HP {character.hp_current}/{character.hp_max}
          </span>
          <span>AC {character.armor_class}</span>
          <span>DEX {formatModifier(abilityModifier(character.dex))}</span>
        </div>
      </Link>
      {isDm && !character.is_pc && <NpcVisibilityControl character={character} campaignId={campaignId} />}
      {isDm && character.is_pc && character.owner_user_id === null && (
        <AssignOwnerControl characterId={character.id} campaignId={campaignId} />
      )}
      {isDm && character.is_pc && character.owner_user_id !== null && (
        <DelegateControlControl character={character} campaignId={campaignId} players={players} />
      )}
    </li>
  );
}

// DM-only reveal/hide toggle for an NPC — same shape as LocationsFactionsPage.tsx's
// per-row visibility toggle (services/characters.ts's requireCharacterVisible
// is the server-side enforcement this drives). Rendered below (not inside)
// the card's own Link, same convention as AssignOwnerControl/
// DelegateControlControl siblings.
function NpcVisibilityControl({ character, campaignId }: { character: Character; campaignId: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const visibilityMutation = useMutation({
    mutationFn: (visibleToPlayers: boolean) =>
      api.patch<{ character: Character }>(`/characters/${character.id}`, { visibleToPlayers }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] }),
  });

  return (
    <div className="flex items-center justify-end border-t border-stone-800 px-4 py-2">
      <button
        type="button"
        onClick={() => visibilityMutation.mutate(!character.visible_to_players)}
        disabled={visibilityMutation.isPending}
        className="rounded border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-45 px-2 py-1 text-[11px] font-semibold"
      >
        {character.visible_to_players ? t('characters.list.toggleToHidden') : t('characters.list.toggleToRevealed')}
      </button>
    </div>
  );
}

// DM-only "assign to player by email" for a PC that landed unassigned —
// imported campaigns now always create PCs this way (campaignImport.ts), and
// a DM may also create one unassigned directly. Rendered below (not inside)
// the card's own Link, with its own click-stopping so typing/submitting
// doesn't navigate to the character sheet underneath it.
function AssignOwnerControl({ characterId, campaignId }: { characterId: string; campaignId: string }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');

  const assignMutation = useMutation({
    mutationFn: () => api.patch<{ character: Character }>(`/characters/${characterId}/assign-owner`, { email }),
    onSuccess: () => {
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    assignMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5 border-t border-stone-800 px-4 py-2">
      <span className="text-[11px] text-amber-500 flex-shrink-0">{t('characters.list.unassigned')}</span>
      <input
        type="email"
        required
        placeholder={t('characters.list.assignEmailPlaceholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="min-w-0 flex-1 rounded bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
      />
      <button
        type="submit"
        disabled={assignMutation.isPending}
        className="flex-shrink-0 rounded border border-amber-500 text-amber-500 hover:bg-amber-500/10 disabled:opacity-45 px-2 py-1 text-[11px] font-semibold"
      >
        {assignMutation.isPending ? t('characters.list.assigning') : t('characters.list.assignButton')}
      </button>
      {assignMutation.isError && (
        <p className="w-full text-[11px] text-red-400">{errorMessage(assignMutation.error)}</p>
      )}
    </form>
  );
}

// Iteration 2 "Character ownership vs. control" — DM-only, sibling of
// AssignOwnerControl above but visually distinct on purpose: assign =
// ownership (amber, matches the rest of this app's primary-action color),
// delegate = temporary control (violet, matches the control badges'
// "delegated" dot in controlBadge.ts). Only rendered for an already-OWNED PC
// — an unclaimed PC shows AssignOwnerControl instead (see CharacterCard),
// mirroring the server's own owner-vs-controller split.
function DelegateControlControl({
  character,
  campaignId,
  players,
}: {
  character: Character;
  campaignId: string;
  players: CampaignMember[];
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [toUserId, setToUserId] = useState('');

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['characters', campaignId] });
  }

  const delegateMutation = useMutation({
    mutationFn: () => api.post<{ character: Character }>(`/characters/${character.id}/delegate-control`, { toUserId }),
    onSuccess: () => {
      setToUserId('');
      invalidate();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.post<{ character: Character }>(`/characters/${character.id}/revoke-control`, {}),
    onSuccess: invalidate,
  });

  if (character.controller_user_id !== null) {
    const controller = players.find((p) => p.user_id === character.controller_user_id);
    return (
      <div className="flex items-center gap-1.5 border-t border-stone-800 px-4 py-2">
        <span className="text-[11px] text-violet-400 flex-shrink-0 truncate">
          {t('characters.list.currentlyControlledBy', { name: controller?.display_name ?? '?' })}
        </span>
        <button
          type="button"
          onClick={() => revokeMutation.mutate()}
          disabled={revokeMutation.isPending}
          className="ml-auto flex-shrink-0 rounded border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-45 px-2 py-1 text-[11px] font-semibold"
        >
          {revokeMutation.isPending ? t('characters.list.revokingControl') : t('characters.list.revokeControlButton')}
        </button>
        {revokeMutation.isError && (
          <p className="w-full text-[11px] text-red-400">{errorMessage(revokeMutation.error)}</p>
        )}
      </div>
    );
  }

  // Nobody else to delegate to (a solo campaign, or every other member is
  // this character's own owner) — nothing useful to render.
  const delegatable = players.filter((p) => p.user_id !== character.owner_user_id);
  if (delegatable.length === 0) return null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!toUserId) return;
    delegateMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5 border-t border-stone-800 px-4 py-2">
      <select
        required
        value={toUserId}
        onChange={(e) => setToUserId(e.target.value)}
        className="min-w-0 flex-1 rounded bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
      >
        <option value="">{t('characters.list.delegateToPlaceholder')}</option>
        {delegatable.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.display_name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={delegateMutation.isPending}
        className="flex-shrink-0 rounded border border-violet-500 text-violet-400 hover:bg-violet-500/10 disabled:opacity-45 px-2 py-1 text-[11px] font-semibold"
      >
        {delegateMutation.isPending ? t('characters.list.delegatingControl') : t('characters.list.delegateControlButton')}
      </button>
      {delegateMutation.isError && (
        <p className="w-full text-[11px] text-red-400">{errorMessage(delegateMutation.error)}</p>
      )}
    </form>
  );
}
