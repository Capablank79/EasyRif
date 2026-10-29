import { sql } from "drizzle-orm";
import { assertCan, type OrgRole } from "@/modules/organizations/permissions";
import { getActiveRole } from "@/modules/organizations";
import { formatFolio, participationLabel } from "@/modules/raffles/booklets";
import { raffles } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";
import { ReceiptError, type ReceiptData } from "@/modules/receipts/service";
import { deriveVerificationCode } from "@/modules/receipts/verification";

const rowsOf = <T>(res: unknown): T[] =>
  (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];

export class SalesError extends Error {
  constructor(public code: "not_found" | "invalid", message: string) {
    super(message);
    this.name = "SalesError";
  }
}

export type SaleState = "all" | "reserved" | "sold_demo" | "sold_real" | "confirmed_demo" | "pending" | "expired" | "cancelled" | "draft";

export interface SalesFilters {
  page: number;
  pageSize: number;
  folio: number | null;
  number: string;
  seller: string;
  state: SaleState;
  from: string;
  to: string;
}

const SALE_STATES: SaleState[] = ["all", "reserved", "sold_demo", "sold_real", "confirmed_demo", "pending", "expired", "cancelled", "draft"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): string {
  if (!DATE_RE.test(value)) return "";
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : "";
}

/** Sanitiza y limita los parámetros que llegan desde la URL. */
export function parseSalesFilters(raw: Record<string, string | string[] | undefined>): SalesFilters {
  const value = (key: string) => {
    const v = raw[key];
    return (Array.isArray(v) ? v[0] : v ?? "").trim();
  };
  const page = Number(value("page"));
  const folio = Number(value("folio"));
  const rawState = value("state") as SaleState;
  const from = validDate(value("from"));
  const to = validDate(value("to"));
  return {
    page: Number.isSafeInteger(page) ? Math.min(Math.max(page, 1), 10_000) : 1,
    pageSize: 25,
    folio: /^\d{1,5}$/.test(value("folio")) && folio > 0 ? folio : null,
    number: value("number").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20),
    seller: value("seller").replace(/[\u0000-\u001f]/g, "").slice(0, 80),
    state: SALE_STATES.includes(rawState) ? rawState : "all",
    from,
    to,
  };
}

export const SALE_STATE_LABEL: Record<Exclude<SaleState, "all">, string> = {
  reserved: "Reservado",
  sold_demo: "Vendido DEMO",
  sold_real: "Vendido real",
  confirmed_demo: "Confirmado DEMO",
  pending: "Confirmación pendiente",
  expired: "Vencido",
  cancelled: "Cancelado",
  draft: "Borrador",
};

async function authorizeSales(db: Database, userId: string, raffleId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raffleId))
    throw new SalesError("not_found", "No se encontró la rifa.");
  const [raffle] = await db.select().from(raffles).where(sql`${raffles.id} = ${raffleId}`).limit(1);
  if (!raffle) throw new SalesError("not_found", "No se encontró la rifa.");
  const role = await getActiveRole(db, userId, raffle.organizationId);
  if (!role) throw new SalesError("not_found", "No se encontró la rifa.");
  assertCan(role, "raffle:read");
  assertCan(role, "orders:read");
  return { raffle, role };
}

export interface SalesMetrics {
  totalNumbers: number;
  soldDemoNumbers: number;
  soldRealNumbers: number;
  confirmedDemoOperations: number;
  confirmedRealOperations: number;
  simulatedIncomeCents: number;
  realIncomeCents: number;
  activeReservations: number;
  availableNumbers: number;
}

export interface SaleRow {
  id: string;
  state: Exclude<SaleState, "all">;
  isDemo: boolean;
  createdAt: Date;
  numbers: string[];
  folios: string[];
  quantity: number;
  amountCents: number;
  currency: string;
  responsible: string | null;
  receiptAvailable: boolean;
}

export interface SellerSalesSummary {
  id: string;
  name: string;
  status: "active" | "revoked";
  assignedBooklets: number;
  soldNumbers: number;
  simulatedIncomeCents: number;
  realIncomeCents: number;
}

export interface SalesDashboard {
  raffle: { id: string; title: string; organizationId: string; currency: string; numberingMode: "individual" | "booklets" };
  metrics: SalesMetrics;
  operations: SaleRow[];
  totalOperations: number;
  page: number;
  pageSize: number;
  sellers: SellerSalesSummary[];
  permissions: { buyers: boolean; sellers: boolean; audit: boolean };
  filters: SalesFilters;
}

function eventCtes(organizationId: string, raffleId: string) {
  return sql`WITH
  demo_events AS (
    SELECT ae."entity_id" AS order_id,
      min(ae."created_at") FILTER (WHERE ae."action" = 'demo.purchase_confirmed') AS confirmed_at,
      min(ae."created_at") FILTER (WHERE ae."action" = 'demo.payment_simulated') AS paid_at,
      max((ae."metadata"->>'amountCents')::bigint) FILTER (WHERE ae."action" = 'demo.payment_simulated') AS paid_cents
    FROM "audit_events" ae
    WHERE ae."organization_id" = ${organizationId} AND ae."entity_type" IN ('demo_purchase', 'demo_payment')
      AND ae."action" IN ('demo.purchase_confirmed', 'demo.payment_simulated')
    GROUP BY ae."entity_id"
  ), item_rollup AS (
    SELECT oi."order_id", count(*)::int AS quantity,
      array_agg(n."number" ORDER BY n."number") AS number_values,
      array_agg(n."local_number" IS NOT NULL ORDER BY n."number") AS booklet_values,
      array_agg(DISTINCT bk."folio" ORDER BY bk."folio") FILTER (WHERE bk."folio" IS NOT NULL) AS folio_values
    FROM "order_items" oi
    JOIN "raffle_numbers" n ON n."id" = oi."raffle_number_id" AND n."raffle_id" = oi."raffle_id" AND n."organization_id" = oi."organization_id"
    LEFT JOIN "booklets" bk ON bk."id" = n."booklet_id" AND bk."raffle_id" = n."raffle_id" AND bk."organization_id" = n."organization_id"
    WHERE oi."raffle_id" = ${raffleId} AND oi."organization_id" = ${organizationId}
    GROUP BY oi."order_id"
  )`;
}

function effectiveStateSql() {
  return sql`CASE
    WHEN NOT o."is_demo" AND o."status" = 'confirmed' THEN 'sold_real'
    WHEN o."is_demo" AND de."paid_at" IS NOT NULL THEN 'sold_demo'
    WHEN o."is_demo" AND de."confirmed_at" IS NOT NULL THEN 'confirmed_demo'
    WHEN o."status" = 'pending' AND (o."expires_at" <= clock_timestamp()
      OR (r."sales_closes_at" IS NOT NULL AND r."sales_closes_at" <= clock_timestamp())) THEN 'expired'
    WHEN o."is_demo" AND o."status" = 'pending' THEN 'reserved'
    ELSE o."status"::text END`;
}

function salesRowsCtes(organizationId: string, raffleId: string, filters: SalesFilters, canSeeSellers: boolean) {
  const conditions = [sql`o."raffle_id" = ${raffleId}`, sql`o."organization_id" = ${organizationId}`];
  if (filters.folio !== null) conditions.push(sql`EXISTS (
    SELECT 1 FROM "order_items" fi JOIN "raffle_numbers" fn ON fn."id" = fi."raffle_number_id"
    JOIN "booklets" fb ON fb."id" = fn."booklet_id"
    WHERE fi."order_id" = o."id" AND fi."raffle_id" = ${raffleId} AND fb."folio" = ${filters.folio})`);
  if (filters.number) conditions.push(sql`EXISTS (
    SELECT 1 FROM "order_items" ni JOIN "raffle_numbers" nn ON nn."id" = ni."raffle_number_id"
    WHERE ni."order_id" = o."id" AND ni."raffle_id" = ${raffleId} AND nn."number" ILIKE ${`%${filters.number}%`})`);
  if (filters.seller) {
    if (!canSeeSellers) throw new Error("orders seller filter denied");
    conditions.push(sql`s."display_name" ILIKE ${`%${filters.seller}%`}`);
  }
  if (filters.from) conditions.push(sql`o."created_at" >= (${filters.from}::date::timestamp AT TIME ZONE 'America/Santiago')`);
  if (filters.to) conditions.push(sql`o."created_at" < ((${filters.to}::date + 1)::timestamp AT TIME ZONE 'America/Santiago')`);
  const state = filters.state === "all" ? sql`` : sql`WHERE so.state = ${filters.state}`;
  return {
    ctes: sql`${eventCtes(organizationId, raffleId)}, order_rows AS (
      SELECT o."id", o."is_demo", o."created_at", o."total_cents", o."currency", o."receipt_issued_at",
        s."display_name" AS responsible, ir.quantity, ir.number_values, ir.booklet_values, ir.folio_values,
        ${effectiveStateSql()} AS state
      FROM "orders" o
      JOIN "raffles" r ON r."id" = o."raffle_id" AND r."organization_id" = o."organization_id"
      LEFT JOIN "sellers" s ON s."id" = o."seller_id" AND s."raffle_id" = o."raffle_id" AND s."organization_id" = o."organization_id"
      LEFT JOIN demo_events de ON de.order_id = o."id"
      LEFT JOIN item_rollup ir ON ir."order_id" = o."id"
      WHERE ${sql.join(conditions, sql` AND `)}
    )`,
    state,
  };
}

/** Indicadores, lista y resumen de responsables en consultas agregadas (sin una consulta por fila). */
export async function getSalesDashboard(db: Database, userId: string, raffleId: string, filters: SalesFilters): Promise<SalesDashboard> {
  const { raffle, role } = await authorizeSales(db, userId, raffleId);
  const buyers = rolePermitted(role, "buyers:read");
  const sellersAllowed = rolePermitted(role, "sellers:read");
  const audit = rolePermitted(role, "audit:read");
  if (filters.seller && !sellersAllowed) assertCan(role, "sellers:read");

  const [m] = rowsOf<Record<string, string>>(await db.execute(sql`
    ${eventCtes(raffle.organizationId, raffle.id)}
    SELECT
      (SELECT count(*) FROM "raffle_numbers" n WHERE n."raffle_id" = ${raffle.id} AND n."organization_id" = ${raffle.organizationId}) total_numbers,
      (SELECT count(*) FROM "raffle_numbers" n WHERE n."raffle_id" = ${raffle.id} AND n."organization_id" = ${raffle.organizationId} AND n."status" = 'simulated_sold') sold_demo_numbers,
      (SELECT count(*) FROM "raffle_numbers" n WHERE n."raffle_id" = ${raffle.id} AND n."organization_id" = ${raffle.organizationId} AND n."status" = 'sold') sold_real_numbers,
      (SELECT count(*) FROM demo_events de JOIN "orders" o ON o."id" = de.order_id AND o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId} WHERE de.confirmed_at IS NOT NULL) demo_operations,
      (SELECT count(*) FROM "orders" o WHERE o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId} AND NOT o."is_demo" AND o."status" = 'confirmed') real_operations,
      (SELECT coalesce(sum(de.paid_cents), 0) FROM demo_events de JOIN "orders" o ON o."id" = de.order_id AND o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId} WHERE de.paid_at IS NOT NULL) demo_income,
      (SELECT coalesce(sum(o."total_cents"), 0) FROM "orders" o WHERE o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId} AND NOT o."is_demo" AND o."status" = 'confirmed') real_income,
      (SELECT count(*) FROM "orders" o WHERE o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId} AND o."is_demo" AND o."status" = 'pending' AND o."expires_at" > clock_timestamp() AND EXISTS (SELECT 1 FROM "raffles" r WHERE r."id" = o."raffle_id" AND (r."sales_closes_at" IS NULL OR r."sales_closes_at" > clock_timestamp())) AND NOT EXISTS (SELECT 1 FROM demo_events de WHERE de.order_id = o."id" AND de.confirmed_at IS NOT NULL)) active_reservations,
      (SELECT count(*) FROM "raffle_numbers" n WHERE n."raffle_id" = ${raffle.id} AND n."organization_id" = ${raffle.organizationId}
        AND (n."status" = 'available' OR (n."status" = 'reserved' AND (n."reserved_until" <= clock_timestamp()
          OR EXISTS (SELECT 1 FROM "raffles" r WHERE r."id" = n."raffle_id" AND r."sales_closes_at" IS NOT NULL AND r."sales_closes_at" <= clock_timestamp()))))) available_numbers`));

  const q = salesRowsCtes(raffle.organizationId, raffle.id, filters, sellersAllowed);
  const [total] = rowsOf<{ total: string }>(await db.execute(sql`${q.ctes} SELECT count(*) total FROM order_rows so ${q.state}`));
  const results = rowsOf<{
    id: string; state: Exclude<SaleState, "all">; is_demo: boolean; created_at: Date | string;
    number_values: string[] | null; booklet_values: boolean[] | null; folio_values: number[] | null;
    quantity: number | null; total_cents: number; currency: string; responsible: string | null; receipt_issued_at: Date | string | null;
  }>(await db.execute(sql`
    ${q.ctes}
    SELECT so."id", so."state", so."is_demo", so."created_at", so."number_values", so."booklet_values", so."folio_values",
      so."quantity", so."total_cents", so."currency", CASE WHEN ${sellersAllowed} THEN so."responsible" ELSE NULL END responsible,
      so."receipt_issued_at"
    FROM order_rows so ${q.state} ORDER BY so."created_at" DESC, so."id" DESC
    LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`));

  const sellerRows = sellersAllowed ? rowsOf<{
    id: string; display_name: string; status: "active" | "revoked"; assigned_booklets: string;
    sold_numbers: string; demo_income: string; real_income: string;
  }>(await db.execute(sql`
    ${eventCtes(raffle.organizationId, raffle.id)}, sale_records AS (
      SELECT o."id", o."seller_id", o."is_demo", coalesce(ir.quantity, 0) AS quantity,
        CASE WHEN o."is_demo" THEN de.paid_cents ELSE o."total_cents" END AS amount_cents
      FROM "orders" o LEFT JOIN demo_events de ON de.order_id = o."id" LEFT JOIN item_rollup ir ON ir."order_id" = o."id"
      WHERE o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId}
        AND ((o."is_demo" AND de.paid_at IS NOT NULL) OR (NOT o."is_demo" AND o."status" = 'confirmed') )
    ), seller_totals AS (
      SELECT sr."seller_id", sum(sr.quantity) sold_numbers,
        sum(sr.amount_cents) FILTER (WHERE sr."is_demo") demo_income,
        sum(sr.amount_cents) FILTER (WHERE NOT sr."is_demo") real_income
      FROM sale_records sr WHERE sr."seller_id" IS NOT NULL GROUP BY sr."seller_id"
    )
    SELECT s."id", s."display_name", s."status",
      (SELECT count(DISTINCT a."booklet_id") FROM "booklet_assignments" a WHERE a."seller_id" = s."id" AND a."raffle_id" = ${raffle.id} AND a."organization_id" = ${raffle.organizationId} AND a."ended_at" IS NULL) assigned_booklets,
      coalesce(st.sold_numbers, 0) sold_numbers, coalesce(st.demo_income, 0) demo_income, coalesce(st.real_income, 0) real_income
    FROM "sellers" s LEFT JOIN seller_totals st ON st."seller_id" = s."id"
    WHERE s."raffle_id" = ${raffle.id} AND s."organization_id" = ${raffle.organizationId}
    ORDER BY s."display_name", s."id"`)) : [];

  return {
    raffle: { id: raffle.id, title: raffle.title, organizationId: raffle.organizationId, currency: raffle.currency, numberingMode: raffle.numberingMode },
    metrics: {
      totalNumbers: Number(m.total_numbers), soldDemoNumbers: Number(m.sold_demo_numbers), soldRealNumbers: Number(m.sold_real_numbers),
      confirmedDemoOperations: Number(m.demo_operations), confirmedRealOperations: Number(m.real_operations),
      simulatedIncomeCents: Number(m.demo_income), realIncomeCents: Number(m.real_income),
      activeReservations: Number(m.active_reservations), availableNumbers: Number(m.available_numbers),
    },
    operations: results.map((row) => ({
      id: row.id, state: row.state, isDemo: row.is_demo, createdAt: new Date(row.created_at),
      numbers: (row.number_values ?? []).map((n, i) => participationLabel(n, Boolean(row.booklet_values?.[i]))),
      folios: (row.folio_values ?? []).map((f) => formatFolio(Number(f))),
      quantity: Number(row.quantity ?? 0), amountCents: Number(row.total_cents), currency: row.currency,
      responsible: row.responsible, receiptAvailable: row.is_demo && row.receipt_issued_at !== null,
    })),
    totalOperations: Number(total.total), page: filters.page, pageSize: filters.pageSize,
    sellers: sellerRows.map((r) => ({
      id: r.id, name: r.display_name, status: r.status, assignedBooklets: Number(r.assigned_booklets), soldNumbers: Number(r.sold_numbers),
      simulatedIncomeCents: Number(r.demo_income), realIncomeCents: Number(r.real_income),
    })),
    permissions: { buyers, sellers: sellersAllowed, audit }, filters,
  };
}

function rolePermitted(role: OrgRole, action: "buyers:read" | "sellers:read" | "audit:read"): boolean {
  try { assertCan(role, action); return true; } catch { return false; }
}

export interface SaleOperationDetail {
  id: string; raffleTitle: string; state: Exclude<SaleState, "all">; isDemo: boolean; createdAt: Date;
  amountCents: number; currency: string; quantity: number; responsible: string | null;
  buyer: { name: string; email: string | null; phone: string | null } | null;
  items: { number: string; folio: string | null; participant: { name: string; email: string; phone: string | null } | null }[];
  trace: { action: string; createdAt: Date; amountCents: number | null; itemCount: number | null; state: string | null }[];
  canSeeBuyers: boolean; canSeeAudit: boolean; receiptAvailable: boolean;
}

export async function getSaleOperationDetail(db: Database, userId: string, raffleId: string, orderId: string): Promise<SaleOperationDetail> {
  const { raffle, role } = await authorizeSales(db, userId, raffleId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) throw new SalesError("not_found", "No se encontró la operación.");
  const buyers = rolePermitted(role, "buyers:read");
  const sellersAllowed = rolePermitted(role, "sellers:read");
  const auditAllowed = rolePermitted(role, "audit:read");
  const [order] = rowsOf<{
    id: string; state: Exclude<SaleState, "all">; is_demo: boolean; created_at: Date | string; total_cents: number; currency: string;
    quantity: number | null; responsible: string | null; buyer_name: string | null; buyer_email: string | null; buyer_phone: string | null;
    receipt_issued_at: Date | string | null; title: string;
  }>(await db.execute(sql`
    ${eventCtes(raffle.organizationId, raffle.id)}, order_view AS (
      SELECT o."id", o."is_demo", o."created_at", o."total_cents", o."currency", o."receipt_issued_at", r."title",
        coalesce(ir.quantity, 0)::int AS quantity, s."display_name" AS responsible,
        CASE WHEN ${buyers} THEN bc."name" ELSE NULL END AS buyer_name,
        CASE WHEN ${buyers} THEN bc."email" ELSE NULL END AS buyer_email,
        CASE WHEN ${buyers} THEN bc."phone" ELSE NULL END AS buyer_phone,
        ${effectiveStateSql()} AS state
      FROM "orders" o
      JOIN "raffles" r ON r."id" = o."raffle_id" AND r."organization_id" = o."organization_id"
      LEFT JOIN "sellers" s ON s."id" = o."seller_id" AND s."raffle_id" = o."raffle_id" AND s."organization_id" = o."organization_id"
      LEFT JOIN "buyer_contacts" bc ON bc."id" = o."buyer_contact_id" AND bc."organization_id" = o."organization_id"
      LEFT JOIN demo_events de ON de.order_id = o."id" LEFT JOIN item_rollup ir ON ir."order_id" = o."id"
      WHERE o."id" = ${orderId} AND o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId}
    )
    SELECT ov.*, CASE WHEN ${sellersAllowed} THEN ov."responsible" ELSE NULL END AS responsible FROM order_view ov`));
  if (!order) throw new SalesError("not_found", "No se encontró la operación.");
  const items = rowsOf<{
    number: string; local_number: number | null; folio: number | null;
    participant_name: string | null; participant_email: string | null; participant_phone: string | null;
  }>(await db.execute(sql`
    SELECT n."number", n."local_number", bk."folio",
      CASE WHEN ${buyers} THEN p."name" ELSE NULL END AS participant_name,
      CASE WHEN ${buyers} THEN p."email" ELSE NULL END AS participant_email,
      CASE WHEN ${buyers} THEN p."phone" ELSE NULL END AS participant_phone
    FROM "order_items" oi
    JOIN "raffle_numbers" n ON n."id" = oi."raffle_number_id" AND n."raffle_id" = oi."raffle_id" AND n."organization_id" = oi."organization_id"
    LEFT JOIN "booklets" bk ON bk."id" = n."booklet_id" AND bk."raffle_id" = oi."raffle_id" AND bk."organization_id" = oi."organization_id"
    LEFT JOIN "order_item_participants" p ON p."order_item_id" = oi."id" AND p."order_id" = oi."order_id" AND p."organization_id" = oi."organization_id"
    WHERE oi."order_id" = ${orderId} AND oi."raffle_id" = ${raffle.id} AND oi."organization_id" = ${raffle.organizationId}
    ORDER BY n."number"`));
  const events = auditAllowed ? rowsOf<{
    action: string; created_at: Date | string; amount_cents: number | null; item_count: number | null; state: string | null;
  }>(await db.execute(sql`
    SELECT ae."action", ae."created_at",
      CASE WHEN ae."metadata" ? 'amountCents' THEN (ae."metadata"->>'amountCents')::bigint ELSE NULL END AS amount_cents,
      CASE WHEN ae."metadata" ? 'itemCount' THEN (ae."metadata"->>'itemCount')::int ELSE NULL END AS item_count,
      ae."metadata"->>'state' AS state
    FROM "audit_events" ae
    WHERE ae."organization_id" = ${raffle.organizationId} AND ae."entity_id" = ${orderId}
      AND ae."entity_type" IN ('demo_purchase', 'demo_payment')
    ORDER BY CASE ae."action" WHEN 'demo.purchase_confirmed' THEN 0 WHEN 'demo.payment_simulated' THEN 1 ELSE 2 END,
      ae."created_at", ae."id"`)) : [];
  return {
    id: order.id, raffleTitle: order.title, state: order.state, isDemo: order.is_demo, createdAt: new Date(order.created_at),
    amountCents: Number(order.total_cents), currency: order.currency, quantity: Number(order.quantity ?? 0), responsible: order.responsible,
    buyer: buyers && order.buyer_name ? { name: order.buyer_name, email: order.buyer_email, phone: order.buyer_phone } : null,
    items: items.map((item) => ({
      number: participationLabel(item.number, item.local_number !== null),
      folio: item.folio === null ? null : formatFolio(Number(item.folio)),
      participant: buyers && item.participant_name ? { name: item.participant_name, email: item.participant_email ?? "", phone: item.participant_phone } : null,
    })),
    trace: events.map((event) => ({ action: event.action, createdAt: new Date(event.created_at),
      amountCents: event.amount_cents === null ? null : Number(event.amount_cents),
      itemCount: event.item_count === null ? null : Number(event.item_count), state: event.state })),
    canSeeBuyers: buyers, canSeeAudit: auditAllowed, receiptAvailable: order.is_demo && order.receipt_issued_at !== null,
  };
}

/** Reemite un PDF únicamente cuando ya se emitió; no recupera el token privado de reserva. */
export async function getExistingSalesReceipt(db: Database, userId: string, raffleId: string, orderId: string): Promise<ReceiptData> {
  const { raffle, role } = await authorizeSales(db, userId, raffleId);
  assertCan(role, "buyers:read");
  const [order] = rowsOf<{
    id: string; status: "pending" | "cancelled" | "expired"; total_cents: number; currency: string; expires_at: Date | string;
    title: string; org_name: string; price_cents: number; receipt_issued_at: Date | string;
    confirmed_at: Date | string | null; paid_at: Date | string | null;
  }>(await db.execute(sql`
    SELECT o."id", o."status", o."total_cents", o."currency", o."expires_at", o."receipt_issued_at",
      r."title", r."price_cents", g."name" AS org_name,
      (SELECT min(ae."created_at") FROM "audit_events" ae WHERE ae."organization_id" = o."organization_id" AND ae."entity_type" = 'demo_purchase' AND ae."entity_id" = o."id" AND ae."action" = 'demo.purchase_confirmed') AS confirmed_at,
      (SELECT min(ae."created_at") FROM "audit_events" ae WHERE ae."organization_id" = o."organization_id" AND ae."entity_type" = 'demo_payment' AND ae."entity_id" = o."id" AND ae."action" = 'demo.payment_simulated') AS paid_at
    FROM "orders" o JOIN "raffles" r ON r."id" = o."raffle_id" AND r."organization_id" = o."organization_id"
    JOIN "organizations" g ON g."id" = o."organization_id"
    WHERE o."id" = ${orderId} AND o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId}
      AND o."is_demo" AND o."verification_hash" IS NOT NULL AND o."receipt_issued_at" IS NOT NULL`));
  if (!order) throw new ReceiptError("not_found", "Comprobante no encontrado");
  const numberRows = rowsOf<{ number: string; local_number: number | null }>(await db.execute(sql`
    SELECT n."number", n."local_number" FROM "order_items" oi
    JOIN "raffle_numbers" n ON n."id" = oi."raffle_number_id" AND n."raffle_id" = oi."raffle_id" AND n."organization_id" = oi."organization_id"
    WHERE oi."order_id" = ${order.id} AND oi."raffle_id" = ${raffle.id} AND oi."organization_id" = ${raffle.organizationId} ORDER BY n."number"`));
  if (numberRows.length > 200) throw new ReceiptError("too_many_numbers", "Demasiados números para generar el comprobante");
  const people = rowsOf<{ number: string; local_number: number | null; name: string; email: string; phone: string | null }>(await db.execute(sql`
    SELECT n."number", n."local_number", p."name", p."email", p."phone" FROM "order_item_participants" p
    JOIN "order_items" oi ON oi."id" = p."order_item_id" AND oi."order_id" = p."order_id" AND oi."raffle_id" = p."raffle_id"
    JOIN "raffle_numbers" n ON n."id" = oi."raffle_number_id" AND n."raffle_id" = oi."raffle_id"
    WHERE p."order_id" = ${order.id} AND p."raffle_id" = ${raffle.id} AND p."organization_id" = ${raffle.organizationId} ORDER BY n."number"`));
  return {
    orderId: order.id, status: order.status, raffleTitle: order.title, organizerName: order.org_name,
    numbers: numberRows.map((row) => participationLabel(row.number, row.local_number !== null)),
    participants: people.map((person) => ({ label: participationLabel(person.number, person.local_number !== null), name: person.name, email: person.email, phone: person.phone })),
    unitPriceCents: Number(order.price_cents), totalCents: Number(order.total_cents), currency: order.currency,
    issuedAt: new Date(order.receipt_issued_at), expiresAt: new Date(order.expires_at), verificationCode: deriveVerificationCode(order.id),
    simulationConfirmedAt: order.confirmed_at ? new Date(order.confirmed_at) : null,
    simulationPaidAt: order.paid_at ? new Date(order.paid_at) : null,
  };
}


