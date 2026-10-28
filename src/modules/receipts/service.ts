import { sql } from "drizzle-orm";
import { participationLabel } from "@/modules/raffles/booklets";
import { expireStale, hashValue, TOKEN_RE } from "@/modules/reservations/service";
import type { Database } from "@/platform/db/types";
import { deriveVerificationCode, hashVerificationCode, VERIFICATION_CODE_RE } from "./verification";

const asDb = (tx: unknown) => tx as Database;
const rowsOf = <T>(res: unknown): T[] =>
  (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as T[];

/** Tope de recursos: nunca se genera un PDF con mas numeros que esto. */
export const MAX_RECEIPT_NUMBERS = 200;

export type DemoStatus = "pending" | "cancelled" | "expired";

export interface ReceiptData {
  orderId: string;
  status: DemoStatus;
  raffleTitle: string;
  organizerName: string;
  numbers: string[];
  /** Participante por participación (solo PDF privado; nunca en QR ni verificación pública). */
  participants?: { label: string; name: string; email: string; phone: string | null }[];
  unitPriceCents: number;
  totalCents: number;
  currency: string;
  issuedAt: Date;
  expiresAt: Date;
  verificationCode: string;
}

export class ReceiptError extends Error {
  constructor(public code: "not_found" | "too_many_numbers", message: string) {
    super(message);
  }
}

interface OrderRow {
  id: string;
  raffle_id: string;
  status: DemoStatus;
  total_cents: number;
  currency: string;
  expires_at: Date | string;
  verification_hash: string | null;
  receipt_issued_at: Date | string | null;
  title: string;
  price_cents: number;
  org_name: string;
}

/**
 * Datos del comprobante a partir del token privado de la reserva. Emitir es idempotente: el codigo
 * es determinista y la primera emision fija `receipt_issued_at`/`verification_hash` con un UPDATE
 * condicionado, de modo que descargas concurrentes producen exactamente el mismo contenido.
 */
export async function getReceiptData(db: Database, token: string): Promise<ReceiptData> {
  if (!TOKEN_RE.test(token)) throw new ReceiptError("not_found", "Reserva no encontrada");
  const tokenHash = hashValue(token);
  return db.transaction(async (rawTx) => {
    const tx = asDb(rawTx);
    const [found] = rowsOf<{ id: string; raffle_id: string }>(
      await tx.execute(sql`SELECT "id", "raffle_id" FROM "orders" WHERE "access_token_hash" = ${tokenHash} AND "is_demo"`),
    );
    if (!found) throw new ReceiptError("not_found", "Reserva no encontrada");
    await expireStale(tx, found.raffle_id);

    const code = deriveVerificationCode(found.id);
    await tx.execute(sql`
      UPDATE "orders" SET "verification_hash" = ${hashVerificationCode(code)}, "receipt_issued_at" = now()
      WHERE "id" = ${found.id} AND "verification_hash" IS NULL`);

    const [o] = rowsOf<OrderRow>(
      await tx.execute(sql`
        SELECT o."id", o."raffle_id", o."status", o."total_cents", o."currency", o."expires_at",
               o."verification_hash", o."receipt_issued_at", r."title", r."price_cents", g."name" AS org_name
        FROM "orders" o
        JOIN "raffles" r ON r."id" = o."raffle_id"
        JOIN "organizations" g ON g."id" = o."organization_id"
        WHERE o."id" = ${found.id}`),
    );
    const nums = rowsOf<{ number: string; local_number: number | null }>(
      await tx.execute(sql`
        SELECT n."number", n."local_number" FROM "order_items" i JOIN "raffle_numbers" n ON n."id" = i."raffle_number_id"
        WHERE i."order_id" = ${found.id} ORDER BY n."number"`),
    );
    if (nums.length > MAX_RECEIPT_NUMBERS) throw new ReceiptError("too_many_numbers", "Demasiados numeros");
    const ppl = rowsOf<{ number: string; name: string; email: string; phone: string | null }>(
      await tx.execute(sql`
        SELECT n."number", p."name", p."email", p."phone"
        FROM "order_item_participants" p
        JOIN "order_items" i ON i."id" = p."order_item_id"
        JOIN "raffle_numbers" n ON n."id" = i."raffle_number_id"
        WHERE p."order_id" = ${found.id} ORDER BY n."number"`),
    );
    return {
      orderId: o.id,
      status: o.status,
      raffleTitle: o.title,
      organizerName: o.org_name,
      numbers: nums.map((n) => participationLabel(n.number, n.local_number !== null)),
      participants: ppl.map((p) => ({
        label: participationLabel(p.number, true),
        name: p.name,
        email: p.email,
        phone: p.phone,
      })),
      unitPriceCents: Number(o.price_cents),
      totalCents: Number(o.total_cents),
      currency: o.currency,
      issuedAt: new Date(o.receipt_issued_at as Date | string),
      expiresAt: new Date(o.expires_at),
      verificationCode: code,
    };
  });
}

export interface PublicVerification {
  reference: string;
  status: DemoStatus;
  raffleTitle: string;
  numbers: string[];
  expiresAt: Date;
}

/**
 * Verificacion publica de solo lectura por codigo opaco. Calcula la caducidad al vuelo (sin
 * escribir) para reflejar el estado actual; no expone contacto, ids internos ni token de acceso.
 */
export async function getVerification(db: Database, code: string): Promise<PublicVerification | null> {
  if (!VERIFICATION_CODE_RE.test(code)) return null;
  const hash = hashVerificationCode(code);
  const [o] = rowsOf<{
    id: string; status: DemoStatus; expires_at: Date | string; title: string; past: boolean;
  }>(
    await db.execute(sql`
      SELECT o."id", o."status", o."expires_at", r."title", (o."expires_at" <= now()) AS past
      FROM "orders" o JOIN "raffles" r ON r."id" = o."raffle_id"
      WHERE o."verification_hash" = ${hash} AND o."is_demo"`),
  );
  if (!o) return null;
  const nums = rowsOf<{ number: string; local_number: number | null }>(
    await db.execute(sql`
      SELECT n."number", n."local_number" FROM "order_items" i JOIN "raffle_numbers" n ON n."id" = i."raffle_number_id"
      WHERE i."order_id" = ${o.id} ORDER BY n."number"`),
  );
  const expiresAt = new Date(o.expires_at);
  const status: DemoStatus = o.status === "pending" && o.past ? "expired" : o.status;
  return {
    reference: o.id.slice(0, 8).toUpperCase(),
    status,
    raffleTitle: o.title,
    numbers: nums.map((n) => participationLabel(n.number, n.local_number !== null)),
    expiresAt,
  };
}
