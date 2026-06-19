-- Add Twilio WhatsApp channel configuration columns to instances.

ALTER TABLE "instances" ADD COLUMN "twilio_account_sid" varchar(34);
ALTER TABLE "instances" ADD COLUMN "twilio_auth_token" text;
ALTER TABLE "instances" ADD COLUMN "twilio_from" varchar(64);
ALTER TABLE "instances" ADD COLUMN "twilio_messaging_service_sid" varchar(34);
ALTER TABLE "instances" ADD COLUMN "twilio_status_callback_url" text;
ALTER TABLE "instances" ADD COLUMN "twilio_webhook_url" text;
ALTER TABLE "instances" ADD COLUMN "twilio_validate_signature" boolean DEFAULT true NOT NULL;
