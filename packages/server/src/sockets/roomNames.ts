// Room-name helpers only, split out from rooms.ts so broadcast.ts can import
// them without creating a rooms.ts <-> broadcast.ts import cycle (rooms.ts
// needs broadcast.ts's buildFullStateSyncPayload, and broadcast.ts needs
// these room names).

export function campaignRoom(campaignId: string): string {
  return `campaign:${campaignId}`;
}

export function encounterRoom(encounterId: string): string {
  return `encounter:${encounterId}`;
}
