// Operational backlog item "Offline rules/stat-block lookup" — this app had
// NO error boundary anywhere before this. That was invisible as long as
// every query failure was always something a component checked for
// explicitly (query.isError -> <ErrorBanner/>), but going offline changed
// the failure shape: a live-data fetch (campaign details, characters,
// Socket.io's handshake, ...) can now reject with a raw network TypeError
// in a place nothing was built to expect one, blanking the whole page
// before a user ever reaches the cached, still-perfectly-usable rules
// catalog underneath. A class component is still the only way to catch a
// render-time error in React — no hook exists for this.
//
// Deliberately minimal: this is a last-resort safety net, not a redesign of
// every component's error handling — the fallback UI is plain, hardcoded
// English (not run through useLocale/i18n) since by the time this renders
// something has already gone wrong badly enough that leaning on more app
// machinery would be exactly backwards.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught a render-time error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-950 px-4">
          <div className="max-w-sm text-center space-y-3">
            <h1 className="font-display text-lg text-stone-100">Something went wrong</h1>
            <p className="text-sm text-stone-400">
              {navigator.onLine
                ? this.state.error.message
                : 'This part of the app needs a connection. Cached content (like the rules catalog) may still work.'}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-500"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
