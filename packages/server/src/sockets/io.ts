// Socket.io server setup + handshake auth. Wraps the SAME express-session
// middleware instance used by the REST API (via io.engine.use), so
// socket.request.session is the identical Redis-backed session a cookie
// already authenticated over HTTP — no separate WS auth scheme to keep in
// sync (PLAN.md §2: "same session store authenticates the Socket.io
// handshake, so auth logic isn't duplicated across REST and WS").

import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Server } from 'socket.io';
import { registerRoomHandlers } from './rooms.js';
import type { SocketData } from './types.js';

export function createSocketServer(httpServer: HttpServer, sessionMiddleware: RequestHandler, clientOrigin: string): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: clientOrigin,
      credentials: true,
    },
  });

  // engine.io requests are plain (req, res) Node http objects, which is
  // exactly express-session's expected middleware signature — this is the
  // documented way to share Express middleware with a Socket.io handshake.
  io.engine.use(sessionMiddleware);

  // Reject the handshake outright if there's no authenticated session,
  // rather than accepting the connection and disconnecting it after the
  // fact — an unauthenticated socket should never be able to observe even a
  // 'connection' event server-side.
  io.use((socket, next) => {
    const req = socket.request as { session?: { userId?: string } };
    const userId = req.session?.userId;
    if (!userId) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    (socket.data as SocketData).userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    registerRoomHandlers(io, socket);
  });

  return io;
}
