// Shared multipart image-upload control (PLAN.md §6.6's ImageUploadField).
// Only ever rendered by a caller when `editable` is true — matches every
// other panel's `{editable && <Thing />}` convention (see
// CharacterSheetPage.tsx's HP/ability-score sections) rather than taking an
// `editable` prop itself.

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignAsset } from '../lib/types';
import { ErrorBanner, errorMessage } from './Feedback';

// Mirrors the server's allowlist (packages/server/src/middleware/upload.ts's
// MIME_EXTENSIONS) and its default MAX_UPLOAD_BYTES (packages/server/src/
// middleware/upload.ts, overridable server-side via the MAX_UPLOAD_BYTES env
// var). This is a UX nicety only — the server re-validates both and is the
// actual authority, so a mismatch here (e.g. a deployment that raised the
// env var) just means an oversized/wrong-type file gets a client-side
// rejection message instead of a server round-trip, never a security gap.
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/gif';

export function ImageUploadField({
  campaignId,
  characterId,
  title,
  visibleToPlayers,
  onUploaded,
  label = 'Upload image',
}: {
  campaignId: number;
  /** Set to target this upload at a specific character's portrait (POST body's `characterId` field). */
  characterId?: number;
  title?: string;
  visibleToPlayers?: boolean;
  onUploaded: (asset: CampaignAsset) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  // onSuccess is passed to mutate() below rather than here: useMutation's own
  // options are rebound to the latest render on every render (by design, so
  // that e.g. onSuccess closures always see fresh props) — but that means if
  // this same component instance were ever kept mounted across a change of
  // `characterId`/`onUploaded` (e.g. a future "next character" nav that
  // doesn't remount the page) while an upload was still in flight, the
  // callback that eventually fires would close over the NEW target, not the
  // one this upload was actually for. Binding the callback at the mutate()
  // call site instead guarantees it stays tied to the props active when the
  // upload was started, no matter what re-renders happen while it's pending.
  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      if (characterId !== undefined) formData.append('characterId', String(characterId));
      if (title) formData.append('title', title);
      if (visibleToPlayers !== undefined) formData.append('visibleToPlayers', String(visibleToPlayers));
      return api.upload<{ asset: CampaignAsset }>(`/campaigns/${campaignId}/assets`, formData);
    },
    onSettled: () => {
      if (inputRef.current) inputRef.current.value = '';
    },
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setClientError(null);

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setClientError(`Unsupported file type: ${file.type || 'unknown'}. Use PNG, JPEG, WEBP, or GIF.`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setClientError(`File is too large — max ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    uploadMutation.mutate(file, {
      onSuccess: (data) => onUploaded(data.asset),
    });
  }

  const error = clientError ?? (uploadMutation.isError ? errorMessage(uploadMutation.error) : null);

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <label
        className={`inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2 py-1 text-xs font-medium text-stone-300 hover:bg-stone-800 cursor-pointer ${
          uploadMutation.isPending ? 'opacity-60 pointer-events-none' : ''
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="sr-only"
          disabled={uploadMutation.isPending}
          onChange={handleChange}
        />
        {uploadMutation.isPending ? 'Uploading…' : label}
      </label>
      {error && <ErrorBanner message={error} />}
    </div>
  );
}
