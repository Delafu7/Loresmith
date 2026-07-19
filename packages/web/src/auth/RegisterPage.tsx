import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PasswordInput } from '../components/PasswordInput';

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
    <div className="min-h-screen flex items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-sm bg-stone-900 border border-stone-800 rounded-xl p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-stone-100 mb-1">Create an account</h1>
        <p className="text-stone-400 text-sm mb-6">Join or start a campaign.</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-stone-300 mb-1">
              Display name
            </label>
            <input
              id="displayName"
              type="text"
              required
              minLength={1}
              maxLength={200}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-600"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-stone-300 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-600"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-stone-300 mb-1">
              Password
            </label>
            <PasswordInput
              id="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-stone-500 mt-1">At least 8 characters.</p>
          </div>

          {registerError && (
            <p role="alert" className="text-sm text-red-400">
              {registerError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-stone-950 font-semibold py-2 transition-colors"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
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
