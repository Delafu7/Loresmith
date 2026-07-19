import { useEffect } from 'react';
import { useSocket } from './SocketContext';

// Joins campaign:{id} on mount/reconnect — every client joins this room per
// PLAN.md §5.1 ("every client joins on connect"). Re-joins automatically on
// socket reconnect since Socket.io rooms don't survive a transport drop.
export function useJoinCampaign(campaignId: number | undefined): void {
  const { socket, connected } = useSocket();

  useEffect(() => {
    if (!campaignId || !connected) return;
    const id = campaignId;

    socket.emit('join:campaign', { campaignId: id });

    function onConnect() {
      socket.emit('join:campaign', { campaignId: id });
    }
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [socket, connected, campaignId]);
}
