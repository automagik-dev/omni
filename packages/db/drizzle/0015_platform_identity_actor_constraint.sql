-- Safety guard: validate no rows violate XOR before adding constraint (council-mandated)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM platform_identities WHERE person_id IS NOT NULL AND agent_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot add actor XOR constraint: % rows have both person_id and agent_id set',
      (SELECT COUNT(*) FROM platform_identities WHERE person_id IS NOT NULL AND agent_id IS NOT NULL);
  END IF;
END $$;--> statement-breakpoint
-- Add CHECK constraint: personId and agentId are mutually exclusive (at most one non-null)
-- Both null is valid (unresolved/system identity), one set is valid, both set is invalid.
ALTER TABLE "platform_identities"
  ADD CONSTRAINT "platform_identities_actor_xor"
  CHECK (
    NOT (person_id IS NOT NULL AND agent_id IS NOT NULL)
  );
