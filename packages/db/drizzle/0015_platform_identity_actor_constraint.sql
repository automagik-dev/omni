-- Add CHECK constraint: personId and agentId are mutually exclusive (at most one non-null)
-- Both null is valid (unresolved/system identity), one set is valid, both set is invalid.
ALTER TABLE "platform_identities"
  ADD CONSTRAINT "platform_identities_actor_xor"
  CHECK (
    NOT (person_id IS NOT NULL AND agent_id IS NOT NULL)
  );
