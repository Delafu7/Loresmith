import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSocket, type AppSocket } from './socket';
import { useAuth } from '../auth/AuthContext';

interface SocketContextValue {
  socket: AppSocket;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue | null>(null);

// Connects the single shared socket exactly once the user is authenticated
// (the handshake needs the session cookie already set), and disconnects on
// logout. Individual views (CampaignShell, the combat tracker) layer
// join:campaign / join:encounter on top of this connection.
export function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const socketRef = useRef<AppSocket>(getSocket());
  const [connected, setConnected] = useState(socketRef.current.connected);

  useEffect(() => {
    const socket = socketRef.current;

    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (isAuthenticated && !socket.connected) {
      socket.connect();
    }
    if (!isAuthenticated && socket.connected) {
      socket.disconnect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [isAuthenticated]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>{children}</SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
}
