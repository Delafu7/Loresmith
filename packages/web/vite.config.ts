import type { IncomingMessage } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      ...Object.fromEntries(
        API_PREFIXES.map((prefix) => [prefix, { target: 'http://localhost:3001', changeOrigin: true, bypass }]),
      ),
      '/socket.io': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
    },
  },
})
