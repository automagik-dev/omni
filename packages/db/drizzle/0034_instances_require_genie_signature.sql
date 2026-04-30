-- Per-instance signature enforcement opt-in (omni-host-fingerprint-trust wish, Group 6).
--
-- Adds `instances.require_genie_signature` (default false). When true, any
-- request that targets the instance MUST carry a verified `X-Genie-Signature`
-- (see middleware/genie-signature.ts). Bearer-only requests get 401.
--
-- This flips the verification middleware from "verify when present" to
-- "require always" on a per-instance basis. Default is false so the rollout
-- stays additive — existing bearer flows keep working until an operator
-- explicitly opts the instance in via:
--
--   omni instances update <id> --require-genie-signature
--
-- Hand-written (not `drizzle-kit generate`) to avoid the gupshup column
-- rename prompts that block non-interactive runs in this repo.

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "require_genie_signature" boolean DEFAULT false NOT NULL;
