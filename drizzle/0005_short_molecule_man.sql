ALTER TABLE "prizes" ADD COLUMN "image_key" uuid;--> statement-breakpoint
ALTER TABLE "raffles" ADD COLUMN "image_key" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "request_key_hash" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_access_token_uq" ON "orders" USING btree ("access_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_request_key_uq" ON "orders" USING btree ("raffle_id","request_key_hash");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_demo_never_confirmed" CHECK (not "orders"."is_demo" or "orders"."status" <> 'confirmed');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_demo_has_expiry" CHECK (not ("orders"."is_demo" and "orders"."status" = 'pending') or "orders"."expires_at" is not null);