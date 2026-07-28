// Shared tiny types for the sockets layer, split into their own module so
// rooms.ts and broadcast.ts can both depend on them without an import cycle
// between each other.

/** Attached to socket.data during the io.use() auth handshake (see io.ts). */
export interface SocketData {
  userId: string;
}
