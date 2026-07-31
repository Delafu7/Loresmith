import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import type { MeResponse } from '../auth/AuthContext';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { Card, CardKicker } from '../components/ui/Card';
import { Field, Input, useFieldId } from '../components/ui/Field';
import { PasswordInput } from '../components/PasswordInput';
import { Button } from '../components/ui/Button';
import { Portrait } from '../components/Portrait';
import { ErrorBanner, errorMessage } from '../components/Feedback';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/gif';

function useUpdateMe() {
  const queryClient = useQueryClient();
  return (user: User) =>
    queryClient.setQueryData<MeResponse>(['me'], (prev) => (prev ? { ...prev, user } : prev));
}

export function AccountTab() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex flex-col gap-4">
      <AvatarCard user={user} />
      <ProfileFieldsCard user={user} />
      <PasswordCard />
    </div>
  );
}

function AvatarCard({ user }: { user: User }) {
  const { t } = useLocale();
  const updateMe = useUpdateMe();
  const inputRef = useRef<HTMLInputElement>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload<{ user: User }>('/auth/me/avatar', formData);
    },
    onSuccess: (data) => updateMe(data.user),
    onSettled: () => {
      if (inputRef.current) inputRef.current.value = '';
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api.delete<{ user: User }>('/auth/me/avatar'),
    onSuccess: (data) => updateMe(data.user),
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setClientError(null);

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setClientError(t('upload.unsupportedFileType', { type: file.type || 'unknown' }));
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setClientError(t('upload.fileTooLarge', { maxMb: Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)) }));
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    uploadMutation.mutate(file);
  }

  const error = clientError ?? (uploadMutation.isError ? errorMessage(uploadMutation.error) : null);

  return (
    <Card>
      <CardKicker>{t('profile.avatarKicker')}</CardKicker>
      <div className="flex flex-wrap items-center gap-4">
        <Portrait fileUrl={user.avatarUrl} alt={user.displayName} size="xl" shape="circle" placeholderLabel={user.displayName} />
        <div className="flex flex-col items-start gap-2">
          <label
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md border border-stone-700 px-3 text-sm font-medium text-stone-300 hover:bg-stone-800 cursor-pointer ${
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
            {uploadMutation.isPending ? t('upload.uploading') : t('profile.changeAvatar')}
          </label>
          {user.avatarUrl && (
            <Button variant="ghost" size="sm" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate()}>
              {removeMutation.isPending ? t('profile.removingAvatar') : t('profile.removeAvatar')}
            </Button>
          )}
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
    </Card>
  );
}

function ProfileFieldsCard({ user }: { user: User }) {
  const { t } = useLocale();
  const updateMe = useUpdateMe();
  const nameId = useFieldId('displayName');
  const emailId = useFieldId('email');
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);

  const mutation = useMutation({
    mutationFn: () => api.patch<{ user: User }>('/auth/me/profile', { displayName, email }),
    onSuccess: (data) => updateMe(data.user),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || !email.trim()) return;
    mutation.mutate();
  }

  const dirty = displayName !== user.displayName || email !== user.email;

  return (
    <Card as="form" onSubmit={handleSubmit}>
      <CardKicker>{t('profile.accountDetailsKicker')}</CardKicker>
      <Field label={t('profile.displayNameLabel')} htmlFor={nameId}>
        <Input id={nameId} required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label={t('profile.emailLabel')} htmlFor={emailId}>
        <Input id={emailId} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {mutation.isError && <ErrorBanner message={errorMessage(mutation.error)} />}
      {mutation.isSuccess && !dirty && <p className="text-xs text-amber-500">{t('profile.saved')}</p>}
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={!dirty || mutation.isPending}>
          {mutation.isPending ? t('profile.saving') : t('common.save')}
        </Button>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useLocale();
  const currentId = useFieldId('currentPassword');
  const newId = useFieldId('newPassword');
  const confirmId = useFieldId('confirmPassword');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.patch<void>('/auth/me/password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
  });

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentPassword || newPassword.length < 8 || mismatch) return;
    mutation.mutate();
  }

  return (
    <Card as="form" onSubmit={handleSubmit}>
      <CardKicker>{t('profile.passwordKicker')}</CardKicker>
      <Field label={t('profile.currentPasswordLabel')} htmlFor={currentId}>
        <PasswordInput
          id={currentId}
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </Field>
      <Field label={t('profile.newPasswordLabel')} htmlFor={newId} hint={t('profile.newPasswordHint')}>
        <PasswordInput
          id={newId}
          required
          minLength={8}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Field>
      <Field label={t('profile.confirmPasswordLabel')} htmlFor={confirmId} error={mismatch ? t('profile.passwordMismatch') : undefined}>
        <PasswordInput
          id={confirmId}
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </Field>
      {mutation.isError && <ErrorBanner message={errorMessage(mutation.error)} />}
      {mutation.isSuccess && <p className="text-xs text-amber-500">{t('profile.passwordUpdated')}</p>}
      <div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!currentPassword || newPassword.length < 8 || mismatch || mutation.isPending}
        >
          {mutation.isPending ? t('profile.saving') : t('profile.updatePassword')}
        </Button>
      </div>
    </Card>
  );
}
