import { and, asc, desc, eq, sql } from "drizzle-orm";
import { assertCan, getActiveRole, requireOrgPermission, type OrgAction, type OrgRole } from "@/modules/organizations";
import { recordAuditEvent } from "@/platform/audit";
import { prizes, raffleNumbers, raffles } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";
import { keyWidths } from "./booklets";
import { listBookletSummaries, listPublicNumbers, type BookletSummary } from "@/modules/reservations/service";
import { slugify, type RaffleInput } from "./validation";

export type RaffleErrorCode = "not_found" | "state" | "invalid";

/** Error de dominio con mensaje seguro para mostrar al usuario. */
export class RaffleError extends Error {
  constructor(
    public code: RaffleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RaffleError";
  }
}

const notFound = () => new RaffleError("not_found", "No se encontró la rifa.");
const asDb = (tx: unknown) => tx as Database;
export type RaffleRow = typeof raffles.$inferSelect;
export type PrizeRow = typeof prizes.$inferSelect;

/**
 * Carga la rifa verificando pertenencia y permiso en servidor. Una rifa ajena
 * es indistinguible de una inexistente (sin filtrar información entre organizaciones).
 */
async function authorize(db: Database, userId: string, raffleId: string, action: OrgAction) {
  const [r] = await db.select().from(raffles).where(eq(raffles.id, raffleId)).limit(1);
  if (!r) throw notFound();
  const role = await getActiveRole(db, userId, r.organizationId);
  if (!role) throw notFound();
  assertCan(role, action);
  return { raffle: r, role };
}

/** Relee la rifa bloqueando su fila: serializa ediciones, numeración y publicación. */
async function lockDraft(tx: Database, raffleId: string, organizationId: string) {
  const [r] = await tx
    .select()
    .from(raffles)
    .where(and(eq(raffles.id, raffleId), eq(raffles.organizationId, organizationId)))
    .for("update")
    .limit(1);
  if (!r) throw notFound();
  return r;
}

function requireDraft(r: RaffleRow) {
  if (r.status !== "draft") throw new RaffleError("state", "Solo se puede modificar una rifa en borrador.");
}

export interface RaffleListItem {
  id: string;
  title: string;
  slug: string;
  status: RaffleRow["status"];
  prizeCount: number;
  numberTotal: number;
  numberCount: number;
  numberingMode: RaffleRow["numberingMode"];
  bookletCount: number | null;
  numbersPerBooklet: number | null;
  createdAt: Date;
}

export async function listRaffles(db: Database, userId: string, organizationId: string): Promise<RaffleListItem[]> {
  await requireOrgPermission(db, userId, organizationId, "raffle:read");
  return db
    .select({
      id: raffles.id,
      title: raffles.title,
      slug: raffles.slug,
      status: raffles.status,
      numberCount: raffles.numberCount,
      numberingMode: raffles.numberingMode,
      bookletCount: raffles.bookletCount,
      numbersPerBooklet: raffles.numbersPerBooklet,
      createdAt: raffles.createdAt,
      // Se califica "raffles"."id": Drizzle emite `id` sin tabla y dentro de la subconsulta se resolvía contra prizes/raffle_numbers.
      prizeCount: sql<number>`(select count(*)::int from prizes p where p.raffle_id = "raffles"."id" and p.organization_id = "raffles"."organization_id")`,
      numberTotal: sql<number>`(select count(*)::int from raffle_numbers n where n.raffle_id = "raffles"."id" and n.organization_id = "raffles"."organization_id")`,
    })
    .from(raffles)
    .where(eq(raffles.organizationId, organizationId))
    .orderBy(desc(raffles.createdAt));
}

export interface RaffleDetail {
  raffle: RaffleRow;
  role: OrgRole;
  prizes: PrizeRow[];
  numbers: { total: number; available: number; reserved: number; sold: number; sample: string[] };
}

export async function getRaffleDetail(db: Database, userId: string, raffleId: string): Promise<RaffleDetail> {
  const { raffle, role } = await authorize(db, userId, raffleId, "raffle:read");
  const [prizeRows, counts, sample] = await Promise.all([
    db
      .select()
      .from(prizes)
      .where(and(eq(prizes.raffleId, raffle.id), eq(prizes.organizationId, raffle.organizationId)))
      .orderBy(asc(prizes.position)),
    db
      .select({
        status: sql<string>`case when ${raffleNumbers.status} = 'reserved' and ${raffleNumbers.reservedUntil} <= now() then 'available' else ${raffleNumbers.status}::text end`,
        n: sql<number>`count(*)::int`,
      })
      .from(raffleNumbers)
      .where(and(eq(raffleNumbers.raffleId, raffle.id), eq(raffleNumbers.organizationId, raffle.organizationId)))
      .groupBy(sql`1`),
    db
      .select({ number: raffleNumbers.number })
      .from(raffleNumbers)
      .where(and(eq(raffleNumbers.raffleId, raffle.id), eq(raffleNumbers.organizationId, raffle.organizationId)))
      .orderBy(asc(raffleNumbers.number))
      .limit(12),
  ]);
  const by = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  return {
    raffle,
    role,
    prizes: prizeRows,
    numbers: {
      total: counts.reduce((a, c) => a + c.n, 0),
      available: by("available"),
      reserved: by("reserved"),
      sold: by("sold"),
      sample: sample.map((s) => s.number),
    },
  };
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export async function createRaffle(
  db: Database,
  userId: string,
  organizationId: string,
  input: RaffleInput,
): Promise<{ id: string; slug: string }> {
  await requireOrgPermission(db, userId, organizationId, "raffle:edit_draft");
  const base = slugify(input.title);
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const slug = attempt === 0 ? base : `${base.slice(0, 57)}-${randomSuffix()}`;
      const rows = await tx
        .insert(raffles)
        .values({
          organizationId,
          createdBy: userId,
          slug,
          title: input.title,
          description: input.description,
          priceCents: input.priceMinor,
          currency: input.currency,
          numberCount: input.numberCount,
          numberingMode: input.numbering ?? "individual",
          bookletCount: input.bookletCount ?? null,
          numbersPerBooklet: input.numbersPerBooklet ?? null,
          firstFolio: input.firstFolio ?? null,
          salesClosesAt: input.salesClosesAt ?? null,
          drawAt: input.drawAt ?? null,
          endsAt: input.drawDate,
        })
        .onConflictDoNothing({ target: raffles.slug })
        .returning({ id: raffles.id, slug: raffles.slug });
      if (rows[0]) {
        await recordAuditEvent(asDb(tx), {
          organizationId,
          actorId: userId,
          entityType: "raffle",
          entityId: rows[0].id,
          action: "raffle.created",
          metadata: { title: input.title },
        });
        return rows[0];
      }
    }
    throw new RaffleError("state", "No se pudo asignar una dirección única. Inténtalo de nuevo.");
  });
}

export async function updateRaffle(db: Database, userId: string, raffleId: string, input: RaffleInput) {
  const { raffle } = await authorize(db, userId, raffleId, "raffle:edit_draft");
  await db.transaction(async (tx) => {
    const r = await lockDraft(asDb(tx), raffle.id, raffle.organizationId);
    requireDraft(r);
    const cfgChanged =
      input.numberCount !== r.numberCount ||
      (input.numbering ?? "individual") !== r.numberingMode ||
      (input.bookletCount ?? null) !== r.bookletCount ||
      (input.numbersPerBooklet ?? null) !== r.numbersPerBooklet ||
      (input.firstFolio ?? null) !== r.firstFolio;
    if (cfgChanged) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(raffleNumbers)
        .where(eq(raffleNumbers.raffleId, r.id));
      if (n > 0) {
        throw new RaffleError("state", "Los números ya fueron generados: no se puede cambiar la numeración.");
      }
    }
    await tx
      .update(raffles)
      .set({
        title: input.title,
        description: input.description,
        priceCents: input.priceMinor,
        currency: input.currency,
        numberCount: input.numberCount,
        numberingMode: input.numbering ?? "individual",
        bookletCount: input.bookletCount ?? null,
        numbersPerBooklet: input.numbersPerBooklet ?? null,
        firstFolio: input.firstFolio ?? null,
        salesClosesAt: input.salesClosesAt ?? null,
        drawAt: input.drawAt ?? null,
        endsAt: input.drawDate,
      })
      .where(and(eq(raffles.id, r.id), eq(raffles.organizationId, r.organizationId)));
    await recordAuditEvent(asDb(tx), {
      organizationId: r.organizationId,
      actorId: userId,
      entityType: "raffle",
      entityId: r.id,
      action: "raffle.updated",
      metadata: {},
    });
  });
}

const MAX_PRIZES = 50;

export async function addPrize(
  db: Database,
  userId: string,
  raffleId: string,
  input: { title: string; description: string | null },
) {
  const { raffle } = await authorize(db, userId, raffleId, "raffle:edit_draft");
  await db.transaction(async (tx) => {
    const r = await lockDraft(asDb(tx), raffle.id, raffle.organizationId);
    requireDraft(r);
    const [agg] = await tx
      .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${prizes.position}), 0)::int` })
      .from(prizes)
      .where(eq(prizes.raffleId, r.id));
    if (agg.n >= MAX_PRIZES) throw new RaffleError("invalid", `Máximo ${MAX_PRIZES} premios por rifa.`);
    const [p] = await tx
      .insert(prizes)
      .values({
        raffleId: r.id,
        organizationId: r.organizationId,
        title: input.title,
        description: input.description,
        position: agg.max + 1,
      })
      .returning({ id: prizes.id });
    await recordAuditEvent(asDb(tx), {
      organizationId: r.organizationId,
      actorId: userId,
      entityType: "prize",
      entityId: p.id,
      action: "prize.created",
      metadata: { raffleId: r.id },
    });
  });
}

export async function updatePrize(
  db: Database,
  userId: string,
  raffleId: string,
  prizeId: string,
  input: { title: string; description: string | null },
) {
  const { raffle } = await authorize(db, userId, raffleId, "raffle:edit_draft");
  await db.transaction(async (tx) => {
    const r = await lockDraft(asDb(tx), raffle.id, raffle.organizationId);
    requireDraft(r);
    const rows = await tx
      .update(prizes)
      .set({ title: input.title, description: input.description })
      .where(and(eq(prizes.id, prizeId), eq(prizes.raffleId, r.id), eq(prizes.organizationId, r.organizationId)))
      .returning({ id: prizes.id });
    if (!rows[0]) throw new RaffleError("not_found", "No se encontró el premio.");
    await recordAuditEvent(asDb(tx), {
      organizationId: r.organizationId,
      actorId: userId,
      entityType: "prize",
      entityId: prizeId,
      action: "prize.updated",
      metadata: { raffleId: r.id },
    });
  });
}

export async function deletePrize(db: Database, userId: string, raffleId: string, prizeId: string) {
  const { raffle } = await authorize(db, userId, raffleId, "raffle:edit_draft");
  await db.transaction(async (tx) => {
    const r = await lockDraft(asDb(tx), raffle.id, raffle.organizationId);
    requireDraft(r);
    const rows = await tx
      .delete(prizes)
      .where(and(eq(prizes.id, prizeId), eq(prizes.raffleId, r.id), eq(prizes.organizationId, r.organizationId)))
      .returning({ id: prizes.id });
    if (!rows[0]) throw new RaffleError("not_found", "No se encontró el premio.");
    await recordAuditEvent(asDb(tx), {
      organizationId: r.organizationId,
      actorId: userId,
      entityType: "prize",
      entityId: prizeId,
      action: "prize.deleted",
      metadata: { raffleId: r.id },
    });
  });
}

/** Intercambia la posición del premio con su vecino (arriba/abajo). */
export async function movePrize(
  db: Database,
  userId: string,
  raffleId: string,
  prizeId: string,
  direction: "up" | "down",
) {
  const { raffle } = await authorize(db, userId, raffleId, "raffle:edit_draft");
  await db.transaction(async (tx) => {
    const r = await lockDraft(asDb(tx), raffle.id, raffle.organizationId);
    requireDraft(r);
    const list = await tx
      .select({ id: prizes.id, position: prizes.position })
      .from(prizes)
      .where(and(eq(prizes.raffleId, r.id), eq(prizes.organizationId, r.organizationId)))
      .orderBy(asc(prizes.position));
    const i = list.findIndex((p) => p.id === prizeId);
    if (i < 0) throw new RaffleError("not_found", "No se encontró el premio.");
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    const a = list[i];
    const b = list[j];
    const temp = list[list.length - 1].position + 1;
    // Tres pasos para respetar UNIQUE(raffle_id, position).
    await tx.update(prizes).set({ position: temp }).where(eq(prizes.id, a.id));
    await tx.update(prizes).set({ position: a.position }).where(eq(prizes.id, b.id));
    await tx.update(prizes).set({ position: b.position }).where(eq(prizes.id, a.id));
  });
}

/** postgres-js devuelve un array; PGlite, un objeto con `rows`. */
const rowsOf = (res: unknown): unknown[] => (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []));

/** Inserta numeración individual o talonarios + participaciones; devuelve las participaciones creadas. */
async function insertNumbers(tx: Database, r: RaffleRow): Promise<number> {
  if (r.numberingMode === "booklets") {
    const cfg = { bookletCount: r.bookletCount!, numbersPerBooklet: r.numbersPerBooklet!, firstFolio: r.firstFolio! };
    const w = keyWidths(cfg);
    await tx.execute(sql`
      INSERT INTO booklets (raffle_id, organization_id, folio)
      SELECT ${r.id}::uuid, ${r.organizationId}::uuid, g
      FROM generate_series(${cfg.firstFolio}::int, ${cfg.firstFolio + cfg.bookletCount - 1}::int) AS g
      ON CONFLICT (raffle_id, folio) DO NOTHING`);
    const inserted = await tx.execute(sql`
      INSERT INTO raffle_numbers (raffle_id, organization_id, number, booklet_id, local_number)
      SELECT ${r.id}::uuid, ${r.organizationId}::uuid,
             'T' || lpad(b.folio::text, ${w.folio}::int, '0') || 'N' || lpad(g::text, ${w.local}::int, '0'),
             b.id, g
      FROM booklets b CROSS JOIN generate_series(1, ${cfg.numbersPerBooklet}::int) AS g
      WHERE b.raffle_id = ${r.id}::uuid
      ON CONFLICT (raffle_id, number) DO NOTHING
      RETURNING id`);
    return rowsOf(inserted).length;
  }
  const width = String(r.numberCount).length;
  const inserted = await tx.execute(sql`
    INSERT INTO raffle_numbers (raffle_id, organization_id, number)
    SELECT ${r.id}::uuid, ${r.organizationId}::uuid, lpad(g::text, ${width}::int, '0')
    FROM generate_series(1, ${r.numberCount}::int) AS g
    ON CONFLICT (raffle_id, number) DO NOTHING
    RETURNING id`);
  return rowsOf(inserted).length;
}

/**
 * Genera los números de la rifa en sentencias únicas dentro de una
 * transacción con la fila bloqueada: idempotente, atómica y sin duplicados.
 */
export async function generateNumbers(
  db: Database,
  userId: string,
  raffleId: string,
): Promise<{ created: number; total: number }> {
  const { raffle } = await authorize(db, userId, raffleId, "raffle:edit_draft");
  return db.transaction(async (tx) => {
    const r = await lockDraft(asDb(tx), raffle.id, raffle.organizationId);
    requireDraft(r);
    const rows = await insertNumbers(tx, r);
    const created = rows;
    if (created > 0) {
      await recordAuditEvent(asDb(tx), {
        organizationId: r.organizationId,
        actorId: userId,
        entityType: "raffle",
        entityId: r.id,
        action: "raffle.numbers_generated",
        metadata: { created },
      });
    }
    return { created, total: r.numberCount };
  });
}

export interface BookletOverview {
  raffle: RaffleRow;
  summaries: BookletSummary[];
  folio: number | null;
  numbers: { label: string; status: "available" | "reserved" | "sold" }[];
}

/** Vista de administración: resumen por folio y series del folio elegido. Autoriza por rol y organización. */
export async function getBookletOverview(
  db: Database,
  userId: string,
  raffleId: string,
  folio: number | null,
): Promise<BookletOverview> {
  const { raffle } = await authorize(db, userId, raffleId, "raffle:read");
  if (raffle.numberingMode !== "booklets") throw notFound();
  const summaries = await listBookletSummaries(db, raffle.id);
  const chosen = folio !== null && summaries.some((s) => s.folio === folio) ? folio : null;
  const page = chosen
    ? await listPublicNumbers(db, raffle.id, { folio: chosen, pageSize: 200 })
    : { items: [] as { label: string; status: "available" | "reserved" | "sold" }[] };
  return { raffle, summaries, folio: chosen, numbers: page.items.map((i) => ({ label: i.label, status: i.status })) };
}

export interface PublishCheck {
  ok: boolean;
  missing: string[];
}

export function checkPublishable(
  r: Pick<RaffleRow, "title" | "priceCents" | "numberCount" | "status"> &
    Partial<Pick<RaffleRow, "numberingMode" | "salesClosesAt" | "drawAt">>,
  prizeCount: number,
  numberTotal: number,
  now: Date = new Date(),
): PublishCheck {
  const missing: string[] = [];
  if (r.status !== "draft") missing.push("La rifa ya no está en borrador.");
  if (!r.title.trim()) missing.push("Falta el nombre.");
  if (r.priceCents <= 0) missing.push("El precio debe ser mayor que cero.");
  if (prizeCount < 1) missing.push("Agrega al menos un premio.");
  if (numberTotal !== r.numberCount) missing.push("Genera los números de la rifa.");
  if (r.numberingMode === "booklets") {
    if (!r.salesClosesAt || !r.drawAt) missing.push("Define la fecha de cierre de ventas y la fecha de sorteo.");
    else if (r.salesClosesAt.getTime() <= now.getTime()) missing.push("El cierre de ventas debe estar en el futuro.");
  }
  return { ok: missing.length === 0, missing };
}

/** draft → published, solo informativa: no habilita compras ni cobros. */
export async function publishRaffle(db: Database, userId: string, raffleId: string) {
  const { raffle } = await authorize(db, userId, raffleId, "raffle:publish");
  await db.transaction(async (tx) => {
    const r = await lockDraft(asDb(tx), raffle.id, raffle.organizationId);
    const [[p], [n]] = await Promise.all([
      tx.select({ n: sql<number>`count(*)::int` }).from(prizes).where(eq(prizes.raffleId, r.id)),
      tx.select({ n: sql<number>`count(*)::int` }).from(raffleNumbers).where(eq(raffleNumbers.raffleId, r.id)),
    ]);
    const check = checkPublishable(r, p.n, n.n);
    if (!check.ok) throw new RaffleError("state", check.missing.join(" "));
    await tx
      .update(raffles)
      .set({ status: "published" })
      .where(and(eq(raffles.id, r.id), eq(raffles.organizationId, r.organizationId), eq(raffles.status, "draft")));
    await recordAuditEvent(asDb(tx), {
      organizationId: r.organizationId,
      actorId: userId,
      entityType: "raffle",
      entityId: r.id,
      action: "raffle.published",
      metadata: {},
    });
  });
}

export interface PublicRaffle {
  title: string;
  slug: string;
  description: string | null;
  priceCents: number;
  currency: string;
  numberCount: number;
  numberingMode: "individual" | "booklets";
  bookletCount: number | null;
  numbersPerBooklet: number | null;
  endsAt: Date | null;
  salesClosesAt: Date | null;
  drawAt: Date | null;
  imageKey: string | null;
  prizes: { title: string; description: string | null; imageKey: string | null }[];
}

/** Ficha pública: solo rifas publicadas y sin exponer identificadores internos. */
export async function getPublicRaffle(db: Database, slug: string): Promise<PublicRaffle | null> {
  const r = await getPublicRaffleWithId(db, slug);
  if (!r) return null;
  const { id: _id, ...pub } = r;
  void _id;
  return pub;
}

/** Uso interno del servidor (contadores, numeros): incluye el id, que no debe llegar al cliente. */
export async function getPublicRaffleWithId(
  db: Database,
  slug: string,
): Promise<(PublicRaffle & { id: string }) | null> {
  const [r] = await db
    .select()
    .from(raffles)
    .where(and(eq(raffles.slug, slug), eq(raffles.status, "published")))
    .limit(1);
  if (!r) return null;
  const list = await db
    .select({ title: prizes.title, description: prizes.description, imageKey: prizes.imageKey })
    .from(prizes)
    .where(and(eq(prizes.raffleId, r.id), eq(prizes.organizationId, r.organizationId)))
    .orderBy(asc(prizes.position));
  return {
    title: r.title,
    slug: r.slug,
    description: r.description,
    priceCents: r.priceCents,
    currency: r.currency,
    numberCount: r.numberCount,
    numberingMode: r.numberingMode,
    bookletCount: r.bookletCount,
    numbersPerBooklet: r.numbersPerBooklet,
    endsAt: r.endsAt,
    salesClosesAt: r.salesClosesAt,
    drawAt: r.drawAt,
    id: r.id,
    imageKey: r.imageKey,
    prizes: list,
  };
}
