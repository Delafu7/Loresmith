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
import { Badge } from '../components/ui/Badge';

export function NotesPage() {
  const { campaignId, role } = useCampaignShell();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const notesQuery = useQuery({
    queryKey: ['notes', campaignId],
    queryFn: () => api.get<{ notes: Note[] }>(`/campaigns/${campaignId}/notes`),
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // Only meaningful for the DM — per the notes service, players are always
  // forced to visible_to_players=true and can never hide a note from the
  // table, so the toggle is never even rendered for a player creating one.
  const [visibleToPlayers, setVisibleToPlayers] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ note: Note }>(`/campaigns/${campaignId}/notes`, {
        title,
        body,
        visibleToPlayers: role === 'dm' ? visibleToPlayers : undefined,
      }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setVisibleToPlayers(false);
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['notes', campaignId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: number) => api.delete(`/campaigns/${campaignId}/notes/${noteId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notes', campaignId] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
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
            <Input id="noteTitle" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Body" htmlFor="noteBody">
            <Textarea id="noteBody" required rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {role === 'dm' && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={visibleToPlayers}
                onChange={(e) => setVisibleToPlayers(e.target.checked)}
                className="size-4"
              />
              Visible to players
            </label>
          )}
          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving…' : 'Save note'}
          </Button>
        </Card>
      )}

      {notesQuery.isLoading && <Loading />}
      {notesQuery.isError && <ErrorBanner message={errorMessage(notesQuery.error)} />}
      {notesQuery.data && notesQuery.data.notes.length === 0 && <EmptyState message="No notes yet." />}

      <ul className="space-y-3">
        {notesQuery.data?.notes.map((note) => {
          const canModify = role === 'dm' || note.author_user_id === user?.id;
          return (
            <li key={note.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-stone-100">{note.title}</h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {role === 'dm' && (
                      <Badge variant={note.visible_to_players ? 'accent' : 'neutral'}>
                        {note.visible_to_players ? 'Visible to players' : 'DM only'}
                      </Badge>
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
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
