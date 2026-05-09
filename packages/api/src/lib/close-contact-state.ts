/**
 * Shared predicate for "chat is currently in an active close-contact state."
 *
 * `chats.settings.closeOutcome` is audit data — set when a close-contact fires,
 * preserved across cooldown expiry, only cleared by `POST /chats/:id/reopen-contact`.
 * It is NOT a reliable signal of "the chat is currently muted" because the
 * dispatcher's close-contact gate (`applyCloseContactGate` in
 * `plugins/agent-dispatcher.ts`) auto-clears `closeUntil` when the soft cooldown
 * expires while leaving `closeOutcome` in place for BI consumers.
 *
 * The semantically correct predicate for "should I treat this chat as closed
 * right now?" mirrors the dispatcher gate's skip conditions:
 *
 *   - `closed === true`  → hard terminal (`won` / `lost`, or auto-promoted soft).
 *                          Only `/reopen-contact` clears it.
 *   - `closeUntil > now` → soft cooldown still in window. Auto-clears when the
 *                          dispatcher next observes it expired.
 *
 * Anything else (cleared `closeUntil`, no `closed`, leftover `closeOutcome` audit)
 * means the chat is already operating normally; the only thing left from the
 * close is the audit trail. A subsequent agent reply that follows a customer
 * comeback after expiry should arm follow-up like any other normal reply.
 *
 * Keep this in sync with the dispatcher gate predicate at
 * `plugins/agent-dispatcher.ts:applyCloseContactGate` (TODO: refactor that path
 * to call this helper directly to remove the duplication).
 */

import type { ChatSettings } from '@omni/db';

export function isChatInActiveCloseState(settings: ChatSettings | null | undefined): boolean {
  if (!settings) return false;
  if ((settings as { closed?: unknown }).closed === true) return true;
  const closeUntil = (settings as { closeUntil?: unknown }).closeUntil;
  if (typeof closeUntil === 'string' && closeUntil.length > 0) {
    const ms = new Date(closeUntil).getTime();
    if (Number.isFinite(ms) && Date.now() < ms) return true;
  }
  return false;
}
