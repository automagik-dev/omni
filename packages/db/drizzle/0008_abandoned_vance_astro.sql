CREATE TABLE "social_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"external_id" varchar(255) NOT NULL,
	"author_person_id" uuid,
	"author_platform_identity_id" uuid,
	"author_platform_user_id" varchar(255),
	"author_display_name" varchar(255),
	"text_content" text,
	"media_url" text,
	"mentions" jsonb,
	"like_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"reactions" jsonb,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"platform_timestamp" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "social_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"person_id" uuid,
	"platform_identity_id" uuid,
	"platform_user_id" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"connection_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"message" text,
	"connected_at" timestamp,
	"requested_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_engagement_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"repost_count" integer DEFAULT 0 NOT NULL,
	"impression_count" integer DEFAULT 0 NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"author_person_id" uuid,
	"author_platform_identity_id" uuid,
	"author_platform_user_id" varchar(255),
	"author_display_name" varchar(255),
	"post_type" varchar(50) DEFAULT 'text' NOT NULL,
	"text_content" text,
	"media_urls" jsonb,
	"link_url" text,
	"link_preview" jsonb,
	"shared_post_id" uuid,
	"shared_external_id" varchar(255),
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"repost_count" integer DEFAULT 0 NOT NULL,
	"impression_count" integer DEFAULT 0 NOT NULL,
	"reactions" jsonb,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"visibility" varchar(50),
	"is_pinned" boolean DEFAULT false NOT NULL,
	"hashtags" text[],
	"mentions" jsonb,
	"platform_timestamp" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"raw_payload" jsonb,
	"platform_metadata" jsonb
);
--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_parent_comment_id_social_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."social_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_author_person_id_persons_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_author_platform_identity_id_platform_identities_id_fk" FOREIGN KEY ("author_platform_identity_id") REFERENCES "public"."platform_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_platform_identity_id_platform_identities_id_fk" FOREIGN KEY ("platform_identity_id") REFERENCES "public"."platform_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_engagement_snapshots" ADD CONSTRAINT "social_engagement_snapshots_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_author_person_id_persons_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_author_platform_identity_id_platform_identities_id_fk" FOREIGN KEY ("author_platform_identity_id") REFERENCES "public"."platform_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_shared_post_id_social_posts_id_fk" FOREIGN KEY ("shared_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_comments_post_idx" ON "social_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_comments_parent_idx" ON "social_comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "social_comments_author_person_idx" ON "social_comments" USING btree ("author_person_id");--> statement-breakpoint
CREATE INDEX "social_comments_author_pi_idx" ON "social_comments" USING btree ("author_platform_identity_id");--> statement-breakpoint
CREATE INDEX "social_comments_status_idx" ON "social_comments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_comments_platform_ts_idx" ON "social_comments" USING btree ("platform_timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "social_comments_post_external_idx" ON "social_comments" USING btree ("post_id","external_id");--> statement-breakpoint
CREATE INDEX "social_connections_instance_idx" ON "social_connections" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "social_connections_person_idx" ON "social_connections" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "social_connections_pi_idx" ON "social_connections" USING btree ("platform_identity_id");--> statement-breakpoint
CREATE INDEX "social_connections_status_idx" ON "social_connections" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "social_connections_instance_user_type_idx" ON "social_connections" USING btree ("instance_id","platform_user_id","connection_type");--> statement-breakpoint
CREATE INDEX "social_engagement_snapshots_post_idx" ON "social_engagement_snapshots" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_engagement_snapshots_at_idx" ON "social_engagement_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX "social_engagement_snapshots_post_at_idx" ON "social_engagement_snapshots" USING btree ("post_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "social_posts_instance_idx" ON "social_posts" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "social_posts_channel_idx" ON "social_posts" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "social_posts_author_person_idx" ON "social_posts" USING btree ("author_person_id");--> statement-breakpoint
CREATE INDEX "social_posts_author_pi_idx" ON "social_posts" USING btree ("author_platform_identity_id");--> statement-breakpoint
CREATE INDEX "social_posts_status_idx" ON "social_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "social_posts_platform_ts_idx" ON "social_posts" USING btree ("platform_timestamp");--> statement-breakpoint
CREATE INDEX "social_posts_created_at_idx" ON "social_posts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_instance_external_idx" ON "social_posts" USING btree ("instance_id","external_id");