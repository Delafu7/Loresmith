// Thin fetch wrapper for the REST API. Routes are mounted at the server's
// root (see packages/server/src/index.ts — /auth, /campaigns, /characters,
// /monster-instances, /encounters, /catalog), NOT under /api, so paths here
// are relative to root and the Vite dev proxy (vite.config.ts) forwards each
// of those prefixes to the backend. `credentials: 'include'` is required on
// every call so the session cookie round-trips cross-port in dev.

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      // CSRF defense-in-depth per PLAN.md §4.1: SameSite=Lax on the session
      // cookie already blocks cross-site POSTs in modern browsers, but a
      // custom header can't be set by a plain cross-site form submission at
      // all (only same-origin fetch/XHR can add it), so the server requires
      // it on every state-changing request as a second, independent check.
      'X-Requested-With': 'XMLHttpRequest',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const errBody = body as ErrorBody | undefined;
    throw new ApiError(
      res.status,
      errBody?.error?.code ?? 'UNKNOWN',
      errBody?.error?.message ?? res.statusText,
      errBody?.error?.details,
    );
  }

  return body as T;
}

// Multipart upload wrapper (POST /campaigns/:id/assets). Deliberately bypasses
// the shared `request()` helper above rather than special-casing it, because
// `request()` unconditionally sets `Content-Type: application/json` whenever a
// body is present — for a FormData body the browser must compute its own
// `Content-Type: multipart/form-data; boundary=...` header, and manually
// setting it (to anything, including omitting it wrong) breaks the boundary
// parsing server-side. `credentials: 'include'` and the CSRF header are kept
// exactly as every other mutating call gets them.
async function upload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: formData,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const errBody = body as ErrorBody | undefined;
    throw new ApiError(
      res.status,
      errBody?.error?.code ?? 'UNKNOWN',
      errBody?.error?.message ?? res.statusText,
      errBody?.error?.details,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload,
};
