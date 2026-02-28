ALTER TABLE "batch_jobs" ALTER COLUMN "total_cost_usd" SET DATA TYPE numeric(15, 6);--> statement-breakpoint
ALTER TABLE "media_content" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(15, 6);