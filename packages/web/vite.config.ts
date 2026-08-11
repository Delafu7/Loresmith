import type { IncomingMessage } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The backend (packages/server/src/index.ts) mounts its routers at the HTTP
// root — /auth, /campaigns, /characters, /monster-instances, /encounters,
// /catalog, /health — NOT under an /api prefix. Rather than have the server
// remount everything (a real API-contract change), the dev proxy is adapted
// here to match wherever the server actually serves routes: one proxy entry
// per top-level resource prefix, plus the Socket.io upgrade path.
const API_PREFIXES = ['/auth', '/me', '/campaigns', '/characters', '/monster-instances', '/encounters', '/effects', '/catalog', '/assets', '/uploads', '/health']

// Because there's no /api prefix, a few paths are genuinely ambiguous: e.g.
// GET /campaigns/1/characters is BOTH a real backend REST endpoint AND a
// real frontend route (CampaignShell's nested "characters"/"encounters"/
// "notes" routes — see App.tsx). The SPA's own fetch() calls to that exact
// path must still reach the backend, but a hard refresh or a pasted/bookmarked
// deep link to that same URL is a real BROWSER NAVIGATION for the page, not
// an API call, and must fall through to Vite's SPA index.html instead —
// otherwise the browser just shows raw JSON. Browsers tag navigations with
// `Accept: text/html...`; same-origin fetch()/XHR calls (this app's `api.ts`
// wrapper never sets an explicit Accept) get the browser's fetch default of
// `Accept: */*`, which doesn't start with 'text/html' — that's the signal
// `bypass` uses to tell the two apart. Found via Playwright-driven end-to-end
// verification: a hard navigation to /campaigns/:id/{characters,encounters,
// notes} was silently served as raw API JSON instead of the app.
function bypass(req: IncomingMessage) {
  if (req.headers.accept?.startsWith('text/html')) {
    return req.url
  }
}

// Operational backlog item "Offline rules/stat-block lookup" — scoped down
// to read-only CATALOG browsing (races/classes/spells/items/monsters/
// conditions/etc — rulebook-style reference data under GET /catalog/*),
// not full app offline: this app is live Postgres + Socket.io backed, so
// campaign/character/live-encounter data always needs a real connection and
// is deliberately NOT cached here — only /catalog/* responses are. The
// service worker also precaches the built app shell (JS/CSS/HTML) so the
// SPA itself still loads while offline, even though most of its data won't
// resolve without a connection.
const pwaPlugin = VitePWA({
  registerType: 'autoUpdate',
  // Caching-only service worker, not an installable-app manifest (no icons/
  // theme-color to source for that) — registered manually via
  // virtual:pwa-register/react, see src/lib/PwaUpdateNotifier.tsx.
  manifest: false,
  injectRegister: false,
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,woff2}'],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith('/catalog/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'catalog-data',
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
})

// Shared by both `vite dev` (server.proxy) and `vite preview` (preview.proxy
// — a separate config Vite does NOT default to server.proxy for). Testing a
// production build locally (e.g. to verify the PWA service worker, which
// only registers against a real build, not dev mode) needs `npm run preview`
// to reach the backend the same way `npm run dev` already does.
function makeApiProxy(prefixes: string[]) {
  return {
    ...Object.fromEntries(
      prefixes.map((prefix) => [prefix, { target: 'http://localhost:3001', changeOrigin: true, bypass }]),
    ),
    '/socket.io': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
  }
}

// `vite preview` serves the PRODUCTION BUILD's own JS/CSS from /assets/*
// (Vite's default build.assetsDir) — unlike `vite dev` (which never serves
// anything under that path; modules are served from their original source
// paths instead), proxying /assets/* under preview swallows the app's own
// built bundle into the backend's /assets API router (campaign asset
// uploads) instead of serving it as a static file, breaking the whole app.
// Found via a genuine 401 on the built JS bundle while verifying the PWA
// service worker locally. Dev mode has no such collision, so /assets stays
// proxied there; preview excludes it.
const previewApiProxy = makeApiProxy(API_PREFIXES.filter((prefix) => prefix !== '/assets'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), pwaPlugin],
  server: { proxy: makeApiProxy(API_PREFIXES) },
  preview: { proxy: previewApiProxy },
})
