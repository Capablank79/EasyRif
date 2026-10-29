import { createHash, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@/platform/db/types";
import { participationLabel } from "@/modules/raffles/booklets";
import { recordAuditEvent } from "@/platform/audit";
import { validateParticipant, type ParticipantInput, type ParticipantValue } from "./participants";

export type ReservationErrorCode =
  | "not_found"
  | "invalid"
  | "unavailable"
  | "limit"
  | "state"
  | "conflict";

/** Error de dominio con mensaje seguro para mostrar al visitante. */
export class ReservationError extends Error {
  constructor(
    public code: ReservationErrorCode,
    message: string,
    public unavailable: string[] = [],
  ) {
    super(message);
    this.name = "ReservationError";
  }
}

const asDb = (tx: unknown) => tx as Database;
const rowsOf = <T>(res: unknown): T[] =>
  (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];

export interface ReservationConfig {
  ttlMinutes: number;
  maxSelection: number;
}

/** Configuracion del servidor (nunca del cliente). */
export function getReservationConfig(
  env: Record<string, string | undefined> = process.env,
): ReservationConfig {
  const clamp = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : d;
  };
  return {
    ttlMinutes: clamp(env.RESERVATION_TTL_MINUTES, 10, 1, 60),
    maxSelection: clamp(env.RESERVATION_MAX_SELECTION, 10, 1, 50),
  };
}

export const REQUEST_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export const hashValue = (v: string) => createHash("sha256").update(v).digest("hex");

/** El token de acceso se deriva de la clave de idempotencia: un reintento recupera el mismo token. */
export function deriveAccessToken(requestKey: string, secret = process.env.BETTER_AUTH_SECRET): string {
  if (!secret) throw new Error("BETTER_AUTH_SECRET no esta configurado");
  return createHmac("sha256", secret).update(`reserva:${requestKey}`).digest("base64url");
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface BuyerInput {
  name: string;
  email?: string;
  phone?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateBuyer(
  raw: BuyerInput,
): { ok: true; value: { name: string; email: string | null; phone: string | null } } | { ok: false; error: string } {
  const name = (raw.name ?? "").trim();
  const email = (raw.email ?? "").trim().toLowerCase();
  const phone = (raw.phone ?? "").trim();
  if (name.length < 2 || name.length > 100) return { ok: false, error: "Indique su nombre (2 a 100 caracteres)." };
  if (!email && !phone) return { ok: false, error: "Indique un correo o un telefono de contacto." };
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return { ok: false, error: "El correo no es valido." };
  if (phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) return { ok: false, error: "El telefono no es valido." };
  return { ok: true, value: { name, email: email || null, phone: phone || null } };
}

export interface ReservationView {
  orderId: string;
  status: "pending" | "cancelled" | "expired";
  numbers: string[];
  /** Referencias visibles, en el mismo orden que `numbers`. */
  labels: string[];
  participants: { label: string; name: string }[];
  unitPriceCents: number;
  totalCents: number;
  currency: string;
  expiresAt: Date;
  raffleTitle: string;
  raffleSlug: string;
  isDemo: true;
  canConfirmSimulation: boolean;
  simulationConfirmedAt: Date | null;
  simulationPaidAt: Date | null;
}

/** La confirmación ficticia solo existe en desarrollo/pruebas o con autorización explícita en producción. */
export function isDemoPurchaseConfirmationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.EASYRIF_ENABLE_DEMO_CONFIRMATION === "true";
}

/** Libera (en la transaccion en curso) las reservas vencidas de una rifa. */
export async function expireStale(tx: Database, raffleId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE "orders" SET "status" = 'expired', "updated_at" = now()
    WHERE "raffle_id" = ${raffleId} AND "is_demo" AND "status" = 'pending'
      AND ("expires_at" <= now() OR EXISTS (SELECT 1 FROM "raffles" r
        WHERE r."id" = "orders"."raffle_id" AND r."sales_closes_at" IS NOT NULL AND clock_timestamp() >= r."sales_closes_at"))
      AND NOT EXISTS (SELECT 1 FROM "audit_events" ae WHERE ae."organization_id" = "orders"."organization_id"
        AND ae."entity_type" = 'demo_purchase' AND ae."entity_id" = "orders"."id" AND ae."action" = 'demo.purchase_confirmed')`);
  await tx.execute(sql`
    UPDATE "raffle_numbers" SET "status" = 'available', "reservation_id" = NULL, "reserved_until" = NULL
    WHERE "raffle_id" = ${raffleId} AND "status" = 'reserved'
      AND ("reserved_until" <= now() OR EXISTS (SELECT 1 FROM "orders" o
        WHERE o."id" = "raffle_numbers"."reservation_id" AND o."status" = 'expired'))`);
}

/** Expira reservas en una lectura de disponibilidad, incluidas las que alcanzaron el cierre comercial. */
export async function expireCampaignReservations(db: Database, raffleId: string): Promise<void> {
  await db.transaction(async (tx) => expireStale(asDb(tx), raffleId));
}

async function loadView(tx: Database, orderId: string): Promise<ReservationView> {
  const [o] = rowsOf<{
    id: string; status: ReservationView["status"]; total_cents: number; currency: string;
    expires_at: Date | string; title: string; slug: string; seller_id: string | null;
    price_cents: number; raffle_status: string; sales_open: boolean; simulation_confirmed_at: Date | string | null; simulation_paid_at: Date | string | null;
  }>(
    await tx.execute(sql`
      SELECT o."id", o."status", o."total_cents", o."currency", o."expires_at", o."seller_id",
        r."title", r."slug", r."price_cents", r."status" AS raffle_status,
        (r."sales_closes_at" IS NULL OR clock_timestamp() < r."sales_closes_at") AS sales_open,
        (SELECT ae."created_at" FROM "audit_events" ae WHERE ae."organization_id" = o."organization_id"
          AND ae."entity_type" = 'demo_purchase' AND ae."entity_id" = o."id" AND ae."action" = 'demo.purchase_confirmed'
          ORDER BY ae."created_at" LIMIT 1) AS simulation_confirmed_at,
        (SELECT ae."created_at" FROM "audit_events" ae WHERE ae."organization_id" = o."organization_id"
          AND ae."entity_type" = 'demo_payment' AND ae."entity_id" = o."id" AND ae."action" = 'demo.payment_simulated'
          ORDER BY ae."created_at" LIMIT 1) AS simulation_paid_at
      FROM "orders" o JOIN "raffles" r ON r."id" = o."raffle_id" WHERE o."id" = ${orderId}`),
  );
  const nums = rowsOf<{ number: string; local_number: number | null; participant_name: string | null }>(
    await tx.execute(sql`
      SELECT n."number", n."local_number", p."name" AS participant_name
      FROM "order_items" i
      JOIN "raffle_numbers" n ON n."id" = i."raffle_number_id"
      LEFT JOIN "order_item_participants" p ON p."order_item_id" = i."id" AND p."order_id" = i."order_id"
      WHERE i."order_id" = ${orderId} ORDER BY n."number"`),
  );
  return {
    orderId: o.id,
    status: o.status,
    numbers: nums.map((n) => n.number),
    labels: nums.map((n) => participationLabel(n.number, n.local_number !== null)),
    participants: nums.flatMap((n) => n.participant_name ? [{ label: participationLabel(n.number, n.local_number !== null), name: n.participant_name }] : []),
    unitPriceCents: Number(o.price_cents),
    totalCents: Number(o.total_cents),
    currency: o.currency,
    expiresAt: new Date(o.expires_at),
    raffleTitle: o.title,
    raffleSlug: o.slug,
    isDemo: true,
    canConfirmSimulation: o.status === "pending" && o.raffle_status === "published" && o.sales_open,
    simulationConfirmedAt: o.simulation_confirmed_at ? new Date(o.simulation_confirmed_at) : null,
    simulationPaidAt: o.simulation_paid_at ? new Date(o.simulation_paid_at) : null,
  };
}

export interface ReserveInput {
  slug: string;
  numbers: string[];
  requestKey: string;
  buyer: BuyerInput;
  /** Datos del participante de cada número, indexados por la clave de la participación. */
  participants?: Record<string, Partial<ParticipantInput>>;
  /** El comprador confirma estar autorizado a facilitar datos de terceros. */
  consent?: boolean;
  /** Token opaco del enlace de un responsable: restringe a sus talonarios y atribuye el pedido. */
  sellerToken?: string;
}

/**
 * Reserva temporal de demostracion, atomica: todos los numeros o ninguno.
 * No hay pago, venta ni participacion real: el pedido queda `pending` + `is_demo`.
 */
export async function reserveNumbers(
  db: Database,
  input: ReserveInput,
  config: ReservationConfig = getReservationConfig(),
  secret?: string,
): Promise<{ token: string; reservation: ReservationView; replay: boolean }> {
  if (!REQUEST_KEY_RE.test(input.requestKey)) throw new ReservationError("invalid", "Solicitud invalida.");
  const buyer = validateBuyer(input.buyer);
  if (!buyer.ok) throw new ReservationError("invalid", buyer.error);
  const numbers = [...new Set(input.numbers.map((n) => String(n).trim().toUpperCase()))];
  if (numbers.length === 0) throw new ReservationError("invalid", "Seleccione al menos un numero.");
  if (numbers.some((n) => !/^[A-Z0-9]{1,12}$/.test(n))) throw new ReservationError("invalid", "Numeros invalidos.");
  if (numbers.length > config.maxSelection)
    throw new ReservationError("limit", `Puede reservar como maximo ${config.maxSelection} numeros a la vez.`);
  numbers.sort();

  const token = deriveAccessToken(input.requestKey, secret);
  const tokenHash = hashValue(token);
  const keyHash = hashValue(input.requestKey);

  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    const [raffle] = rowsOf<{
      id: string; organization_id: string; price_cents: number; currency: string;
      numbering_mode: "individual" | "booklets"; closed: boolean;
    }>(
      await tx.execute(sql`
        SELECT "id", "organization_id", "price_cents", "currency", "numbering_mode",
               ("sales_closes_at" IS NOT NULL AND clock_timestamp() >= "sales_closes_at") AS closed
        FROM "raffles"
        WHERE "slug" = ${input.slug} AND "status" = 'published' FOR SHARE`),
    );
    if (!raffle) throw new ReservationError("not_found", "La rifa no esta disponible.");
    if (raffle.closed) throw new ReservationError("state", "Las ventas de esta campaña ya cerraron.");

    // Reintento idempotente: mismo pedido, sin tocar numeros.
    const [prior] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        SELECT "id" FROM "orders" WHERE "raffle_id" = ${raffle.id} AND "request_key_hash" = ${keyHash}`),
    );
    if (prior) {
      const view = await loadView(tx, prior.id);
      if (view.numbers.join(",") !== numbers.join(","))
        throw new ReservationError("conflict", "Esta solicitud ya se uso con otra seleccion.");
      return { token, reservation: view, replay: true };
    }

    // Cada número debe conservar el vínculo con su participante, también en rifas individuales.
    const participants = new Map<string, ParticipantValue>();
    if (!input.consent) {
      throw new ReservationError("invalid", "Confirme que cuenta con autorización para registrar los datos de cada participante.");
    }
    const given = input.participants ?? {};
    const extra = Object.keys(given).filter((k) => !numbers.includes(k));
    if (extra.length > 0) throw new ReservationError("invalid", "Hay datos de participantes que no corresponden a la selección.");
    for (const n of numbers) {
      const p = validateParticipant(given[n]);
      if (!p.ok) throw new ReservationError("invalid", "Revise los datos de cada participante: nombre y correo son obligatorios.");
      participants.set(n, p.value);
    }

    let sellerId: string | null = null;
    if (input.sellerToken) {
      if (!TOKEN_RE.test(input.sellerToken)) throw new ReservationError("not_found", "El enlace del responsable no es valido.");
      const [s] = rowsOf<{ id: string }>(
        await tx.execute(sql`
          SELECT "id" FROM "sellers" WHERE "token_hash" = ${hashValue(input.sellerToken)}
            AND "status" = 'active' AND "raffle_id" = ${raffle.id}`),
      );
      if (!s) throw new ReservationError("not_found", "El enlace del responsable no es valido.");
      sellerId = s.id;
    }

    await expireStale(tx, raffle.id);

    // Bloqueo en orden estable para evitar interbloqueos entre reservas concurrentes.
    const locked = rowsOf<{ id: string; number: string; status: string }>(
      await tx.execute(sql`
        SELECT "id", "number", "status" FROM "raffle_numbers"
        WHERE "raffle_id" = ${raffle.id} AND "number" IN (${sql.join(numbers.map((n) => sql`${n}`), sql`, `)})
        ORDER BY "number" FOR UPDATE`),
    );
    const byNumber = new Map(locked.map((r) => [r.number, r]));
    if (sellerId) {
      // Con enlace de responsable solo se reservan numeros de sus talonarios vigentes.
      const own = rowsOf<{ number: string }>(
        await tx.execute(sql`
          SELECT n."number" FROM "raffle_numbers" n
          JOIN "booklet_assignments" a ON a."booklet_id" = n."booklet_id" AND a."ended_at" IS NULL
          WHERE n."raffle_id" = ${raffle.id} AND a."seller_id" = ${sellerId}
            AND n."number" IN (${sql.join(numbers.map((n) => sql`${n}`), sql`, `)})`),
      );
      const ownSet = new Set(own.map((o) => o.number));
      if (numbers.some((n) => !ownSet.has(n)))
        throw new ReservationError("invalid", "Hay numeros que no pertenecen a los talonarios de este responsable.");
    }
    const bad = numbers.filter((n) => byNumber.get(n)?.status !== "available");
    if (bad.length > 0)
      throw new ReservationError(
        "unavailable",
        "Algunos numeros ya no estan disponibles. No se reservo ninguno.",
        bad,
      );

    const [contact] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        INSERT INTO "buyer_contacts" ("organization_id", "name", "email", "phone")
        VALUES (${raffle.organization_id}, ${buyer.value.name}, ${buyer.value.email}, ${buyer.value.phone})
        RETURNING "id"`),
    );
    const total = Number(raffle.price_cents) * numbers.length;
    const [order] = rowsOf<{ id: string; expires_at: Date }>(
      await tx.execute(sql`
        INSERT INTO "orders" ("raffle_id", "organization_id", "buyer_contact_id", "seller_id", "status", "total_cents",
          "currency", "is_demo", "access_token_hash", "request_key_hash", "expires_at")
        VALUES (${raffle.id}, ${raffle.organization_id}, ${contact.id}, ${sellerId}, 'pending', ${total},
          ${raffle.currency}, true, ${tokenHash}, ${keyHash}, now() + make_interval(mins => ${config.ttlMinutes}))
        RETURNING "id", "expires_at"`),
    );
    for (const n of numbers) {
      const row = byNumber.get(n)!;
      const [item] = rowsOf<{ id: string }>(
        await tx.execute(sql`
          INSERT INTO "order_items" ("order_id", "raffle_id", "organization_id", "raffle_number_id", "price_cents")
          VALUES (${order.id}, ${raffle.id}, ${raffle.organization_id}, ${row.id}, ${raffle.price_cents})
          RETURNING "id"`),
      );
      const p = participants.get(n);
      if (p) {
        await tx.execute(sql`
          INSERT INTO "order_item_participants" ("order_item_id", "order_id", "raffle_id", "organization_id", "name", "email", "phone")
          VALUES (${item.id}, ${order.id}, ${raffle.id}, ${raffle.organization_id}, ${p.name}, ${p.email}, ${p.phone})`);
      }
    }
    await tx.execute(sql`
      UPDATE "raffle_numbers" SET "status" = 'reserved', "reservation_id" = ${order.id},
        "reserved_until" = ${order.expires_at}
      WHERE "raffle_id" = ${raffle.id} AND "id" IN (
        SELECT "raffle_number_id" FROM "order_items" WHERE "order_id" = ${order.id})`);

    return { token, reservation: await loadView(tx, order.id), replay: false };
  });
}

/** Consulta por token opaco. Un token desconocido responde igual que uno inexistente. */
export async function getReservation(db: Database, token: string): Promise<ReservationView | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashValue(token);
  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    const [o] = rowsOf<{ id: string; raffle_id: string }>(
      await tx.execute(sql`SELECT "id", "raffle_id" FROM "orders" WHERE "access_token_hash" = ${hash} AND "is_demo"`),
    );
    if (!o) return null;
    await expireStale(tx, o.raffle_id);
    return loadView(tx, o.id);
  });
}

/**
 * Registra una confirmación ficticia como evento de auditoría append-only. El pedido demo permanece
 * `pending`; conserva el estado de venta real separado y marca los números como vendidos en DEMO.
 */
export async function confirmSimulatedPurchase(
  db: Database,
  token: string,
): Promise<{ confirmedAt: Date; replay: boolean; raffleId: string }> {
  if (!isDemoPurchaseConfirmationEnabled()) throw new ReservationError("state", "La simulación de compra no está habilitada en este ambiente.");
  if (!TOKEN_RE.test(token)) throw new ReservationError("not_found", "Reserva no encontrada.");
  const accessHash = hashValue(token);
  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    const [initial] = rowsOf<{ id: string; raffle_id: string; organization_id: string }>(
      await tx.execute(sql`SELECT "id", "raffle_id", "organization_id" FROM "orders" WHERE "access_token_hash" = ${accessHash} AND "is_demo"`),
    );
    if (!initial) throw new ReservationError("not_found", "Reserva no encontrada.");

    // Serializa con asignaciones y otras confirmaciones de esta rifa; el registro es idempotente.
    const [raffle] = rowsOf<{ id: string; numbering_mode: string; status: string; sales_closes_at: Date | string | null; sales_closed: boolean }>(
      await tx.execute(sql`
        SELECT "id", "numbering_mode", "status", "sales_closes_at",
          ("sales_closes_at" IS NOT NULL AND clock_timestamp() >= "sales_closes_at") AS sales_closed FROM "raffles"
        WHERE "id" = ${initial.raffle_id} AND "organization_id" = ${initial.organization_id} FOR UPDATE`),
    );
    if (!raffle || raffle.status !== "published") {
      throw new ReservationError("state", "La confirmación simulada solo está disponible para rifas publicadas.");
    }
    const [prior] = rowsOf<{ created_at: Date | string }>(
      await tx.execute(sql`
        SELECT "created_at" FROM "audit_events" WHERE "organization_id" = ${initial.organization_id}
          AND "entity_type" = 'demo_purchase' AND "entity_id" = ${initial.id} AND "action" = 'demo.purchase_confirmed'
        ORDER BY "created_at" LIMIT 1`),
    );
    if (prior) return { confirmedAt: new Date(prior.created_at), replay: true, raffleId: raffle.id };

    if (raffle.sales_closed) {
      throw new ReservationError("state", "Las ventas cerraron a las 22:00. La reserva pendiente venció y no se registró el pago simulado.");
    }

    await expireStale(tx, raffle.id);
    const [order] = rowsOf<{ id: string; seller_id: string | null; status: string; expires_at: Date | string; total_cents: number; currency: string }>(
      await tx.execute(sql`
        SELECT "id", "seller_id", "status", "expires_at", "total_cents", "currency"
        FROM "orders" WHERE "id" = ${initial.id} AND "organization_id" = ${initial.organization_id}
          AND "is_demo" AND "access_token_hash" = ${accessHash} FOR UPDATE`),
    );
    if (!order || order.status !== "pending" || new Date(order.expires_at).getTime() <= Date.now()) {
      throw new ReservationError("state", "La reserva ya no está activa; no se registró ninguna simulación.");
    }
    const items = rowsOf<{
      order_item_id: string; raffle_number_id: string; number: string; booklet_id: string | null;
      folio: number | null; seller_id: string | null; participant_id: string | null; reservation_id: string | null;
      status: string; reserved_until: Date | string | null;
    }>(
      await tx.execute(sql`
        SELECT oi."id" AS order_item_id, n."id" AS raffle_number_id, n."number", bk."id" AS booklet_id,
          bk."folio", a."seller_id", p."id" AS participant_id, n."reservation_id", n."status", n."reserved_until"
        FROM "order_items" oi
        JOIN "raffle_numbers" n ON n."id" = oi."raffle_number_id" AND n."raffle_id" = oi."raffle_id" AND n."organization_id" = oi."organization_id"
        LEFT JOIN "booklets" bk ON bk."id" = n."booklet_id" AND bk."raffle_id" = oi."raffle_id" AND bk."organization_id" = oi."organization_id"
        LEFT JOIN "booklet_assignments" a ON a."booklet_id" = bk."id" AND a."raffle_id" = oi."raffle_id" AND a."organization_id" = oi."organization_id" AND a."ended_at" IS NULL
        LEFT JOIN "order_item_participants" p ON p."order_item_id" = oi."id" AND p."order_id" = oi."order_id" AND p."raffle_id" = oi."raffle_id"
        WHERE oi."order_id" = ${order.id} AND oi."raffle_id" = ${raffle.id} AND oi."organization_id" = ${initial.organization_id}
        ORDER BY n."number" FOR UPDATE OF n`),
    );
    if (items.length === 0 || items.some((i) =>
      !i.participant_id || i.status !== "reserved" || i.reservation_id !== order.id || !i.reserved_until ||
      new Date(i.reserved_until).getTime() <= Date.now() ||
      (raffle.numbering_mode === "booklets" ? !i.booklet_id || i.folio === null : i.booklet_id !== null || i.folio !== null) ||
      (order.seller_id !== null && i.seller_id !== order.seller_id)
    )) {
      throw new ReservationError("state", "La asignación, los participantes o la reserva cambiaron. No se registró la simulación.");
    }

    // La simulación consume la disponibilidad, pero nunca convierte el número en una venta real.
    const soldDemo = rowsOf<{ id: string }>(await tx.execute(sql`
      UPDATE "raffle_numbers" SET "status" = 'simulated_sold', "reservation_id" = NULL,
        "reserved_until" = NULL, "updated_at" = now()
      WHERE "raffle_id" = ${raffle.id} AND "organization_id" = ${initial.organization_id}
        AND "reservation_id" = ${order.id} AND "status" = 'reserved'
        AND "id" IN (${sql.join(items.map((i) => sql`${i.raffle_number_id}`), sql`, `)})
      RETURNING "id"`));
    if (soldDemo.length !== items.length) {
      throw new ReservationError("state", "La reserva cambió durante la confirmación; no se registró la simulación.");
    }

    await recordAuditEvent(tx, {
      organizationId: initial.organization_id,
      actorId: null,
      entityType: "demo_purchase",
      entityId: order.id,
      action: "demo.purchase_confirmed",
      metadata: {
        simulation: true,
        state: "confirmed_fictional",
        raffleId: raffle.id,
        orderId: order.id,
        sellerId: order.seller_id,
        amountCents: Number(order.total_cents),
        currency: order.currency,
        itemCount: items.length,
        items: items.map((i) => ({
          orderItemId: i.order_item_id,
          raffleNumberId: i.raffle_number_id,
          number: i.number,
          bookletId: i.booklet_id,
          folio: i.folio === null ? null : Number(i.folio),
          sellerId: i.seller_id,
          participantId: i.participant_id,
          state: "confirmed_fictional",
        })),
      },
    });
    await recordAuditEvent(tx, {
      organizationId: initial.organization_id,
      actorId: null,
      entityType: "demo_payment",
      entityId: order.id,
      action: "demo.payment_simulated",
      metadata: {
        simulation: true,
        state: "paid_fictional",
        raffleId: raffle.id,
        orderId: order.id,
        sellerId: order.seller_id,
        amountCents: Number(order.total_cents),
        currency: order.currency,
        itemCount: items.length,
        purchaseState: "confirmed_fictional",
      },
    });
    const [created] = rowsOf<{ created_at: Date | string }>(
      await tx.execute(sql`
        SELECT "created_at" FROM "audit_events" WHERE "organization_id" = ${initial.organization_id}
          AND "entity_type" = 'demo_purchase' AND "entity_id" = ${order.id} AND "action" = 'demo.purchase_confirmed'
        ORDER BY "created_at" LIMIT 1`),
    );
    return { confirmedAt: new Date(created.created_at), replay: false, raffleId: raffle.id };
  });
}

/** Libera solo la reserva identificada por el token. Idempotente. */
export async function releaseReservation(db: Database, token: string): Promise<ReservationView | null> {
  if (!TOKEN_RE.test(token)) return null;
  const hash = hashValue(token);
  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    const [o] = rowsOf<{ id: string; raffle_id: string }>(
      await tx.execute(
        sql`SELECT "id", "raffle_id" FROM "orders" WHERE "access_token_hash" = ${hash} AND "is_demo" FOR UPDATE`,
      ),
    );
    if (!o) return null;
    await expireStale(tx, o.raffle_id);
    const [cur] = rowsOf<{ status: string }>(
      await tx.execute(sql`SELECT "status" FROM "orders" WHERE "id" = ${o.id}`),
    );
    const [confirmed] = rowsOf<{ id: string }>(await tx.execute(sql`
      SELECT "id" FROM "audit_events" WHERE "organization_id" = (SELECT "organization_id" FROM "orders" WHERE "id" = ${o.id})
        AND "entity_type" = 'demo_purchase' AND "entity_id" = ${o.id} AND "action" = 'demo.purchase_confirmed' LIMIT 1`));
    if (confirmed) return loadView(tx, o.id);
    if (cur.status === "pending") {
      await tx.execute(sql`UPDATE "orders" SET "status" = 'cancelled', "updated_at" = now() WHERE "id" = ${o.id}`);
      await tx.execute(sql`
        UPDATE "raffle_numbers" SET "status" = 'available', "reservation_id" = NULL, "reserved_until" = NULL
        WHERE "reservation_id" = ${o.id} AND "status" = 'reserved'`);
    }
    return loadView(tx, o.id);
  });
}

export type NumberFilter = "all" | "available" | "reserved" | "simulated_sold" | "sold";

export interface NumberPage {
  /** `number` es la clave única; `label` la referencia visible ("T-0007 / N-14" o el propio número). */
  items: { number: string; label: string; folio: number | null; status: "available" | "reserved" | "simulated_sold" | "sold" }[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RaffleCounts {
  available: number;
  reserved: number;
  sold: number;
  simulatedSold: number;
  total: number;
}

/** Contadores reales: una reserva vencida cuenta como disponible. */
export async function getPublicCounts(db: Database, raffleId: string, folio?: number | null): Promise<RaffleCounts> {
  const folioCond = folio ? sql` AND "booklet_id" IN (SELECT "id" FROM "booklets" WHERE "raffle_id" = ${raffleId} AND "folio" = ${folio})` : sql``;
  const [c] = rowsOf<{ available: string; reserved: string; sold: string; simulated_sold: string; total: string }>(
    await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE "status" = 'available' OR ("status" = 'reserved' AND "reserved_until" <= now())) AS available,
        count(*) FILTER (WHERE "status" = 'reserved' AND "reserved_until" > now()) AS reserved,
        count(*) FILTER (WHERE "status" = 'sold') AS sold,
        count(*) FILTER (WHERE "status" = 'simulated_sold') AS simulated_sold,
        count(*) AS total
      FROM "raffle_numbers" WHERE "raffle_id" = ${raffleId}${folioCond}`),
  );
  return { available: +c.available, reserved: +c.reserved, sold: +c.sold, simulatedSold: +c.simulated_sold, total: +c.total };
}

export interface BookletSummary {
  folio: number;
  total: number;
  available: number;
  reserved: number;
  sold: number;
  simulatedSold: number;
}

/** Disponibilidad efectiva por talonario (una reserva vencida cuenta como disponible). */
export async function listBookletSummaries(db: Database, raffleId: string): Promise<BookletSummary[]> {
  const rows = rowsOf<{ folio: number; total: string; available: string; reserved: string; sold: string; simulated_sold: string }>(
    await db.execute(sql`
      SELECT b."folio",
        count(n.*) AS total,
        count(n.*) FILTER (WHERE n."status" = 'available' OR (n."status" = 'reserved' AND n."reserved_until" <= now())) AS available,
        count(n.*) FILTER (WHERE n."status" = 'reserved' AND n."reserved_until" > now()) AS reserved,
        count(n.*) FILTER (WHERE n."status" = 'sold') AS sold,
        count(n.*) FILTER (WHERE n."status" = 'simulated_sold') AS simulated_sold
      FROM "booklets" b LEFT JOIN "raffle_numbers" n ON n."booklet_id" = b."id"
      WHERE b."raffle_id" = ${raffleId}
      GROUP BY b."folio" ORDER BY b."folio"`),
  );
  return rows.map((r) => ({
    folio: Number(r.folio),
    total: +r.total,
    available: +r.available,
    reserved: +r.reserved,
    sold: +r.sold,
    simulatedSold: +r.simulated_sold,
  }));
}

/** Pagina de numeros de una rifa publicada (maximo 200 por pagina). */
export async function listPublicNumbers(
  db: Database,
  raffleId: string,
  opts: { q?: string; filter?: NumberFilter; page?: number; pageSize?: number; folio?: number | null },
): Promise<NumberPage> {
  const pageSize = Math.min(Math.max(Math.trunc(opts.pageSize ?? 100) || 100, 1), 200);
  const page = Math.max(Math.trunc(opts.page ?? 1) || 1, 1);
  const q = (opts.q ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const eff = sql`CASE WHEN n."status" = 'reserved' AND n."reserved_until" <= now() THEN 'available' ELSE n."status"::text END`;
  const conds = [sql`n."raffle_id" = ${raffleId}`];
  if (q) {
    // En talonarios, un número solo coincide con el número interno (la clave empieza por "T").
    conds.push(/^\d+$/.test(q) ? sql`(n."number" LIKE ${q + "%"} OR n."local_number" = ${Number(q)})` : sql`n."number" LIKE ${q + "%"}`);
  }
  if (opts.folio) conds.push(sql`b."folio" = ${opts.folio}`);
  if (opts.filter && opts.filter !== "all") conds.push(sql`(${eff}) = ${opts.filter}`);
  const where = sql.join(conds, sql` AND `);
  const from = sql`"raffle_numbers" n LEFT JOIN "booklets" b ON b."id" = n."booklet_id"`;
  const [t] = rowsOf<{ n: string }>(await db.execute(sql`SELECT count(*) AS n FROM ${from} WHERE ${where}`));
  const items = rowsOf<{ number: string; folio: number | null; local_number: number | null; st: "available" | "reserved" | "simulated_sold" | "sold" }>(
    await db.execute(sql`
      SELECT n."number", b."folio", n."local_number", (${eff}) AS st FROM ${from} WHERE ${where}
      ORDER BY n."number" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
  );
  return {
    items: items.map((i) => ({
      number: i.number,
      label: participationLabel(i.number, i.local_number !== null),
      folio: i.folio === null ? null : Number(i.folio),
      status: i.st,
    })),
    total: +t.n,
    page,
    pageSize,
  };
}
