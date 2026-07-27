import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { Field, Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

export function LoginPage() {
  const { login, loginError } = useAuth();
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
        <h1 className="font-display text-2xl font-medium text-stone-100 mb-1">Sign in</h1>
        <p className="text-stone-400 text-sm mb-6">Continue your campaign.</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <PasswordInput
              id="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {loginError && (
            <p role="alert" className="text-sm text-red-400">
              {loginError}
            </p>
          )}

          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="text-stone-400 text-sm mt-6 text-center">
          No account?{' '}
          <Link to="/register" className="text-amber-500 hover:text-amber-400">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
