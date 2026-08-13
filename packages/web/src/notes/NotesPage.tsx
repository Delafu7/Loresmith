import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignRole, Character, GmVisibility, Location, Note } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input, Textarea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { formatTimestamp } from '../lib/dates';
import { useFormDraft } from '../lib/useFormDraft';
import { useLocale } from '../i18n/LocaleContext';

interface NoteFormValues {
  title: string;
  body: string;
  // Phase 3 "note-character linking UI" — empty string means unlinked
  // (notes.character_id NULL), same "empty = unset" convention as every
  // other optional select in this app.
  characterId: string;
  // Phase 3 "locations and factions" — same "empty = unset" convention as
  // characterId above.
  locationId: string;
  // Phase 3 "rulings log".
  noteType: 'note' | 'ruling';
  // GM-only visibility layer.
  visibility: GmVisibility;
}

// Defaults from the acting user's role, mirroring the server's create-time
// default (services/notes.ts's defaultVisibilityFor): a DM's new note
// defaults to gm_only (prep material); a player's defaults to
// revealed_to_players (unchanged from today's "every note visible to
// everyone" behavior for player-authored notes).
function emptyNoteForm(role: CampaignRole): NoteFormValues {
  return { title: '', body: '', characterId: '', locationId: '', noteType: 'note', visibility: role === 'dm' ? 'gm_only' : 'revealed_to_players' };
}

export function NotesPage() {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isDm = role === 'dm';
  const [showCreate, setShowCreate] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  // GM-only visibility layer — multi-select for the bulk reveal/hide bar,
  // DM-only (bulk-changing another player's note visibility isn't a player
  // action; a player's own single-note visibility is already covered by
  // create/edit).
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

  const notesQuery = useQuery({
    queryKey: ['notes', campaignId],
    queryFn: () => api.get<{ notes: Note[] }>(`/campaigns/${campaignId}/notes`),
  });

  // Phase 3 "full-text search on notes" — a separate query rather than a
  // client-side filter of notesQuery's page, so search actually reaches
  // notes.search_vector server-side (title+body full-text, stemmed) instead
  // of a substring match over whatever page happened to already be loaded.
  const [searchTerm, setSearchTerm] = useState('');
  const trimmedSearchTerm = searchTerm.trim();
  const searchQuery = useQuery({
    queryKey: ['notes', campaignId, 'search', trimmedSearchTerm],
    queryFn: () => api.get<{ notes: Note[] }>(`/campaigns/${campaignId}/notes/search?q=${encodeURIComponent(trimmedSearchTerm)}`),
    enabled: trimmedSearchTerm.length > 0,
  });
  const isSearching = trimmedSearchTerm.length > 0;
  const [rulingsOnly, setRulingsOnly] = useState(false);
  const displayedNotes = (isSearching ? (searchQuery.data?.notes ?? []) : (notesQuery.data?.notes ?? [])).filter(
    (n) => !rulingsOnly || n.note_type === 'ruling',
  );

  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });
  const characters = charactersQuery.data?.characters ?? [];
  const characterName = (characterId: string | null) => characters.find((c) => c.id === characterId)?.name;

  const locationsQuery = useQuery({
    queryKey: ['locations', campaignId],
    queryFn: () => api.get<{ locations: Location[] }>(`/campaigns/${campaignId}/locations`),
  });
  const locations = locationsQuery.data?.locations ?? [];
  const locationName = (locationId: string | null) => locations.find((l) => l.id === locationId)?.name;

  // Draft-persisted create form (see lib/useFormDraft.ts) so a half-written
  // note survives an accidental navigation away.
  const [form, setForm, clearDraft] = useFormDraft(`draft:note:new:${campaignId}`, () => emptyNoteForm(role));

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ note: Note }>(`/campaigns/${campaignId}/notes`, {
        title: form.title,
        body: form.body,
        characterId: form.characterId || undefined,
        locationId: form.locationId || undefined,
        noteType: form.noteType,
        visibility: form.visibility,
      }),
    onSuccess: () => {
      setForm(emptyNoteForm(role));
      clearDraft();
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['notes', campaignId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => api.delete(`/campaigns/${campaignId}/notes/${noteId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notes', campaignId] }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (noteId: string) => api.post<{ note: Note }>(`/campaigns/${campaignId}/notes/${noteId}/duplicate`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notes', campaignId] }),
  });

  // GM-only visibility layer — one-click toggle (single note) and the
  // multi-select bulk bar both funnel through this one PATCH.
  const setVisibilityMutation = useMutation({
    mutationFn: ({ noteId, visibility }: { noteId: string; visibility: GmVisibility }) =>
      api.patch<{ note: Note }>(`/campaigns/${campaignId}/notes/${noteId}`, { visibility }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notes', campaignId] }),
  });

  const batchVisibilityMutation = useMutation({
    mutationFn: (visibility: GmVisibility) =>
      api.patch<{ notes: Note[] }>(`/campaigns/${campaignId}/notes/visibility/batch`, { noteIds: [...selectedNoteIds], visibility }),
    onSuccess: () => {
      setSelectedNoteIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ['notes', campaignId] });
    },
  });

  function toggleNoteSelected(noteId: string) {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-medium">{t('notes.title')}</h2>
        <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? t('notes.cancel') : t('notes.newNote')}
        </Button>
      </div>

      {showCreate && (
        <Card as="form" onSubmit={handleCreate} className="mb-6 gap-4">
          <Field label={t('notes.titleLabel')} htmlFor="noteTitle">
            <Input id="noteTitle" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label={t('notes.bodyLabel')} htmlFor="noteBody">
            <Textarea id="noteBody" required rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          </Field>
          <Field label={t('notes.linkedCharacterLabel')} htmlFor="noteCharacter">
            <select
              id="noteCharacter"
              value={form.characterId}
              onChange={(e) => setForm((f) => ({ ...f, characterId: e.target.value }))}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            >
              <option value="">{t('notes.linkedCharacterNone')}</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('notes.linkedLocationLabel')} htmlFor="noteLocation">
            <select
              id="noteLocation"
              value={form.locationId}
              onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            >
              <option value="">{t('notes.linkedLocationNone')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('notes.noteTypeLabel')} htmlFor="noteType">
            <select
              id="noteType"
              value={form.noteType}
              onChange={(e) => setForm((f) => ({ ...f, noteType: e.target.value as 'note' | 'ruling' }))}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            >
              <option value="note">{t('notes.noteTypeNote')}</option>
              <option value="ruling">{t('notes.noteTypeRuling')}</option>
            </select>
          </Field>
          <Field label={t('notes.visibilityLabel')} htmlFor="noteVisibility">
            <select
              id="noteVisibility"
              value={form.visibility}
              onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value as GmVisibility }))}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            >
              <option value="gm_only">{t('notes.visibilityGmOnly')}</option>
              <option value="revealed_to_players">{t('notes.visibilityRevealed')}</option>
              <option value="owner_only">{t('notes.visibilityOwnerOnly')}</option>
            </select>
          </Field>
          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? t('notes.saving') : t('notes.saveNote')}
          </Button>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[12rem]">
          <Input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('notes.searchPlaceholder')}
            aria-label={t('notes.searchPlaceholder')}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-stone-400">
          <input type="checkbox" checked={rulingsOnly} onChange={(e) => setRulingsOnly(e.target.checked)} />
          {t('notes.rulingsOnlyFilter')}
        </label>
      </div>

      {isSearching ? (
        <>
          {searchQuery.isLoading && <Loading />}
          {searchQuery.isError && <ErrorBanner message={errorMessage(searchQuery.error)} />}
          {searchQuery.data && searchQuery.data.notes.length === 0 && <EmptyState message={t('notes.searchNoResults')} />}
        </>
      ) : (
        <>
          {notesQuery.isLoading && <Loading />}
          {notesQuery.isError && <ErrorBanner message={errorMessage(notesQuery.error)} />}
          {notesQuery.data && notesQuery.data.notes.length === 0 && <EmptyState message={t('notes.noNotes')} />}
        </>
      )}

      {(deleteMutation.isError || duplicateMutation.isError || setVisibilityMutation.isError || batchVisibilityMutation.isError) && (
        <ErrorBanner
          message={errorMessage((deleteMutation.error ?? duplicateMutation.error ?? setVisibilityMutation.error ?? batchVisibilityMutation.error) as unknown)}
        />
      )}

      {isDm && selectedNoteIds.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-xs">
          <span className="text-stone-400">{t('notes.selectedCount', { count: String(selectedNoteIds.size) })}</span>
          <Button variant="ghost" size="sm" onClick={() => batchVisibilityMutation.mutate('revealed_to_players')} disabled={batchVisibilityMutation.isPending}>
            {t('notes.revealSelected')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => batchVisibilityMutation.mutate('gm_only')} disabled={batchVisibilityMutation.isPending}>
            {t('notes.hideSelected')}
          </Button>
        </div>
      )}

      <ul className="space-y-3">
        {displayedNotes.map((note) => {
          const canModify = role === 'dm' || note.author_user_id === user?.id;
          return (
            <li key={note.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-stone-100 flex items-center gap-2">
                    {isDm && (
                      <input
                        type="checkbox"
                        checked={selectedNoteIds.has(note.id)}
                        onChange={() => toggleNoteSelected(note.id)}
                        aria-label={t('notes.selectAll')}
                      />
                    )}
                    {note.title}
                    {note.note_type === 'ruling' && (
                      <span className="rounded-full border border-amber-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                        {t('notes.noteTypeRuling')}
                      </span>
                    )}
                    {note.visibility === 'gm_only' && (
                      <span className="rounded-full border border-red-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                        {t('notes.visibilityBadgeGmOnly')}
                      </span>
                    )}
                    {note.visibility === 'owner_only' && (
                      <span className="rounded-full border border-sky-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-400">
                        {t('notes.visibilityBadgeOwnerOnly')}
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canModify && note.visibility !== 'owner_only' && (
                      <button
                        type="button"
                        onClick={() =>
                          setVisibilityMutation.mutate({
                            noteId: note.id,
                            visibility: note.visibility === 'gm_only' ? 'revealed_to_players' : 'gm_only',
                          })
                        }
                        disabled={setVisibilityMutation.isPending}
                        className="min-h-11 px-1 text-stone-300 hover:text-stone-100 text-xs disabled:opacity-50"
                      >
                        {note.visibility === 'gm_only' ? t('notes.toggleToRevealed') : t('notes.toggleToGmOnly')}
                      </button>
                    )}
                    {canModify && (
                      <button
                        type="button"
                        onClick={() => setEditingNote(note)}
                        className="min-h-11 px-1 text-amber-500 hover:text-amber-400 text-xs"
                      >
                        {t('notes.edit')}
                      </button>
                    )}
                    {canModify && (
                      <button
                        type="button"
                        onClick={() => duplicateMutation.mutate(note.id)}
                        disabled={duplicateMutation.isPending}
                        className="min-h-11 px-1 text-stone-300 hover:text-stone-100 text-xs disabled:opacity-50"
                      >
                        {t('notes.duplicate')}
                      </button>
                    )}
                    {canModify && (
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(note.id)}
                        className="min-h-11 px-1 text-red-400 hover:text-red-300 text-xs"
                      >
                        {t('notes.delete')}
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-stone-300 whitespace-pre-wrap">{note.body}</p>
                {note.character_id && characterName(note.character_id) && (
                  <p className="text-xs text-amber-400">{t('notes.linkedCharacterTag', { name: characterName(note.character_id)! })}</p>
                )}
                {note.location_id && locationName(note.location_id) && (
                  <p className="text-xs text-amber-400">{t('notes.linkedLocationTag', { name: locationName(note.location_id)! })}</p>
                )}
                <p className="text-xs text-stone-500">
                  {t('notes.createdUpdated', { created: formatTimestamp(note.created_at), updated: formatTimestamp(note.updated_at) })}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>

      <NoteEditModal
        campaignId={campaignId}
        note={editingNote}
        characters={characters}
        locations={locations}
        onClose={() => setEditingNote(null)}
      />
    </div>
  );
}

// Note-only edit modal (Modal + PATCH-on-submit, mirroring
// CatalogEditorPage.tsx's CatalogEntryModal convention) — kept as a small
// inline sub-component rather than a generic abstraction, since Notes only
// ever edits a handful of fields. Split into a hook-free wrapper + the
// actual form (same shape as CatalogEntryModal/CatalogEntryForm) so the
// form only ever MOUNTS once a real note is being edited — otherwise a
// single long-lived component instance would keep whatever draft key/values
// it first mounted with even after `note` changes underneath it.
function NoteEditModal({
  campaignId,
  note,
  characters,
  locations,
  onClose,
}: {
  campaignId: string;
  note: Note | null;
  characters: Character[];
  locations: Location[];
  onClose: () => void;
}) {
  if (note === null) return null;
  return <NoteEditForm campaignId={campaignId} note={note} characters={characters} locations={locations} onClose={onClose} />;
}

function NoteEditForm({
  campaignId,
  note,
  characters,
  locations,
  onClose,
}: {
  campaignId: string;
  note: Note;
  characters: Character[];
  locations: Location[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  // Draft-persisted per note id (see lib/useFormDraft.ts) so an in-progress
  // edit survives navigating away. Unlike CreatureEditorPage.tsx's edit
  // mode — where the entity being edited arrives asynchronously from a
  // query fetch after mount — `note` here is already-loaded data handed in
  // synchronously when the modal opens, so useFormDraft's own lazy
  // initializer (which only runs when no draft is found in localStorage)
  // already gives the same "resumed draft wins, otherwise hydrate from the
  // note" behavior with no extra hydrate-effect needed.
  const draftKey = `draft:note:edit:${note.id}`;
  const [form, setForm, clearDraft] = useFormDraft<NoteFormValues>(draftKey, () => ({
    title: note.title,
    body: note.body,
    characterId: note.character_id ?? '',
    locationId: note.location_id ?? '',
    noteType: note.note_type,
    visibility: note.visibility,
  }));

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch<{ note: Note }>(`/campaigns/${campaignId}/notes/${note.id}`, {
        title: form.title,
        body: form.body,
        characterId: form.characterId || null,
        locationId: form.locationId || null,
        noteType: form.noteType,
        visibility: form.visibility,
      }),
    onSuccess: () => {
      clearDraft();
      void queryClient.invalidateQueries({ queryKey: ['notes', campaignId] });
      onClose();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    updateMutation.mutate();
  }

  return (
    <Modal open onClose={onClose} title={t('notes.editModalTitle')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('notes.titleLabel')} htmlFor="noteEditTitle">
          <Input id="noteEditTitle" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label={t('notes.bodyLabel')} htmlFor="noteEditBody">
          <Textarea
            id="noteEditBody"
            required
            rows={5}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          />
        </Field>
        <Field label={t('notes.linkedCharacterLabel')} htmlFor="noteEditCharacter">
          <select
            id="noteEditCharacter"
            value={form.characterId}
            onChange={(e) => setForm((f) => ({ ...f, characterId: e.target.value }))}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="">{t('notes.linkedCharacterNone')}</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('notes.linkedLocationLabel')} htmlFor="noteEditLocation">
          <select
            id="noteEditLocation"
            value={form.locationId}
            onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="">{t('notes.linkedLocationNone')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('notes.noteTypeLabel')} htmlFor="noteEditType">
          <select
            id="noteEditType"
            value={form.noteType}
            onChange={(e) => setForm((f) => ({ ...f, noteType: e.target.value as 'note' | 'ruling' }))}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="note">{t('notes.noteTypeNote')}</option>
            <option value="ruling">{t('notes.noteTypeRuling')}</option>
          </select>
        </Field>
        <Field label={t('notes.visibilityLabel')} htmlFor="noteEditVisibility">
          <select
            id="noteEditVisibility"
            value={form.visibility}
            onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value as GmVisibility }))}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="gm_only">{t('notes.visibilityGmOnly')}</option>
            <option value="revealed_to_players">{t('notes.visibilityRevealed')}</option>
            <option value="owner_only">{t('notes.visibilityOwnerOnly')}</option>
          </select>
        </Field>
        {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t('notes.saving') : t('notes.saveChanges')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('notes.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
