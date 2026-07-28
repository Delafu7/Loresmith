import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Note } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input, Textarea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { formatTimestamp } from '../lib/dates';
import { useFormDraft } from '../lib/useFormDraft';

interface NoteFormValues {
  title: string;
  body: string;
}

function emptyNoteForm(): NoteFormValues {
  return { title: '', body: '' };
}

export function NotesPage() {
  const { campaignId, role } = useCampaignShell();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  const notesQuery = useQuery({
    queryKey: ['notes', campaignId],
    queryFn: () => api.get<{ notes: Note[] }>(`/campaigns/${campaignId}/notes`),
  });

  // Draft-persisted create form (see lib/useFormDraft.ts) so a half-written
  // note survives an accidental navigation away.
  const [form, setForm, clearDraft] = useFormDraft(`draft:note:new:${campaignId}`, emptyNoteForm);

  const createMutation = useMutation({
    mutationFn: () => api.post<{ note: Note }>(`/campaigns/${campaignId}/notes`, { title: form.title, body: form.body }),
    onSuccess: () => {
      setForm(emptyNoteForm());
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

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-medium">Notes</h2>
        <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : 'New note'}
        </Button>
      </div>

      {showCreate && (
        <Card as="form" onSubmit={handleCreate} className="mb-6 gap-4">
          <Field label="Title" htmlFor="noteTitle">
            <Input id="noteTitle" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="Body" htmlFor="noteBody">
            <Textarea id="noteBody" required rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          </Field>
          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving…' : 'Save note'}
          </Button>
        </Card>
      )}

      {notesQuery.isLoading && <Loading />}
      {notesQuery.isError && <ErrorBanner message={errorMessage(notesQuery.error)} />}
      {notesQuery.data && notesQuery.data.notes.length === 0 && <EmptyState message="No notes yet." />}

      {(deleteMutation.isError || duplicateMutation.isError) && (
        <ErrorBanner message={errorMessage((deleteMutation.error ?? duplicateMutation.error) as unknown)} />
      )}

      <ul className="space-y-3">
        {notesQuery.data?.notes.map((note) => {
          const canModify = role === 'dm' || note.author_user_id === user?.id;
          return (
            <li key={note.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-stone-100">{note.title}</h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canModify && (
                      <button
                        type="button"
                        onClick={() => setEditingNote(note)}
                        className="min-h-11 px-1 text-amber-500 hover:text-amber-400 text-xs"
                      >
                        Edit
                      </button>
                    )}
                    {canModify && (
                      <button
                        type="button"
                        onClick={() => duplicateMutation.mutate(note.id)}
                        disabled={duplicateMutation.isPending}
                        className="min-h-11 px-1 text-stone-300 hover:text-stone-100 text-xs disabled:opacity-50"
                      >
                        Duplicate
                      </button>
                    )}
                    {canModify && (
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(note.id)}
                        className="min-h-11 px-1 text-red-400 hover:text-red-300 text-xs"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-stone-300 whitespace-pre-wrap">{note.body}</p>
                <p className="text-xs text-stone-500">
                  Created {formatTimestamp(note.created_at)} · Updated {formatTimestamp(note.updated_at)}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>

      <NoteEditModal campaignId={campaignId} note={editingNote} onClose={() => setEditingNote(null)} />
    </div>
  );
}

// Note-only edit modal (Modal + PATCH-on-submit, mirroring
// CatalogEditorPage.tsx's CatalogEntryModal convention) — kept as a small
// inline sub-component rather than a generic abstraction, since Notes only
// ever edits two fields. Split into a hook-free wrapper + the actual form
// (same shape as CatalogEntryModal/CatalogEntryForm) so the form only ever
// MOUNTS once a real note is being edited — otherwise a single long-lived
// component instance would keep whatever draft key/values it first mounted
// with even after `note` changes underneath it.
function NoteEditModal({ campaignId, note, onClose }: { campaignId: string; note: Note | null; onClose: () => void }) {
  if (note === null) return null;
  return <NoteEditForm campaignId={campaignId} note={note} onClose={onClose} />;
}

function NoteEditForm({ campaignId, note, onClose }: { campaignId: string; note: Note; onClose: () => void }) {
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
  const [form, setForm, clearDraft] = useFormDraft<NoteFormValues>(draftKey, () => ({ title: note.title, body: note.body }));

  const updateMutation = useMutation({
    mutationFn: () => api.patch<{ note: Note }>(`/campaigns/${campaignId}/notes/${note.id}`, { title: form.title, body: form.body }),
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
    <Modal open onClose={onClose} title="Edit note">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Title" htmlFor="noteEditTitle">
          <Input id="noteEditTitle" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="Body" htmlFor="noteEditBody">
          <Textarea
            id="noteEditBody"
            required
            rows={5}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          />
        </Field>
        {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
