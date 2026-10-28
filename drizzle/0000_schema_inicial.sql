CREATE TYPE "public"."drawing_status" AS ENUM('pending', 'completed', 'voided');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('invited', 'active', 'suspended', 'removed');--> statement-breakpoint
CREATE TYPE "public"."number_status" AS ENUM('available', 'reserved', 'sold');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'pending', 'confirmed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('individual', 'school');--> statement-breakpoint
CREATE TYPE "public"."raffle_status" AS ENUM('draft', 'published', 'closed', 'drawn');--> statement-breakpoint
CREATE TYPE "public"."redemption_status" AS ENUM('pending', 'redeemed');--> statement-breakpoint
CREATE TYPE "public"."seller_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_org_user_uq" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "organization_type" DEFAULT 'individual' NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_len" CHECK (char_length(btrim("organizations"."name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email")) and "users"."email" ~ '^[^@\s]+@[^@\s]+$' and char_length("users"."email") <= 254),
	CONSTRAINT "users_display_name_len" CHECK ("users"."display_name" is null or char_length("users"."display_name") <= 120)
);
--> statement-breakpoint
CREATE TABLE "digital_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"template_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digital_products_id_raffle_uq" UNIQUE("id","raffle_id"),
	CONSTRAINT "digital_products_name_len" CHECK (char_length(btrim("digital_products"."name")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "numbered_product_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"digital_product_id" uuid NOT NULL,
	"raffle_number_id" uuid NOT NULL,
	"document_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "numbered_units_product_number_uq" UNIQUE("digital_product_id","raffle_number_id")
);
--> statement-breakpoint
CREATE TABLE "prizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prizes_raffle_position_uq" UNIQUE("raffle_id","position"),
	CONSTRAINT "prizes_id_raffle_uq" UNIQUE("id","raffle_id"),
	CONSTRAINT "prizes_position_pos" CHECK ("prizes"."position" >= 1),
	CONSTRAINT "prizes_title_len" CHECK (char_length(btrim("prizes"."title")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "raffle_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "number_status" DEFAULT 'available' NOT NULL,
	"reservation_id" uuid,
	"reserved_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raffle_numbers_raffle_number_uq" UNIQUE("raffle_id","number"),
	CONSTRAINT "raffle_numbers_id_raffle_uq" UNIQUE("id","raffle_id"),
	CONSTRAINT "raffle_numbers_format" CHECK ("raffle_numbers"."number" ~ '^[A-Z0-9]{1,12}$'),
	CONSTRAINT "raffle_numbers_reservation_consistent" CHECK (("raffle_numbers"."status" = 'reserved' and "raffle_numbers"."reserved_until" is not null and "raffle_numbers"."reservation_id" is not null)
        or ("raffle_numbers"."status" <> 'reserved' and "raffle_numbers"."reserved_until" is null and "raffle_numbers"."reservation_id" is null))
);
--> statement-breakpoint
CREATE TABLE "raffles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "raffle_status" DEFAULT 'draft' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CLP' NOT NULL,
	"number_count" integer NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raffles_slug_uq" UNIQUE("slug"),
	CONSTRAINT "raffles_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "raffles_slug_format" CHECK ("raffles"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("raffles"."slug") between 3 and 64),
	CONSTRAINT "raffles_title_len" CHECK (char_length(btrim("raffles"."title")) between 1 and 200),
	CONSTRAINT "raffles_price_nonneg" CHECK ("raffles"."price_cents" >= 0),
	CONSTRAINT "raffles_currency_format" CHECK ("raffles"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "raffles_number_count_pos" CHECK ("raffles"."number_count" > 0),
	CONSTRAINT "raffles_dates_order" CHECK ("raffles"."starts_at" is null or "raffles"."ends_at" is null or "raffles"."ends_at" > "raffles"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"raffle_id" uuid,
	"display_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "seller_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sellers_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "sellers_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "sellers_token_hash_format" CHECK ("sellers"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sellers_name_len" CHECK (char_length(btrim("sellers"."display_name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "buyer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyer_contacts_id_org_uq" UNIQUE("id","organization_id"),
	CONSTRAINT "buyer_contacts_name_len" CHECK (char_length(btrim("buyer_contacts"."name")) between 1 and 160),
	CONSTRAINT "buyer_contacts_has_contact" CHECK ("buyer_contacts"."email" is not null or "buyer_contacts"."phone" is not null)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"raffle_number_id" uuid NOT NULL,
	"digital_product_id" uuid,
	"price_cents" integer NOT NULL,
	"holds_number" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_order_number_uq" UNIQUE("order_id","raffle_number_id"),
	CONSTRAINT "order_items_id_raffle_uq" UNIQUE("id","raffle_id"),
	CONSTRAINT "order_items_price_nonneg" CHECK ("order_items"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"buyer_contact_id" uuid,
	"seller_id" uuid,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CLP' NOT NULL,
	"is_demo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_id_raffle_uq" UNIQUE("id","raffle_id"),
	CONSTRAINT "orders_total_nonneg" CHECK ("orders"."total_cents" >= 0),
	CONSTRAINT "orders_currency_format" CHECK ("orders"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "drawings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "drawing_status" DEFAULT 'pending' NOT NULL,
	"performed_at" timestamp with time zone,
	"result_evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drawings_id_raffle_uq" UNIQUE("id","raffle_id"),
	CONSTRAINT "drawings_completed_has_date" CHECK ("drawings"."status" <> 'completed' or "drawings"."performed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "winners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drawing_id" uuid NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"prize_id" uuid NOT NULL,
	"redemption_status" "redemption_status" DEFAULT 'pending' NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "winners_prize_item_uq" UNIQUE("prize_id","order_item_id"),
	CONSTRAINT "winners_redemption_consistent" CHECK (("winners"."redemption_status" = 'redeemed') = ("winners"."redeemed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_metadata_object" CHECK (jsonb_typeof("audit_events"."metadata") = 'object'),
	CONSTRAINT "audit_events_action_len" CHECK (char_length("audit_events"."action") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_products" ADD CONSTRAINT "digital_products_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbered_product_units" ADD CONSTRAINT "numbered_units_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbered_product_units" ADD CONSTRAINT "numbered_units_product_fk" FOREIGN KEY ("digital_product_id","raffle_id") REFERENCES "public"."digital_products"("id","raffle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbered_product_units" ADD CONSTRAINT "numbered_units_number_fk" FOREIGN KEY ("raffle_number_id","raffle_id") REFERENCES "public"."raffle_numbers"("id","raffle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_contacts" ADD CONSTRAINT "buyer_contacts_org_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("order_id","raffle_id") REFERENCES "public"."orders"("id","raffle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_number_fk" FOREIGN KEY ("raffle_number_id","raffle_id") REFERENCES "public"."raffle_numbers"("id","raffle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_fk" FOREIGN KEY ("digital_product_id","raffle_id") REFERENCES "public"."digital_products"("id","raffle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_org_fk" FOREIGN KEY ("buyer_contact_id","organization_id") REFERENCES "public"."buyer_contacts"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_org_fk" FOREIGN KEY ("seller_id","organization_id") REFERENCES "public"."sellers"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winners" ADD CONSTRAINT "winners_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winners" ADD CONSTRAINT "winners_drawing_fk" FOREIGN KEY ("drawing_id","raffle_id") REFERENCES "public"."drawings"("id","raffle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winners" ADD CONSTRAINT "winners_prize_fk" FOREIGN KEY ("prize_id","raffle_id") REFERENCES "public"."prizes"("id","raffle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "winners" ADD CONSTRAINT "winners_order_item_fk" FOREIGN KEY ("order_item_id","raffle_id") REFERENCES "public"."order_items"("id","raffle_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "digital_products_raffle_idx" ON "digital_products" USING btree ("raffle_id");--> statement-breakpoint
CREATE INDEX "numbered_units_number_idx" ON "numbered_product_units" USING btree ("raffle_number_id");--> statement-breakpoint
CREATE INDEX "raffle_numbers_raffle_status_idx" ON "raffle_numbers" USING btree ("raffle_id","status");--> statement-breakpoint
CREATE INDEX "raffle_numbers_reserved_until_idx" ON "raffle_numbers" USING btree ("reserved_until") WHERE "raffle_numbers"."status" = 'reserved';--> statement-breakpoint
CREATE INDEX "raffles_org_status_idx" ON "raffles" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "sellers_org_idx" ON "sellers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_number_held_uq" ON "order_items" USING btree ("raffle_number_id") WHERE "order_items"."holds_number";--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_raffle_status_idx" ON "orders" USING btree ("raffle_id","status");--> statement-breakpoint
CREATE INDEX "drawings_raffle_idx" ON "drawings" USING btree ("raffle_id");--> statement-breakpoint
CREATE INDEX "winners_drawing_idx" ON "winners" USING btree ("drawing_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");