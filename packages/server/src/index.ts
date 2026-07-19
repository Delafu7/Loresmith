// App entrypoint. Loads .env via `dotenv -e ../../.env` in the npm scripts
// (see package.json dev/start) — this file only reads already-populated
// process.env, it never calls dotenv itself.

import http from 'node:http';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { redisClient } from './db/redis.js';
import { createSocketServer } from './sockets/io.js';
// src/types/session.d.ts augments express-session's SessionData with
// `userId` — an ambient .d.ts, picked up automatically by the TS program
// (tsconfig's `include: ["src"]"`) without needing an explicit import here.

import { authRouter } from './routes/auth.js';
import { campaignsRouter } from './routes/campaigns.js';
import { campaignCharactersRouter, charactersRouter } from './routes/characters.js';
import { catalogRouter } from './routes/catalog.js';
import {
  campaignMonsterInstancesRouter,
  campaignMonstersRouter,
  monsterCatalogRouter,
  monsterInstancesRouter,
} from './routes/monsters.js';
import { campaignEncountersRouter, encountersRouter } from './routes/encounters.js';
import { encounterEffectsRouter, effectsRouter } from './routes/effects.js';
import { campaignRestsRouter } from './routes/rests.js';
import { notesRouter } from './routes/notes.js';
import { diceRollsRouter } from './routes/diceRolls.js';
import { campaignAssetsRouter, assetsRouter } from './routes/assets.js';
import { dashboardRouter } from './routes/dashboard.js';
import { UPLOAD_ROOT } from './middleware/upload.js';
import { errorHandler } from './middleware/errors.js';
import { requireCsrfHeader } from './middleware/csrf.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set (expected to be loaded from the repo-root .env)`);
  }
  return value;
}

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = requireEnv('CLIENT_ORIGIN');
const SESSION_SECRET = requireEnv('SESSION_SECRET');

async function main(): Promise<void> {
  await redisClient.connect();

  const app = express();
  app.disable('x-powered-by');

  app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
  app.use(express.json());

  // Pulled into a named const (not inlined into app.use) so the exact same
  // middleware instance can also be handed to io.engine.use() below — the
  // Socket.io handshake authenticates via the identical Redis-backed session
  // cookie the REST API uses, rather than a second auth mechanism.
  const sessionMiddleware = session({
    store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'connect.sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Cookies cross-port in dev (client :5173 -> server :3001) run over
      // plain http, so Secure would silently drop the cookie; only require
      // it once this actually deploys behind TLS.
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    },
  });
  app.use(sessionMiddleware);
  app.use(requireCsrfHeader);

  // Static asset reads (uploaded images) — after session/CSRF is fine since
  // these are just GETs, no per-request auth check on read (a campaign
  // member's browser loads these directly via <img src>, which can't attach
  // the custom X-Requested-With header requireCsrfHeader wants for
  // state-changing requests anyway, and GET is already exempt there). The
  // /uploads prefix doesn't collide with any other route mounted below, so
  // position relative to those doesn't matter — this just needs to be
  // before the unconditional 404 handler at the bottom.
  app.use('/uploads', express.static(UPLOAD_ROOT));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/auth', authRouter);
  app.use('/me', dashboardRouter);

  // Nested-under-campaign resource routers — mounted before the generic
  // /campaigns router so their more specific paths are matched first.
  app.use('/campaigns/:id/characters', campaignCharactersRouter);
  app.use('/campaigns/:id/monster-instances', campaignMonsterInstancesRouter);
  app.use('/campaigns/:id/monsters', campaignMonstersRouter);
  app.use('/campaigns/:id/encounters', campaignEncountersRouter);
  app.use('/campaigns/:id/notes', notesRouter);
  app.use('/campaigns/:id/dice-rolls', diceRollsRouter);
  app.use('/campaigns/:id/rests', campaignRestsRouter);
  app.use('/campaigns/:id/assets', campaignAssetsRouter);
  app.use('/campaigns', campaignsRouter); // handles /, /:id, /:id/members, /:id/sessions itself

  // Flat resource-id-keyed routers. encounterEffectsRouter is mounted
  // alongside encountersRouter at the same '/encounters' prefix (unmatched
  // requests fall through to the next router registered at that prefix) —
  // kept in its own file/router since effects were added in a later phase.
  app.use('/characters', charactersRouter);
  app.use('/monster-instances', monsterInstancesRouter);
  app.use('/encounters', encountersRouter);
  app.use('/encounters', encounterEffectsRouter);
  app.use('/effects', effectsRouter);
  app.use('/assets', assetsRouter);

  // Read-only catalog/reference data.
  app.use('/catalog/monsters', monsterCatalogRouter);
  app.use('/catalog', catalogRouter);

  // 404 for anything unmatched above.
  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}`, details: null } });
  });

  app.use(errorHandler);

  // http.createServer(app) instead of app.listen(...) so Socket.io can
  // attach to the SAME underlying HTTP server (one port, one process) rather
  // than standing up a second listener.
  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer, sessionMiddleware, CLIENT_ORIGIN);
  // Route handlers reach the socket server via req.app.get('io') (see
  // src/sockets/broadcast.ts's getIo helper) rather than a module-level
  // singleton import, so there's no import-order coupling between routes
  // and this bootstrap file.
  app.set('io', io);

  httpServer.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('[server] Fatal startup error', err);
  process.exitCode = 1;
});
