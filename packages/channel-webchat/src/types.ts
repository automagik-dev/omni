/**
 * Webchat request schemas — the only external boundary is the visitor's browser.
 */

import { z } from 'zod';

/** Browser-generated visitor id (kept in localStorage). Also used as the Omni chatId. */
export const VisitorIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, 'visitorId must be 8-64 chars of [A-Za-z0-9_-]');

export const WebchatSendRequestSchema = z.object({
  visitorId: VisitorIdSchema,
  name: z.string().trim().min(1).max(80).optional(),
  text: z.string().trim().min(1).max(4000),
});
export type WebchatSendRequest = z.infer<typeof WebchatSendRequestSchema>;

/** What the widget receives on the SSE stream (`event: message`). */
export interface WebchatOutboundEvent {
  id: string;
  text: string;
  at: number;
}
