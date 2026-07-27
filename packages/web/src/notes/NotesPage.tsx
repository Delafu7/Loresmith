import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Note } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';

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
        <h2 className="text-lg font-semibold">Notes</h2>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold px-4 py-2 text-sm"
        >
          {showCreate ? 'Cancel' : 'New note'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 bg-stone-900 border border-stone-800 rounded-lg p-5 space-y-4">
          <div>
            <label htmlFor="noteTitle" className="block text-sm font-medium text-stone-300 mb-1">
              Title
            </label>
            <input
              id="noteTitle"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label htmlFor="noteBody" className="block text-sm font-medium text-stone-300 mb-1">
              Body
            </label>
            <textarea
              id="noteBody"
              required
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100"
            />
          </div>
          {role === 'dm' && (
            <label className="flex items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={visibleToPlayers}
                onChange={(e) => setVisibleToPlayers(e.target.checked)}
              />
              Visible to players
            </label>
          )}
          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-stone-950 font-semibold px-4 py-2 text-sm"
          >
            {createMutation.isPending ? 'Saving…' : 'Save note'}
          </button>
        </form>
      )}

      {notesQuery.isLoading && <Loading />}
      {notesQuery.isError && <ErrorBanner message={errorMessage(notesQuery.error)} />}
      {notesQuery.data && notesQuery.data.notes.length === 0 && <EmptyState message="No notes yet." />}

      <ul className="space-y-3">
        {notesQuery.data?.notes.map((note) => {
          const canModify = role === 'dm' || note.author_user_id === user?.id;
          return (
            <li key={note.id} className="rounded-lg border border-stone-800 bg-stone-900 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-stone-100">{note.title}</h3>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {role === 'dm' && (
                    <span
                      className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                        note.visible_to_players ? 'bg-emerald-900 text-emerald-300' : 'bg-stone-800 text-stone-500'
                      }`}
                    >
                      {note.visible_to_players ? 'Visible to players' : 'DM only'}
                    </span>
                  )}
                  {canModify && (
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(note.id)}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-stone-300 mt-2 whitespace-pre-wrap">{note.body}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
