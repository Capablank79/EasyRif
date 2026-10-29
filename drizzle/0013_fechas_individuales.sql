-- BUILD-011: las rifas individuales comparten las fechas de campana (cierre 22:00 / sorteo 22:30).
-- El trigger anterior (P0001) rechazaba cualquier UPDATE de una rifa individual con fechas.
CREATE OR REPLACE FUNCTION raffles_guard_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
$$;
