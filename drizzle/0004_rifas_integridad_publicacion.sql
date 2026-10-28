-- BUILD-005: invariantes de publicación de rifas (aditiva, no destructiva).
-- Tras publicar no pueden cambiar slug, cantidad de números, precio ni moneda,
-- no se vuelve a borrador y publicar exige premios y todos los números generados.
CREATE FUNCTION raffles_guard_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'el slug es inmutable una vez publicada la rifa';
    END IF;
    IF NEW.number_count IS DISTINCT FROM OLD.number_count THEN
      RAISE EXCEPTION 'la cantidad de números es inmutable una vez publicada la rifa';
    END IF;
    IF NEW.price_cents IS DISTINCT FROM OLD.price_cents OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'el precio y la moneda son inmutables una vez publicada la rifa';
    END IF;
    IF NEW.status = 'draft' THEN
      RAISE EXCEPTION 'una rifa publicada no puede volver a borrador';
    END IF;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'published' THEN
    IF NEW.price_cents <= 0 THEN
      RAISE EXCEPTION 'no se puede publicar una rifa sin precio';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM prizes WHERE raffle_id = NEW.id) THEN
      RAISE EXCEPTION 'no se puede publicar una rifa sin premios';
    END IF;
    IF (SELECT count(*) FROM raffle_numbers WHERE raffle_id = NEW.id) <> NEW.number_count THEN
      RAISE EXCEPTION 'no se puede publicar una rifa sin todos sus números generados';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER raffles_guard_publication BEFORE UPDATE ON raffles FOR EACH ROW EXECUTE FUNCTION raffles_guard_publication();
