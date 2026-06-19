-- #384: Drop inbound rate limiter on the dispatcher.
--
-- The `trigger_rate_limit` column gated raw inbound `message.received` events
-- (default 5 msgs / 60s per user-channel-instance) before they reached the
-- `MessageDebouncer`. Fast-typed conversational bursts — natural on WhatsApp —
-- routinely exceeded the cap and the limiter silently dropped messages with no
-- feedback, retry, or DLQ, corrupting agent context downstream.
--
-- The debouncer already collapses bursts into a single dispatch (messageCount:N),
-- so this cap was both redundant and actively harmful. The `RateLimiter` class,
-- inbound+reaction rate gates, and `trigger_rate_limit` column are all removed.
-- If backend-protection caps are later needed, they must be dispatch-level
-- (counting completed agent runs), not message-level.

ALTER TABLE "instances" DROP COLUMN "trigger_rate_limit";
