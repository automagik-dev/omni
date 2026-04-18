ALTER TABLE "instances" RENAME COLUMN "gupshup_api_key" TO "gupshup_callback_url";
ALTER TABLE "instances" RENAME COLUMN "gupshup_app_name" TO "gupshup_auth_token";
ALTER TABLE "instances" RENAME COLUMN "gupshup_source_phone" TO "gupshup_event_id";
ALTER TABLE "instances" ALTER COLUMN "gupshup_callback_url" SET DATA TYPE text;
ALTER TABLE "instances" ALTER COLUMN "gupshup_auth_token" SET DATA TYPE text;
ALTER TABLE "instances" ALTER COLUMN "gupshup_event_id" SET DATA TYPE varchar(255);
