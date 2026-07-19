import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from './socketTypes';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

// Single shared socket for the whole app lifetime, connected lazily once the
// user is authenticated (session cookie already set). Uses the same-origin
// path so the Vite dev proxy (`/socket.io` -> :3001, see vite.config.ts)
// forwards the upgrade to the backend. autoConnect:false so SocketProvider
// controls exactly when the handshake happens.
export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({
      autoConnect: false,
      withCredentials: true,
    });
  }
  return socket;
}
