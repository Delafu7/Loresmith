import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { PasswordInput } from '../components/PasswordInput';
import { LocalePicker } from '../components/LocalePicker';
import { Field, Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

export function RegisterPage() {
  const { register, registerError } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register(email, displayName, password);
      navigate('/', { replace: true });
    } catch {
      // error surfaced via registerError below
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-stone-950 px-4 py-[max(1rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm bg-stone-900 rounded-lg p-6 sm:p-8 shadow-md">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="font-display text-2xl font-medium text-stone-100">{t('register.title')}</h1>
          <LocalePicker />
        </div>
        <p className="text-stone-400 text-sm mb-6">{t('register.subtitle')}</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label={t('register.displayName')} htmlFor="displayName">
            <Input
              id="displayName"
              type="text"
              required
              minLength={1}
              maxLength={200}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label={t('register.email')} htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t('register.password')} htmlFor="password" hint={t('register.passwordHint')}>
            <PasswordInput
              id="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              showPasswordLabel={t('login.showPassword')}
              hidePasswordLabel={t('login.hidePassword')}
            />
          </Field>

          {registerError && (
            <p role="alert" className="text-sm text-red-400">
              {registerError}
            </p>
          )}

          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? t('register.submitting') : t('register.submit')}
          </Button>
        </form>

        <p className="text-stone-400 text-sm mt-6 text-center">
          {t('register.haveAccount')}{' '}
          <Link to="/login" className="text-amber-500 hover:text-amber-400">
            {t('register.signIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
