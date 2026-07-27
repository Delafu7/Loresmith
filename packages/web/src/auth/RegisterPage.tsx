import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { Field, Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

export function RegisterPage() {
  const { register, registerError } = useAuth();
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
        <h1 className="font-display text-2xl font-medium text-stone-100 mb-1">Create an account</h1>
        <p className="text-stone-400 text-sm mb-6">Join or start a campaign.</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="Display name" htmlFor="displayName">
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
          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <PasswordInput
              id="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {registerError && (
            <p role="alert" className="text-sm text-red-400">
              {registerError}
            </p>
          )}

          <Button type="submit" variant="primary" block disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="text-stone-400 text-sm mt-6 text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-amber-500 hover:text-amber-400">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
