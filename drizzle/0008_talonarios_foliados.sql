CREATE TYPE "public"."numbering_mode" AS ENUM('individual', 'booklets');--> statement-breakpoint
CREATE TABLE "booklets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"folio" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booklets_raffle_folio_uq" UNIQUE("raffle_id","folio"),
	CONSTRAINT "booklets_id_raffle_uq" UNIQUE("id","raffle_id"),
	CONSTRAINT "booklets_folio_range" CHECK ("booklets"."folio" between 1 and 99999)
);
--> statement-breakpoint
ALTER TABLE "raffle_numbers" ADD COLUMN "booklet_id" uuid;--> statement-breakpoint
ALTER TABLE "raffle_numbers" ADD COLUMN "local_number" integer;--> statement-breakpoint
ALTER TABLE "raffles" ADD COLUMN "numbering_mode" "numbering_mode" DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "raffles" ADD COLUMN "booklet_count" integer;--> statement-breakpoint
ALTER TABLE "raffles" ADD COLUMN "numbers_per_booklet" integer;--> statement-breakpoint
ALTER TABLE "raffles" ADD COLUMN "first_folio" integer;--> statement-breakpoint
ALTER TABLE "booklets" ADD CONSTRAINT "booklets_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_booklet_fk" FOREIGN KEY ("booklet_id","raffle_id") REFERENCES "public"."booklets"("id","raffle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raffle_numbers_booklet_status_idx" ON "raffle_numbers" USING btree ("booklet_id","status");--> statement-breakpoint
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_booklet_local_uq" UNIQUE("booklet_id","local_number");--> statement-breakpoint
ALTER TABLE "raffle_numbers" ADD CONSTRAINT "raffle_numbers_booklet_pair" CHECK (("raffle_numbers"."booklet_id" is null and "raffle_numbers"."local_number" is null)
        or ("raffle_numbers"."booklet_id" is not null and "raffle_numbers"."local_number" between 1 and 9999));--> statement-breakpoint
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_numbering_config" CHECK (("raffles"."numbering_mode" = 'individual'
            and "raffles"."booklet_count" is null and "raffles"."numbers_per_booklet" is null and "raffles"."first_folio" is null)
        or ("raffles"."numbering_mode" = 'booklets'
            and "raffles"."booklet_count" > 0 and "raffles"."numbers_per_booklet" > 0 and "raffles"."first_folio" >= 1
            and "raffles"."first_folio" + "raffles"."booklet_count" - 1 <= 99999
            and "raffles"."numbers_per_booklet" <= 9999
            and "raffles"."number_count" = "raffles"."booklet_count" * "raffles"."numbers_per_booklet"));--> statement-breakpoint
-- BUILD-008: integridad de talonarios (aditiva; las rifas existentes quedan en modo "individual").
CREATE TRIGGER booklets_org_immutable BEFORE UPDATE ON booklets FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();--> statement-breakpoint
-- Un talonario solo existe en rifas de talonarios, dentro del rango de folios configurado, y su folio no cambia.
CREATE FUNCTION booklets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r raffles%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.folio IS DISTINCT FROM OLD.folio OR NEW.raffle_id IS DISTINCT FROM OLD.raffle_id THEN
      RAISE EXCEPTION 'el folio y la rifa de un talonario son inmutables';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM raffles WHERE id = NEW.raffle_id;
  IF r.numbering_mode IS DISTINCT FROM 'booklets' THEN
    RAISE EXCEPTION 'solo las rifas con talonarios foliados pueden tener talonarios';
  END IF;
  IF NEW.folio < r.first_folio OR NEW.folio > r.first_folio + r.booklet_count - 1 THEN
    RAISE EXCEPTION 'el folio % esta fuera del rango configurado de la rifa', NEW.folio;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER booklets_guard BEFORE INSERT OR UPDATE ON booklets FOR EACH ROW EXECUTE FUNCTION booklets_guard();--> statement-breakpoint
-- La clave "T0007N14" debe coincidir con folio y numero interno; un numero nunca se renumera ni cambia de talonario.
CREATE FUNCTION raffle_numbers_booklet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mode numbering_mode;
  b_folio integer;
  m text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.booklet_id IS DISTINCT FROM OLD.booklet_id
       OR NEW.local_number IS DISTINCT FROM OLD.local_number THEN
      RAISE EXCEPTION 'un numero no puede renumerarse ni cambiar de talonario';
    END IF;
    RETURN NEW;
  END IF;
  SELECT numbering_mode INTO mode FROM raffles WHERE id = NEW.raffle_id;
  IF mode = 'individual' THEN
    IF NEW.booklet_id IS NOT NULL THEN
      RAISE EXCEPTION 'una rifa con numeracion individual no admite talonarios';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.booklet_id IS NULL THEN
    RAISE EXCEPTION 'cada participacion de una rifa con talonarios debe pertenecer a un talonario';
  END IF;
  SELECT folio INTO b_folio FROM booklets WHERE id = NEW.booklet_id AND raffle_id = NEW.raffle_id;
  m := regexp_match(NEW.number, '^T([0-9]+)N([0-9]+)$');
  IF b_folio IS NULL OR m IS NULL OR m[1]::integer <> b_folio OR m[2]::integer <> NEW.local_number THEN
    RAISE EXCEPTION 'la clave % no coincide con el folio y el numero interno', NEW.number;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER raffle_numbers_booklet_guard BEFORE INSERT OR UPDATE ON raffle_numbers FOR EACH ROW EXECUTE FUNCTION raffle_numbers_booklet_guard();--> statement-breakpoint
-- La configuracion de numeracion solo cambia en borrador y antes de generar; publicar exige todos los talonarios.
CREATE FUNCTION raffles_guard_numbering() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numbering_mode IS DISTINCT FROM OLD.numbering_mode
     OR NEW.booklet_count IS DISTINCT FROM OLD.booklet_count
     OR NEW.numbers_per_booklet IS DISTINCT FROM OLD.numbers_per_booklet
     OR NEW.first_folio IS DISTINCT FROM OLD.first_folio THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'la configuracion de numeracion es inmutable una vez publicada la rifa';
    END IF;
    IF EXISTS (SELECT 1 FROM raffle_numbers WHERE raffle_id = OLD.id) THEN
      RAISE EXCEPTION 'los numeros ya fueron generados: la configuracion de numeracion no puede cambiar';
    END IF;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'published' AND NEW.numbering_mode = 'booklets' THEN
    IF (SELECT count(*) FROM booklets WHERE raffle_id = NEW.id) <> NEW.booklet_count THEN
      RAISE EXCEPTION 'no se puede publicar una rifa sin todos sus talonarios generados';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER raffles_guard_numbering BEFORE UPDATE ON raffles FOR EACH ROW EXECUTE FUNCTION raffles_guard_numbering();