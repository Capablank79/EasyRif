import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getActiveRole, assertCan, type OrgAction } from "@/modules/organizations";
import { computeCampaignState, type CampaignState } from "@/modules/raffles/campaign";
import { hashValue, TOKEN_RE } from "@/modules/reservations/service";
import { recordAuditEvent } from "@/platform/audit";
import { raffles, sellers } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";

export type CampaignErrorCode = "not_found" | "state" | "invalid" | "conflict";

export class CampaignError extends Error {
  constructor(
    public code: CampaignErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CampaignError";
  }
}

const notFound = () => new CampaignError("not_found", "No se encontró el recurso.");
const asDb = (tx: unknown) => tx as Database;
const rowsOf = <T>(res: unknown): T[] =>
  (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];

export const MAX_SELLERS_PER_RAFFLE = 500;

/**
 * El enlace del responsable se deriva del identificador y del secreto del servidor, de modo que el
 * administrador puede volver a copiarlo sin guardar el token (solo se guarda su hash).
 */
export function deriveSellerToken(sellerId: string, secret = process.env.BETTER_AUTH_SECRET): string {
  if (!secret) throw new Error("BETTER_AUTH_SECRET no esta configurado");
  return createHmac("sha256", secret).update(`responsable:${sellerId}`).digest("base64url");
}

async function authorizeRaffle(db: Database, userId: string, raffleId: string, action: OrgAction) {
  const [r] = await db.select().from(raffles).where(eq(raffles.id, raffleId)).limit(1);
  if (!r) throw notFound();
  const role = await getActiveRole(db, userId, r.organizationId);
  if (!role) throw notFound();
  assertCan(role, action);
  if (r.numberingMode !== "booklets") throw notFound();
  return { raffle: r, role };
}

async function lockRaffle(tx: Database, raffleId: string, organizationId: string) {
  const [r] = await tx
    .select()
    .from(raffles)
    .where(and(eq(raffles.id, raffleId), eq(raffles.organizationId, organizationId)))
    .for("update")
    .limit(1);
  if (!r) throw notFound();
  return r;
}

export interface SellerSummary {
  id: string;
  displayName: string;
  status: "active" | "revoked";
  folios: number[];
  total: number;
  available: number;
  reservedDemo: number;
  simulatedSold: number;
  sold: number;
  /** Solo presente para quien puede administrar responsables. */
  linkPath: string | null;
}

export interface AssignmentRecord {
  folio: number;
  sellerName: string;
  assignedAt: Date;
  endedAt: Date | null;
}

export interface CampaignProgress {
  counts: {
    total: number;
    available: number;
    reservedDemo: number;
    simulatedSold: number;
    sold: number;
    realConfirmedOrders: number;
    realRevenueCents: number;
    activeDemoOrders: number;
    activeDemoNumbers: number;
    activeDemoAmountCents: number;
    simulatedConfirmedOrders: number;
    simulatedConfirmedNumbers: number;
    simulatedConfirmedAmountCents: number;
    simulatedPayments: number;
    simulatedPaidAmountCents: number;
  };
  booklets: { total: number; completed: number; unassigned: number };
  folios: { folio: number; sellerId: string | null; sellerName: string | null }[];
  state: CampaignState;
  sellers: SellerSummary[];
  history: AssignmentRecord[];
  canManage: boolean;
  canExtend: boolean;
}

const COUNT_COLS = sql`
  count(n.*) AS total,
  count(n.*) FILTER (WHERE n."status" = 'available' OR (n."status" = 'reserved' AND n."reserved_until" <= now())) AS available,
  count(n.*) FILTER (WHERE n."status" = 'reserved' AND n."reserved_until" > now()) AS reserved,
  count(n.*) FILTER (WHERE n."status" = 'sold') AS sold,
  count(n.*) FILTER (WHERE n."status" = 'simulated_sold') AS simulated_sold`;

/** Progreso calculado siempre desde las tablas reales (sin contadores persistidos). */
export async function getCampaignProgress(db: Database, userId: string, raffleId: string): Promise<CampaignProgress> {
  const { raffle, role } = await authorizeRaffle(db, userId, raffleId, "raffle:read");
  const canManage = role === "owner" || role === "admin";
  const canSeeSellers = canManage || role === "editor";

  const [c] = rowsOf<{ total: string; available: string; reserved: string; sold: string; simulated_sold: string }>(
    await db.execute(sql`SELECT ${COUNT_COLS} FROM "raffle_numbers" n WHERE n."raffle_id" = ${raffle.id}`),
  );
  const [sales] = rowsOf<{ real_orders: string; real_revenue: string; demo_orders: string; demo_numbers: string; demo_amount: string }>(
    await db.execute(sql`
      WITH order_metrics AS (
        SELECT o."id", o."is_demo", o."status", o."expires_at", o."total_cents", count(oi."id") AS item_count,
          EXISTS (SELECT 1 FROM "audit_events" ae WHERE ae."organization_id" = o."organization_id"
            AND ae."entity_type" = 'demo_purchase' AND ae."entity_id" = o."id" AND ae."action" = 'demo.purchase_confirmed') AS simulated_confirmed
        FROM "orders" o LEFT JOIN "order_items" oi ON oi."order_id" = o."id"
        WHERE o."raffle_id" = ${raffle.id} AND o."organization_id" = ${raffle.organizationId}
        GROUP BY o."id"
      )
      SELECT
        count(*) FILTER (WHERE NOT "is_demo" AND "status" = 'confirmed') AS real_orders,
        coalesce(sum("total_cents") FILTER (WHERE NOT "is_demo" AND "status" = 'confirmed'), 0) AS real_revenue,
        count(*) FILTER (WHERE "is_demo" AND NOT simulated_confirmed AND "status" = 'pending' AND "expires_at" > now()) AS demo_orders,
        coalesce(sum(item_count) FILTER (WHERE "is_demo" AND NOT simulated_confirmed AND "status" = 'pending' AND "expires_at" > now()), 0) AS demo_numbers,
        coalesce(sum("total_cents") FILTER (WHERE "is_demo" AND NOT simulated_confirmed AND "status" = 'pending' AND "expires_at" > now()), 0) AS demo_amount
      FROM order_metrics`),
  );
  const [simulated] = rowsOf<{ orders: string; numbers: string; amount: string }>(
    await db.execute(sql`
      SELECT count(*) AS orders,
        coalesce(sum(("metadata"->>'itemCount')::int), 0) AS numbers,
        coalesce(sum(("metadata"->>'amountCents')::bigint), 0) AS amount
      FROM "audit_events"
      WHERE "organization_id" = ${raffle.organizationId} AND "entity_type" = 'demo_purchase'
        AND "action" = 'demo.purchase_confirmed' AND "metadata"->>'raffleId' = ${raffle.id}`),
  );
  const [simulatedPayments] = rowsOf<{ payments: string; amount: string }>(
    await db.execute(sql`
      SELECT count(*) AS payments, coalesce(sum(("metadata"->>'amountCents')::bigint), 0) AS amount
      FROM "audit_events"
      WHERE "organization_id" = ${raffle.organizationId} AND "entity_type" = 'demo_payment'
        AND "action" = 'demo.payment_simulated' AND "metadata"->>'raffleId' = ${raffle.id}`),
  );
  const counts = {
    total: +c.total,
    available: +c.available,
    reservedDemo: +c.reserved,
    simulatedSold: +c.simulated_sold,
    sold: +c.sold,
    realConfirmedOrders: +sales.real_orders,
    realRevenueCents: +sales.real_revenue,
    activeDemoOrders: +sales.demo_orders,
    activeDemoNumbers: +sales.demo_numbers,
    activeDemoAmountCents: +sales.demo_amount,
    simulatedConfirmedOrders: +simulated.orders,
    simulatedConfirmedNumbers: +simulated.numbers,
    simulatedConfirmedAmountCents: +simulated.amount,
    simulatedPayments: +simulatedPayments.payments,
    simulatedPaidAmountCents: +simulatedPayments.amount,
  };

  const [b] = rowsOf<{ total: string; completed: string; unassigned: string }>(
    await db.execute(sql`
      SELECT count(*) AS total,
        count(*) FILTER (WHERE s.total > 0 AND s.sold = s.total) AS completed,
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "booklet_assignments" a WHERE a."booklet_id" = s.id AND a."ended_at" IS NULL)) AS unassigned
      FROM (
        SELECT bk."id", count(n.*) AS total, count(n.*) FILTER (WHERE n."status" = 'sold') AS sold
        FROM "booklets" bk LEFT JOIN "raffle_numbers" n ON n."booklet_id" = bk."id"
        WHERE bk."raffle_id" = ${raffle.id} GROUP BY bk."id"
      ) s`),
  );

  let sellerList: SellerSummary[] = [];
  let history: AssignmentRecord[] = [];
  const folios = rowsOf<{ folio: number; seller_id: string | null; display_name: string | null }>(
    await db.execute(sql`
      SELECT bk."folio", s."id" AS seller_id, s."display_name"
      FROM "booklets" bk
      LEFT JOIN "booklet_assignments" a ON a."booklet_id" = bk."id" AND a."raffle_id" = ${raffle.id} AND a."organization_id" = ${raffle.organizationId} AND a."ended_at" IS NULL
      LEFT JOIN "sellers" s ON s."id" = a."seller_id" AND s."raffle_id" = ${raffle.id} AND s."organization_id" = ${raffle.organizationId}
      WHERE bk."raffle_id" = ${raffle.id} AND bk."organization_id" = ${raffle.organizationId}
      ORDER BY bk."folio"`),
  ).map((f) => ({ folio: Number(f.folio), sellerId: f.seller_id, sellerName: f.display_name }));
  if (canSeeSellers) {
    const rows = rowsOf<{
      id: string; display_name: string; status: "active" | "revoked"; folios: number[] | null;
      total: string; available: string; reserved: string; sold: string; simulated_sold: string;
    }>(
      await db.execute(sql`
        SELECT s."id", s."display_name", s."status",
          array_agg(DISTINCT bk."folio") FILTER (WHERE bk."id" IS NOT NULL) AS folios,
          count(n.*) AS total,
          count(n.*) FILTER (WHERE n."status" = 'available' OR (n."status" = 'reserved' AND n."reserved_until" <= now())) AS available,
          count(n.*) FILTER (WHERE n."status" = 'reserved' AND n."reserved_until" > now()) AS reserved,
          count(n.*) FILTER (WHERE n."status" = 'sold') AS sold,
          count(n.*) FILTER (WHERE n."status" = 'simulated_sold') AS simulated_sold
        FROM "sellers" s
        LEFT JOIN "booklet_assignments" a ON a."seller_id" = s."id" AND a."ended_at" IS NULL
        LEFT JOIN "booklets" bk ON bk."id" = a."booklet_id"
        LEFT JOIN "raffle_numbers" n ON n."booklet_id" = bk."id"
        WHERE s."raffle_id" = ${raffle.id} AND s."organization_id" = ${raffle.organizationId}
        GROUP BY s."id" ORDER BY s."display_name", s."id"`),
    );
    sellerList = rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      status: r.status,
      folios: (r.folios ?? []).map(Number).sort((x, y) => x - y),
      total: +r.total,
      available: +r.available,
      reservedDemo: +r.reserved,
      simulatedSold: +r.simulated_sold,
      sold: +r.sold,
      linkPath: canManage && r.status === "active" ? `/v/${deriveSellerToken(r.id)}` : null,
    }));
    history = rowsOf<{ folio: number; display_name: string; assigned_at: Date | string; ended_at: Date | string | null }>(
      await db.execute(sql`
        SELECT bk."folio", s."display_name", a."assigned_at", a."ended_at"
        FROM "booklet_assignments" a
        JOIN "booklets" bk ON bk."id" = a."booklet_id"
        JOIN "sellers" s ON s."id" = a."seller_id"
        WHERE a."raffle_id" = ${raffle.id} AND a."organization_id" = ${raffle.organizationId}
        ORDER BY a."assigned_at" DESC, bk."folio" LIMIT 200`),
    ).map((h) => ({
      folio: Number(h.folio),
      sellerName: h.display_name,
      assignedAt: new Date(h.assigned_at),
      endedAt: h.ended_at ? new Date(h.ended_at) : null,
    }));
  }

  return {
    counts,
    booklets: { total: +b.total, completed: +b.completed, unassigned: +b.unassigned },
    folios,
    state: computeCampaignState({ salesClosesAt: raffle.salesClosesAt, drawAt: raffle.drawAt }, { ...counts }),
    sellers: sellerList,
    history,
    canManage,
    canExtend: canManage && raffle.status === "published",
  };
}

export async function createSeller(db: Database, userId: string, raffleId: string, displayName: string) {
  const { raffle } = await authorizeRaffle(db, userId, raffleId, "sellers:manage");
  const name = displayName.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) throw new CampaignError("invalid", "Indique el nombre del responsable (2 a 80 caracteres).");
  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    await lockRaffle(tx, raffle.id, raffle.organizationId);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sellers)
      .where(eq(sellers.raffleId, raffle.id));
    if (n >= MAX_SELLERS_PER_RAFFLE) throw new CampaignError("invalid", `Máximo ${MAX_SELLERS_PER_RAFFLE} responsables por rifa.`);
    const id = crypto.randomUUID();
    await tx.insert(sellers).values({
      id,
      organizationId: raffle.organizationId,
      raffleId: raffle.id,
      displayName: name,
      tokenHash: hashValue(deriveSellerToken(id)),
    });
    await recordAuditEvent(tx, {
      organizationId: raffle.organizationId,
      actorId: userId,
      entityType: "seller",
      entityId: id,
      action: "seller.created",
      metadata: { raffleId: raffle.id },
    });
    return { id };
  });
}

export interface AssignResult {
  assigned: number[];
  reassigned: number[];
  unchanged: number[];
}

/**
 * Asigna talonarios a un responsable. Los que ya tenían otro responsable solo se reasignan con
 * `allowReassign`; la fila anterior se cierra (historial) y se abre una nueva. Idempotente y atómico.
 */
export async function assignBooklets(
  db: Database,
  userId: string,
  raffleId: string,
  sellerId: string,
  folios: number[],
  opts: { allowReassign?: boolean } = {},
): Promise<AssignResult> {
  const { raffle } = await authorizeRaffle(db, userId, raffleId, "sellers:manage");
  if (folios.length === 0) throw new CampaignError("invalid", "Indique al menos un folio.");
  const sorted = [...new Set(folios)].sort((a, b) => a - b);
  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    await lockRaffle(tx, raffle.id, raffle.organizationId);
    const [seller] = rowsOf<{ id: string; status: string }>(
      await tx.execute(sql`
        SELECT "id", "status" FROM "sellers"
        WHERE "id" = ${sellerId} AND "raffle_id" = ${raffle.id} AND "organization_id" = ${raffle.organizationId} FOR UPDATE`),
    );
    if (!seller) throw notFound();
    if (seller.status !== "active") throw new CampaignError("state", "El responsable está revocado.");

    const bks = rowsOf<{ id: string; folio: number }>(
      await tx.execute(sql`
        SELECT "id", "folio" FROM "booklets"
        WHERE "raffle_id" = ${raffle.id} AND "folio" IN (${sql.join(sorted.map((f) => sql`${f}`), sql`, `)})
        ORDER BY "folio" FOR UPDATE`),
    );
    if (bks.length !== sorted.length) throw new CampaignError("invalid", "Hay folios que no existen en esta rifa.");
    const active = rowsOf<{ id: string; booklet_id: string; seller_id: string }>(
      await tx.execute(sql`
        SELECT "id", "booklet_id", "seller_id" FROM "booklet_assignments"
        WHERE "raffle_id" = ${raffle.id} AND "ended_at" IS NULL
          AND "booklet_id" IN (${sql.join(bks.map((b) => sql`${b.id}::uuid`), sql`, `)})`),
    );
    const cur = new Map(active.map((a) => [a.booklet_id, a]));
    const result: AssignResult = { assigned: [], reassigned: [], unchanged: [] };
    const toMove = bks.filter((b) => {
      if (cur.get(b.id)?.seller_id === sellerId) {
        result.unchanged.push(Number(b.folio));
        return false;
      }
      return true;
    });
    if (!opts.allowReassign && toMove.some((b) => cur.has(b.id))) {
      const held = toMove.filter((b) => cur.has(b.id)).map((b) => Number(b.folio));
      throw new CampaignError("conflict", `Los folios ${held.join(", ")} ya tienen responsable. Confirme la reasignación.`);
    }
    for (const b of toMove) {
      const a = cur.get(b.id);
      if (a) {
        await tx.execute(sql`
          UPDATE "booklet_assignments" SET "ended_at" = now(), "ended_by" = ${userId} WHERE "id" = ${a.id}`);
        result.reassigned.push(Number(b.folio));
      } else result.assigned.push(Number(b.folio));
      await tx.execute(sql`
        INSERT INTO "booklet_assignments" ("raffle_id", "organization_id", "booklet_id", "seller_id", "assigned_by")
        VALUES (${raffle.id}, ${raffle.organizationId}, ${b.id}, ${sellerId}, ${userId})`);
    }
    if (toMove.length > 0) {
      await recordAuditEvent(tx, {
        organizationId: raffle.organizationId,
        actorId: userId,
        entityType: "seller",
        entityId: sellerId,
        action: result.reassigned.length > 0 ? "booklets.reassigned" : "booklets.assigned",
        metadata: { raffleId: raffle.id, assigned: result.assigned, reassigned: result.reassigned },
      });
    }
    return result;
  });
}

/** Quita el responsable vigente de los talonarios indicados (el historial se conserva). */
export async function unassignBooklets(db: Database, userId: string, raffleId: string, folios: number[]): Promise<number[]> {
  const { raffle } = await authorizeRaffle(db, userId, raffleId, "sellers:manage");
  if (folios.length === 0) throw new CampaignError("invalid", "Indique al menos un folio.");
  const sorted = [...new Set(folios)].sort((a, b) => a - b);
  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    await lockRaffle(tx, raffle.id, raffle.organizationId);
    const ended = rowsOf<{ folio: number }>(
      await tx.execute(sql`
        UPDATE "booklet_assignments" a SET "ended_at" = now(), "ended_by" = ${userId}
        FROM "booklets" bk
        WHERE bk."id" = a."booklet_id" AND a."raffle_id" = ${raffle.id} AND a."ended_at" IS NULL
          AND bk."folio" IN (${sql.join(sorted.map((f) => sql`${f}`), sql`, `)})
        RETURNING bk."folio"`),
    ).map((r) => Number(r.folio));
    if (ended.length > 0) {
      await recordAuditEvent(tx, {
        organizationId: raffle.organizationId,
        actorId: userId,
        entityType: "raffle",
        entityId: raffle.id,
        action: "booklets.unassigned",
        metadata: { folios: ended },
      });
    }
    return ended.sort((a, b) => a - b);
  });
}

/** Revoca el enlace del responsable y cierra sus asignaciones vigentes. Pedidos e historial se conservan. */
export async function revokeSeller(db: Database, userId: string, raffleId: string, sellerId: string) {
  const { raffle } = await authorizeRaffle(db, userId, raffleId, "sellers:manage");
  await db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    await lockRaffle(tx, raffle.id, raffle.organizationId);
    const rows = rowsOf<{ id: string }>(
      await tx.execute(sql`
        UPDATE "sellers" SET "status" = 'revoked', "updated_at" = now()
        WHERE "id" = ${sellerId} AND "raffle_id" = ${raffle.id} AND "organization_id" = ${raffle.organizationId}
          AND "status" = 'active' RETURNING "id"`),
    );
    if (rows.length === 0) throw notFound();
    await tx.execute(sql`
      UPDATE "booklet_assignments" SET "ended_at" = now(), "ended_by" = ${userId}
      WHERE "seller_id" = ${sellerId} AND "ended_at" IS NULL`);
    await recordAuditEvent(tx, {
      organizationId: raffle.organizationId,
      actorId: userId,
      entityType: "seller",
      entityId: sellerId,
      action: "seller.revoked",
      metadata: { raffleId: raffle.id },
    });
  });
}

/**
 * Extiende el plazo de ventas de una campaña publicada que aún tiene participaciones sin vender.
 * Queda auditado con las fechas anterior y nueva y el motivo; nunca adelanta el cierre.
 */
export async function extendSalesClose(
  db: Database,
  userId: string,
  raffleId: string,
  input: { salesClosesAt: Date; drawAt: Date; reason: string },
) {
  const { raffle } = await authorizeRaffle(db, userId, raffleId, "raffle:close");
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 5 || reason.length > 300) throw new CampaignError("invalid", "Indique el motivo (5 a 300 caracteres).");
  if (input.salesClosesAt.getTime() <= Date.now()) throw new CampaignError("invalid", "El nuevo cierre debe estar en el futuro.");
  if (input.drawAt.getTime() <= input.salesClosesAt.getTime())
    throw new CampaignError("invalid", "El sorteo debe ser posterior al nuevo cierre de ventas.");
  await db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    const r = await lockRaffle(tx, raffle.id, raffle.organizationId);
    if (r.status !== "published") throw new CampaignError("state", "Solo se extiende el plazo de una campaña publicada.");
    if (!r.salesClosesAt || !r.drawAt) throw new CampaignError("state", "La campaña no tiene fechas definidas.");
    if (input.salesClosesAt.getTime() <= r.salesClosesAt.getTime())
      throw new CampaignError("invalid", "El nuevo cierre debe ser posterior al actual.");
    const [c] = rowsOf<{ total: string; sold: string }>(
      await tx.execute(sql`
        SELECT count(*) AS total, count(*) FILTER (WHERE "status" = 'sold') AS sold
        FROM "raffle_numbers" WHERE "raffle_id" = ${r.id}`),
    );
    if (+c.sold === +c.total) throw new CampaignError("state", "Todas las participaciones están vendidas: no hace falta extender.");
    await tx
      .update(raffles)
      .set({ salesClosesAt: input.salesClosesAt, drawAt: input.drawAt })
      .where(and(eq(raffles.id, r.id), eq(raffles.organizationId, r.organizationId)));
    await recordAuditEvent(tx, {
      organizationId: r.organizationId,
      actorId: userId,
      entityType: "raffle",
      entityId: r.id,
      action: "raffle.sales_extended",
      metadata: {
        previousSalesClosesAt: r.salesClosesAt.toISOString(),
        previousDrawAt: r.drawAt.toISOString(),
        salesClosesAt: input.salesClosesAt.toISOString(),
        drawAt: input.drawAt.toISOString(),
        reason,
      },
    });
  });
}

export interface SellerPortal {
  sellerName: string;
  raffle: { slug: string; title: string; salesClosesAt: Date | null };
  folios: { folio: number; total: number; available: number; reservedDemo: number; simulatedSold: number; sold: number }[];
  salesOpen: boolean;
}

/**
 * Vista restringida del responsable por su enlace opaco: solo sus talonarios y su avance, sin datos
 * personales ni privilegios administrativos. Un enlace desconocido o revocado equivale a inexistente.
 */
export async function getSellerPortal(db: Database, token: string): Promise<SellerPortal | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [s] = rowsOf<{
    id: string; display_name: string; slug: string; title: string;
    sales_closes_at: Date | string | null; closed: boolean;
  }>(
    await db.execute(sql`
      SELECT s."id", s."display_name", r."slug", r."title", r."sales_closes_at",
             (r."sales_closes_at" IS NOT NULL AND now() >= r."sales_closes_at") AS closed
      FROM "sellers" s JOIN "raffles" r ON r."id" = s."raffle_id"
      WHERE s."token_hash" = ${hashValue(token)} AND s."status" = 'active' AND r."status" = 'published'`),
  );
  if (!s) return null;
  const rows = rowsOf<{ folio: number; total: string; available: string; reserved: string; sold: string; simulated_sold: string }>(
    await db.execute(sql`
      SELECT bk."folio", ${COUNT_COLS}
      FROM "booklet_assignments" a
      JOIN "booklets" bk ON bk."id" = a."booklet_id"
      LEFT JOIN "raffle_numbers" n ON n."booklet_id" = bk."id"
      WHERE a."seller_id" = ${s.id} AND a."ended_at" IS NULL
      GROUP BY bk."folio" ORDER BY bk."folio"`),
  );
  return {
    sellerName: s.display_name,
    raffle: { slug: s.slug, title: s.title, salesClosesAt: s.sales_closes_at ? new Date(s.sales_closes_at) : null },
    folios: rows.map((r) => ({
      folio: Number(r.folio),
      total: +r.total,
      available: +r.available,
      reservedDemo: +r.reserved,
      simulatedSold: +r.simulated_sold,
      sold: +r.sold,
    })),
    salesOpen: !s.closed,
  };
}
