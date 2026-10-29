-- BUILD-010 B: campos opcionales para perfiles de responsables importados. No cambia filas existentes.
ALTER TABLE "sellers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "sellers" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_email_format" CHECK ("sellers"."email" IS NULL OR ("sellers"."email" = lower(btrim("sellers"."email")) AND char_length("sellers"."email") <= 254 AND "sellers"."email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'));--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_phone_format" CHECK ("sellers"."phone" IS NULL OR "sellers"."phone" ~ '^[0-9+()[:space:]-]{6,20}$');--> statement-breakpoint
CREATE UNIQUE INDEX "sellers_raffle_email_uq" ON "sellers" USING btree ("raffle_id", "email") WHERE "sellers"."email" IS NOT NULL;
