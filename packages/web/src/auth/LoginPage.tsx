import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { PasswordInput } from '../components/PasswordInput';
import { LocalePicker } from '../components/LocalePicker';
import { Field, Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

export function LoginPage() {
  const { login, loginError } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/home';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch {
      // error surfaced via loginError below
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-stone-950 px-4 py-[max(1rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-sm bg-stone-900 rounded-lg p-6 sm:p-8 shadow-md">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="font-display text-2xl font-medium text-stone-100">{t('login.title')}</h1>
          <LocalePicker />
        </div>
        <p className="text-stone-400 text-sm mb-6">{t('login.subtitle')}</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label={t('login.email')} htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t('login.password')} htmlFor="password">
            <PasswordInput
              id="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              showPasswordLabel={t('login.showPassword')}
              hidePasswordLabel={t('login.hidePassword')}
            />
          </Field>

          {loginError && (
            <p role="alert" className="text-sm text-red-400">
              {loginError}
            </p>
          )}

          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>

        <p className="text-stone-400 text-sm mt-6 text-center">
          {t('login.noAccount')}{' '}
          <Link to="/register" className="text-amber-500 hover:text-amber-400">
            {t('login.register')}
          </Link>
        </p>
      </div>
    </div>
  );
}
