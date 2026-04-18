-- Add `handoff_fields` jsonb column to `handoff_logs`.
-- Stores structured key-value pairs from the agent for Gupshup flow variable mapping
-- (e.g. nome → var_global.name, temperatura_lead → var_global.calor_do_lead).

ALTER TABLE "handoff_logs" ADD COLUMN "handoff_fields" jsonb;