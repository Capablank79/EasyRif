CREATE TABLE "booklet_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"booklet_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	CONSTRAINT "booklet_assignments_period" CHECK ("booklet_assignments"."ended_at" is null or "booklet_assignments"."ended_at" >= "booklet_assignments"."assigned_at")
);
--> statement-breakpoint
CREATE TABLE "order_item_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_item_uq" UNIQUE("order_item_id"),
	CONSTRAINT "participants_name_len" CHECK (char_length(btrim("order_item_participants"."name")) between 2 and 100),
	CONSTRAINT "participants_email_format" CHECK ("order_item_participants"."email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' and char_length("order_item_participants"."email") <= 254),
	CONSTRAINT "participants_phone_format" CHECK ("order_item_participants"."phone" is null or "order_item_participants"."phone" ~ '^[0-9+()[:space:]-]{6,20}$')
);
--> statement-breakpoint
ALTER TABLE "raffles" ADD COLUMN "sales_closes_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raffles" ADD COLUMN "draw_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booklet_assignments" ADD CONSTRAINT "booklet_assignments_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booklet_assignments" ADD CONSTRAINT "booklet_assignments_booklet_fk" FOREIGN KEY ("booklet_id","raffle_id") REFERENCES "public"."booklets"("id","raffle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booklet_assignments" ADD CONSTRAINT "booklet_assignments_seller_org_fk" FOREIGN KEY ("seller_id","organization_id") REFERENCES "public"."sellers"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_participants" ADD CONSTRAINT "participants_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_participants" ADD CONSTRAINT "participants_item_fk" FOREIGN KEY ("order_item_id","raffle_id") REFERENCES "public"."order_items"("id","raffle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booklet_assignments_active_uq" ON "booklet_assignments" USING btree ("booklet_id") WHERE "booklet_assignments"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "booklet_assignments_seller_idx" ON "booklet_assignments" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "booklet_assignments_raffle_idx" ON "booklet_assignments" USING btree ("raffle_id");--> statement-breakpoint
CREATE INDEX "participants_order_idx" ON "order_item_participants" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_sales_draw_order" CHECK ("raffles"."sales_closes_at" is null or "raffles"."draw_at" is null or "raffles"."draw_at" > "raffles"."sales_closes_at");--> statement-breakpoint
-- BUILD-008 V0.8.1: integridad de responsables, participantes y fechas (aditiva; MIGUELITO y martin no se tocan).
CREATE TRIGGER booklet_assignments_org_immutable BEFORE UPDATE ON booklet_assignments FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();--> statement-breakpoint
-- Historial append-only: solo se puede cerrar una asignacion vigente; nada se reescribe ni se borra
-- (el borrado en cascada al eliminar una rifa en borrador es el unico camino permitido).
CREATE FUNCTION booklet_assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s sellers%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'el historial de asignaciones no puede borrarse';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL
       OR NEW.booklet_id IS DISTINCT FROM OLD.booklet_id
       OR NEW.raffle_id IS DISTINCT FROM OLD.raffle_id
       OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
       OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
       OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by THEN
      RAISE EXCEPTION 'una asignacion solo puede cerrarse una vez; no se reescribe';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'una asignacion nueva debe estar vigente';
  END IF;
  SELECT * INTO s FROM sellers WHERE id = NEW.seller_id;
  IF s.raffle_id IS DISTINCT FROM NEW.raffle_id THEN
    RAISE EXCEPTION 'el responsable pertenece a otra rifa';
  END IF;
  IF s.status <> 'active' THEN
    RAISE EXCEPTION 'el responsable esta revocado';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER booklet_assignments_guard BEFORE INSERT OR UPDATE OR DELETE ON booklet_assignments FOR EACH ROW EXECUTE FUNCTION booklet_assignments_guard();--> statement-breakpoint
-- Un participante pertenece exactamente al order_item indicado, solo en pedidos de demostracion; es inmutable.
CREATE FUNCTION participants_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i order_items%ROWTYPE; demo boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'los datos del participante son inmutables';
  END IF;
  SELECT * INTO i FROM order_items WHERE id = NEW.order_item_id;
  IF i.id IS NULL OR i.order_id <> NEW.order_id OR i.raffle_id <> NEW.raffle_id OR i.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'el participante no corresponde al order_item indicado';
  END IF;
  SELECT is_demo INTO demo FROM orders WHERE id = NEW.order_id;
  IF NOT demo THEN
    RAISE EXCEPTION 'en esta fase solo se admiten participantes de pedidos de demostracion';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER participants_guard BEFORE INSERT OR UPDATE ON order_item_participants FOR EACH ROW EXECUTE FUNCTION participants_guard();--> statement-breakpoint
-- En rifas de talonarios, cada order_item debe tener su participante al confirmar la transaccion.
CREATE FUNCTION order_items_require_participant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT numbering_mode FROM raffles WHERE id = NEW.raffle_id) = 'booklets'
     AND NOT EXISTS (SELECT 1 FROM order_item_participants WHERE order_item_id = NEW.id) THEN
    RAISE EXCEPTION 'cada participacion de un talonario requiere los datos de su participante';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER order_items_require_participant AFTER INSERT ON order_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION order_items_require_participant();--> statement-breakpoint
-- Cierre de ventas: ningun pedido nuevo despues del cierre (los existentes no se tocan).
CREATE FUNCTION orders_sales_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c timestamptz;
BEGIN
  SELECT sales_closes_at INTO c FROM raffles WHERE id = NEW.raffle_id;
  IF c IS NOT NULL AND now() >= c THEN
    RAISE EXCEPTION 'las ventas de esta campana estan cerradas';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER orders_sales_open BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION orders_sales_open();--> statement-breakpoint
-- Fechas: solo talonarios las usan; el cierre solo se adelanta en borrador (despues solo se extiende);
-- publicar exige ambas fechas, con el cierre en el futuro.
CREATE FUNCTION raffles_guard_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numbering_mode <> 'booklets' AND (NEW.sales_closes_at IS NOT NULL OR NEW.draw_at IS NOT NULL) THEN
    RAISE EXCEPTION 'el cierre de ventas y el sorteo posterior solo se configuran en rifas con talonarios';
  END IF;
  IF OLD.status <> 'draft' AND OLD.sales_closes_at IS NOT NULL
     AND (NEW.sales_closes_at IS NULL OR NEW.sales_closes_at < OLD.sales_closes_at) THEN
    RAISE EXCEPTION 'el cierre de ventas solo puede extenderse una vez publicada la rifa';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'published' AND NEW.numbering_mode = 'booklets' THEN
    IF NEW.sales_closes_at IS NULL OR NEW.draw_at IS NULL THEN
      RAISE EXCEPTION 'una campana de talonarios requiere cierre de ventas y fecha de sorteo para publicarse';
    END IF;
    IF NEW.sales_closes_at <= now() THEN
      RAISE EXCEPTION 'el cierre de ventas debe estar en el futuro para publicar';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER raffles_guard_dates BEFORE UPDATE ON raffles FOR EACH ROW EXECUTE FUNCTION raffles_guard_dates();