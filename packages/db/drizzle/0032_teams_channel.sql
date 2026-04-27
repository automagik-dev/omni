-- Add Microsoft Teams (Bot Framework) channel configuration columns to instances.

ALTER TABLE "instances" ADD COLUMN "microsoft_app_id" varchar(128);
ALTER TABLE "instances" ADD COLUMN "microsoft_app_password" text;
ALTER TABLE "instances" ADD COLUMN "microsoft_app_tenant_id" varchar(128);
ALTER TABLE "instances" ADD COLUMN "microsoft_app_type" varchar(32);
