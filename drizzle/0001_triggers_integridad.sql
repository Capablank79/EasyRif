-- Integridad en PostgreSQL estándar (sin RLS, sin extensiones de plataformas externas).
-- La autorización por organización se aplica en el servidor (src/modules/organizations).

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER organization_members_set_updated_at BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER raffles_set_updated_at BEFORE UPDATE ON raffles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER prizes_set_updated_at BEFORE UPDATE ON prizes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER digital_products_set_updated_at BEFORE UPDATE ON digital_products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER raffle_numbers_set_updated_at BEFORE UPDATE ON raffle_numbers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER numbered_product_units_set_updated_at BEFORE UPDATE ON numbered_product_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sellers_set_updated_at BEFORE UPDATE ON sellers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER drawings_set_updated_at BEFORE UPDATE ON drawings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- organization_id nunca cambia: impide mover filas entre organizaciones.
CREATE FUNCTION forbid_organization_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id es inmutable en %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER raffles_org_immutable BEFORE UPDATE ON raffles FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER prizes_org_immutable BEFORE UPDATE ON prizes FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER digital_products_org_immutable BEFORE UPDATE ON digital_products FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER raffle_numbers_org_immutable BEFORE UPDATE ON raffle_numbers FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER numbered_product_units_org_immutable BEFORE UPDATE ON numbered_product_units FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER sellers_org_immutable BEFORE UPDATE ON sellers FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER orders_org_immutable BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER order_items_org_immutable BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER drawings_org_immutable BEFORE UPDATE ON drawings FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER winners_org_immutable BEFORE UPDATE ON winners FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER buyer_contacts_org_immutable BEFORE UPDATE ON buyer_contacts FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint
CREATE TRIGGER organization_members_org_immutable BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION forbid_organization_change();
--> statement-breakpoint

-- Una organización siempre conserva al menos un propietario activo.
CREATE FUNCTION keep_one_active_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active')
     AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM organization_members m
       WHERE m.organization_id = OLD.organization_id
         AND m.id <> OLD.id AND m.role = 'owner' AND m.status = 'active')
  THEN
    RAISE EXCEPTION 'La organización debe conservar al menos un propietario activo';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER organization_members_keep_owner BEFORE UPDATE OR DELETE ON organization_members FOR EACH ROW EXECUTE FUNCTION keep_one_active_owner();
--> statement-breakpoint

-- holds_number: el ítem retiene el número mientras su pedido está pending o confirmed.
CREATE FUNCTION order_item_set_holds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.holds_number := EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.status IN ('pending', 'confirmed'));
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_items_holds BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION order_item_set_holds();
--> statement-breakpoint
CREATE FUNCTION order_status_sync_holds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE order_items SET holds_number = (NEW.status IN ('pending', 'confirmed'))
    WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER orders_sync_holds AFTER UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION order_status_sync_holds();
--> statement-breakpoint

-- Un canje es definitivo.
CREATE FUNCTION winners_redemption_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.redemption_status = 'redeemed'
     AND (NEW.redemption_status IS DISTINCT FROM OLD.redemption_status
          OR NEW.redeemed_at IS DISTINCT FROM OLD.redeemed_at) THEN
    RAISE EXCEPTION 'El canje de un premio es definitivo';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER winners_final BEFORE UPDATE ON winners FOR EACH ROW EXECUTE FUNCTION winners_redemption_final();
--> statement-breakpoint

-- audit_events es de solo inserción.
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events es de solo inserción';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
