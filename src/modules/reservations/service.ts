import { createHash, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@/platform/db/types";
import { participationLabel } from "@/modules/raffles/booklets";
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
  totalCents: number;
  currency: string;
  expiresAt: Date;
  raffleTitle: string;
  raffleSlug: string;
  isDemo: true;
}

/** Libera (en la transaccion en curso) las reservas vencidas de una rifa. */
export async function expireStale(tx: Database, raffleId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE "orders" SET "status" = 'expired', "updated_at" = now()
    WHERE "raffle_id" = ${raffleId} AND "is_demo" AND "status" = 'pending' AND "expires_at" <= now()`);
  await tx.execute(sql`
    UPDATE "raffle_numbers" SET "status" = 'available', "reservation_id" = NULL, "reserved_until" = NULL
    WHERE "raffle_id" = ${raffleId} AND "status" = 'reserved' AND "reserved_until" <= now()`);
}

async function loadView(tx: Database, orderId: string): Promise<ReservationView> {
  const [o] = rowsOf<{
    id: string; status: ReservationView["status"]; total_cents: number; currency: string;
    expires_at: Date | string; title: string; slug: string;
  }>(
    await tx.execute(sql`
      SELECT o."id", o."status", o."total_cents", o."currency", o."expires_at", r."title", r."slug"
      FROM "orders" o JOIN "raffles" r ON r."id" = o."raffle_id" WHERE o."id" = ${orderId}`),
  );
  const nums = rowsOf<{ number: string; local_number: number | null }>(
    await tx.execute(sql`
      SELECT n."number", n."local_number" FROM "order_items" i JOIN "raffle_numbers" n ON n."id" = i."raffle_number_id"
      WHERE i."order_id" = ${orderId} ORDER BY n."number"`),
  );
  return {
    orderId: o.id,
    status: o.status,
    numbers: nums.map((n) => n.number),
    labels: nums.map((n) => participationLabel(n.number, n.local_number !== null)),
    totalCents: Number(o.total_cents),
    currency: o.currency,
    expiresAt: new Date(o.expires_at),
    raffleTitle: o.title,
    raffleSlug: o.slug,
    isDemo: true,
  };
}

export interface ReserveInput {
  slug: string;
  numbers: string[];
  requestKey: string;
  buyer: BuyerInput;
  /** Talonarios: datos del participante de cada número, indexados por la clave de la participación. */
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
               ("sales_closes_at" IS NOT NULL AND now() >= "sales_closes_at") AS closed
        FROM "raffles"
        WHERE "slug" = ${input.slug} AND "status" = 'published' FOR SHARE`),
    );
    if (!raffle) throw new ReservationError("not_found", "La rifa no esta disponible.");

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

    if (raffle.closed) throw new ReservationError("state", "Las ventas de esta campaña ya cerraron.");

    // Participantes: obligatorios y uno por numero en talonarios; no se admiten en rifas individuales.
    const participants = new Map<string, ParticipantValue>();
    if (raffle.numbering_mode === "booklets") {
      if (!input.consent)
        throw new ReservationError("invalid", "Confirme que esta autorizado a facilitar los datos de los participantes.");
      const given = input.participants ?? {};
      const extra = Object.keys(given).filter((k) => !numbers.includes(k));
      if (extra.length > 0) throw new ReservationError("invalid", "Hay datos de participantes que no corresponden a la seleccion.");
      for (const n of numbers) {
        const p = validateParticipant(given[n]);
        if (!p.ok) throw new ReservationError("invalid", "Revise los datos de cada participante (nombre y correo son obligatorios).");
        participants.set(n, p.value);
      }
    } else if (input.participants && Object.keys(input.participants).length > 0) {
      throw new ReservationError("invalid", "Esta rifa no admite participantes por numero.");
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
    if (cur.status === "pending") {
      await tx.execute(sql`UPDATE "orders" SET "status" = 'cancelled', "updated_at" = now() WHERE "id" = ${o.id}`);
      await tx.execute(sql`
        UPDATE "raffle_numbers" SET "status" = 'available', "reservation_id" = NULL, "reserved_until" = NULL
        WHERE "reservation_id" = ${o.id} AND "status" = 'reserved'`);
    }
    return loadView(tx, o.id);
  });
}

export type NumberFilter = "all" | "available" | "reserved" | "sold";

export interface NumberPage {
  /** `number` es la clave única; `label` la referencia visible ("T-0007 / N-14" o el propio número). */
  items: { number: string; label: string; folio: number | null; status: "available" | "reserved" | "sold" }[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RaffleCounts {
  available: number;
  reserved: number;
  sold: number;
  total: number;
}

/** Contadores reales: una reserva vencida cuenta como disponible. */
export async function getPublicCounts(db: Database, raffleId: string, folio?: number | null): Promise<RaffleCounts> {
  const folioCond = folio ? sql` AND "booklet_id" IN (SELECT "id" FROM "booklets" WHERE "raffle_id" = ${raffleId} AND "folio" = ${folio})` : sql``;
  const [c] = rowsOf<{ available: string; reserved: string; sold: string; total: string }>(
    await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE "status" = 'available' OR ("status" = 'reserved' AND "reserved_until" <= now())) AS available,
        count(*) FILTER (WHERE "status" = 'reserved' AND "reserved_until" > now()) AS reserved,
        count(*) FILTER (WHERE "status" = 'sold') AS sold,
        count(*) AS total
      FROM "raffle_numbers" WHERE "raffle_id" = ${raffleId}${folioCond}`),
  );
  return { available: +c.available, reserved: +c.reserved, sold: +c.sold, total: +c.total };
}

export interface BookletSummary {
  folio: number;
  total: number;
  available: number;
  reserved: number;
  sold: number;
}

/** Disponibilidad efectiva por talonario (una reserva vencida cuenta como disponible). */
export async function listBookletSummaries(db: Database, raffleId: string): Promise<BookletSummary[]> {
  const rows = rowsOf<{ folio: number; total: string; available: string; reserved: string; sold: string }>(
    await db.execute(sql`
      SELECT b."folio",
        count(n.*) AS total,
        count(n.*) FILTER (WHERE n."status" = 'available' OR (n."status" = 'reserved' AND n."reserved_until" <= now())) AS available,
        count(n.*) FILTER (WHERE n."status" = 'reserved' AND n."reserved_until" > now()) AS reserved,
        count(n.*) FILTER (WHERE n."status" = 'sold') AS sold
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
  const items = rowsOf<{ number: string; folio: number | null; local_number: number | null; st: "available" | "reserved" | "sold" }>(
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
