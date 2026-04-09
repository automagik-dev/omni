CREATE TABLE "whatsapp_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"label_id" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"color" varchar(20),
	"predefined" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_labels" ADD CONSTRAINT "whatsapp_labels_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_labels_instance_label_idx" ON "whatsapp_labels" USING btree ("instance_id","label_id");