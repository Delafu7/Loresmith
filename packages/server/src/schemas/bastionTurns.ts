import { z } from 'zod';

const orderInputSchema = z.object({
  facilityId: z.string().min(1),
  payReroll: z.boolean().optional().default(false),
  // Freeform note on which Craft/Harvest/Research/etc. sub-option was
  // chosen (e.g. "crafted a Potion of Healing") — this app tracks resource
  // bookkeeping (BP/GP/orders), not narrative resolution of an order's
  // output; that stays DM/player-adjudicated (docs/rules/bastions.md §6's
  // own framing). Stored as-is in bastion_orders.result.
  resultNote: z.string().max(2000).optional(),
});

export const resolveBastionTurnSchema = z
  .object({
    // Anchors to campaign_events.in_game_day's convention — the caller
    // supplies the campaign's current day, matching this app's existing
    // "no auto-advance" manual-time-passage design (no background clock).
    inGameDay: z.number().int(),
    maintain: z.boolean().optional().default(false),
    orders: z.array(orderInputSchema).default([]),
  })
  .refine((v) => v.maintain !== v.orders.length > 0, {
    message: 'A turn must either choose Maintain or issue at least one per-facility order, never both, never neither',
  });
export type ResolveBastionTurnInput = z.infer<typeof resolveBastionTurnSchema>;
