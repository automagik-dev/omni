-- A2A + Internal Channel + AG-UI foundation migration
-- Adds: agents.agent_card, instances.agent_chain_to_instance_id, instances.chain_mode

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "agent_card" jsonb;

ALTER TABLE "instances"
  ADD COLUMN IF NOT EXISTS "agent_chain_to_instance_id" uuid
    REFERENCES "instances"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "chain_mode" varchar(20) NOT NULL DEFAULT 'off';
