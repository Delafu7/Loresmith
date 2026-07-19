export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-stone-400 text-sm" role="status">
      {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-red-800 bg-red-950/50 text-red-300 text-sm px-4 py-3">
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="text-stone-500 text-sm italic py-6 text-center">{message}</p>;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
