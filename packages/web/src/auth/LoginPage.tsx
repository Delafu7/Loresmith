import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PasswordInput } from '../components/PasswordInput';

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
    <div className="min-h-screen flex items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-sm bg-stone-900 border border-stone-800 rounded-xl p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-stone-100 mb-1">Sign in</h1>
        <p className="text-stone-400 text-sm mb-6">Continue your campaign.</p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {loginError && (
            <p role="alert" className="text-sm text-red-400">
              {loginError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-stone-950 font-semibold py-2 transition-colors"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
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
