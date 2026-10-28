ALTER TABLE "orders" ADD COLUMN "verification_hash" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "receipt_issued_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_verification_uq" ON "orders" USING btree ("verification_hash");--> statement-breakpoint
-- BUILD-007: un numero ligado a un pedido de demostracion nunca puede quedar vendido.
CREATE FUNCTION raffle_numbers_no_demo_sold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'sold' AND EXISTS (
    SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.raffle_number_id = NEW.id AND o.is_demo
  ) THEN
    RAISE EXCEPTION 'un numero de un pedido de demostracion no puede pasar a vendido';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER raffle_numbers_no_demo_sold BEFORE INSERT OR UPDATE ON "raffle_numbers"
  FOR EACH ROW EXECUTE FUNCTION raffle_numbers_no_demo_sold();