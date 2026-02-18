ALTER TABLE "access_rules" ALTER COLUMN "rule_type" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "access_rules" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
CREATE INDEX "idx_access_rules_pairing" ON "access_rules" USING btree ("instance_id","rule_type","expires_at");