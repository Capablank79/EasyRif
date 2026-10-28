import { and, eq } from "drizzle-orm";
import { getActiveRole } from "@/modules/organizations";
import { assertCan } from "@/modules/organizations";
import { recordAuditEvent } from "@/platform/audit";
import { prizes, raffles } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";
import { processImageUpload } from "@/modules/storage/image";
import { getStorage, newStorageKey, STORAGE_KEY_RE, type StorageProvider } from "@/modules/storage/provider";
import { RaffleError } from "./service";

const asDb = (tx: unknown) => tx as Database;

type Target = { kind: "raffle"; raffleId: string } | { kind: "prize"; raffleId: string; prizeId: string };

/** Autoriza (edit_draft) y devuelve la rifa; una rifa ajena equivale a una inexistente. */
async function authorizeDraft(db: Database, userId: string, raffleId: string) {
  const [r] = await db.select().from(raffles).where(eq(raffles.id, raffleId)).limit(1);
  if (!r) throw new RaffleError("not_found", "No se encontro la rifa.");
  const role = await getActiveRole(db, userId, r.organizationId);
  if (!role) throw new RaffleError("not_found", "No se encontro la rifa.");
  assertCan(role, "raffle:edit_draft");
  return r;
}

/**
 * Reemplaza la imagen de una rifa o premio. Solo en borrador (la ficha publicada es inmutable).
 * Orden seguro: se guarda el archivo nuevo, se actualiza la fila y luego se borra el anterior.
 */
export async function setImage(
  db: Database,
  userId: string,
  target: Target,
  file: Buffer,
  storage: StorageProvider = getStorage(),
): Promise<{ imageKey: string; width: number; height: number }> {
  const raffle = await authorizeDraft(db, userId, target.raffleId);
  const img = await processImageUpload(file);
  const key = newStorageKey();
  await storage.put(key, img.data, img.contentType);
  let previous: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(raffles)
        .where(and(eq(raffles.id, raffle.id), eq(raffles.organizationId, raffle.organizationId)))
        .for("update")
        .limit(1);
      if (!r) throw new RaffleError("not_found", "No se encontro la rifa.");
      if (r.status !== "draft") throw new RaffleError("state", "Solo se puede modificar una rifa en borrador.");
      if (target.kind === "raffle") {
        previous = r.imageKey;
        await tx.update(raffles).set({ imageKey: key }).where(eq(raffles.id, r.id));
      } else {
        const [p] = await tx
          .select()
          .from(prizes)
          .where(and(eq(prizes.id, target.prizeId), eq(prizes.raffleId, r.id)))
          .for("update")
          .limit(1);
        if (!p) throw new RaffleError("not_found", "No se encontro el premio.");
        previous = p.imageKey;
        await tx.update(prizes).set({ imageKey: key }).where(eq(prizes.id, p.id));
      }
      await recordAuditEvent(asDb(tx), {
        organizationId: r.organizationId,
        actorId: userId,
        entityType: target.kind === "raffle" ? "raffle" : "prize",
        entityId: target.kind === "raffle" ? r.id : target.prizeId,
        action: "image.set",
        metadata: { raffleId: r.id },
      });
    });
  } catch (e) {
    await storage.delete(key).catch(() => undefined);
    throw e;
  }
  if (previous) await storage.delete(previous).catch(() => undefined);
  return { imageKey: key, width: img.width, height: img.height };
}

export async function removeImage(
  db: Database,
  userId: string,
  target: Target,
  storage: StorageProvider = getStorage(),
): Promise<void> {
  const raffle = await authorizeDraft(db, userId, target.raffleId);
  let previous: string | null = null;
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(raffles).where(eq(raffles.id, raffle.id)).for("update").limit(1);
    if (!r || r.status !== "draft") throw new RaffleError("state", "Solo se puede modificar una rifa en borrador.");
    if (target.kind === "raffle") {
      previous = r.imageKey;
      await tx.update(raffles).set({ imageKey: null }).where(eq(raffles.id, r.id));
    } else {
      const [p] = await tx
        .select()
        .from(prizes)
        .where(and(eq(prizes.id, target.prizeId), eq(prizes.raffleId, r.id)))
        .limit(1);
      if (!p) throw new RaffleError("not_found", "No se encontro el premio.");
      previous = p.imageKey;
      await tx.update(prizes).set({ imageKey: null }).where(eq(prizes.id, p.id));
    }
  });
  if (previous) await storage.delete(previous).catch(() => undefined);
}

/**
 * Decide si `userId` (o un visitante anonimo) puede ver la imagen. Las imagenes de rifas
 * publicadas son publicas; las de borradores exigen miembro activo con `raffle:read`.
 * Devuelve false tanto si no existe como si no hay permiso (sin enumeracion).
 */
export async function canViewImage(db: Database, key: string, userId: string | null): Promise<boolean> {
  if (!STORAGE_KEY_RE.test(key)) return false;
  const [byRaffle] = await db
    .select({ status: raffles.status, org: raffles.organizationId })
    .from(raffles)
    .where(eq(raffles.imageKey, key))
    .limit(1);
  const [byPrize] = byRaffle
    ? []
    : await db
        .select({ status: raffles.status, org: raffles.organizationId })
        .from(prizes)
        .innerJoin(raffles, eq(raffles.id, prizes.raffleId))
        .where(eq(prizes.imageKey, key))
        .limit(1);
  const hit = byRaffle ?? byPrize;
  if (!hit) return false;
  if (hit.status === "published") return true;
  if (!userId) return false;
  const role = await getActiveRole(db, userId, hit.org);
  return Boolean(role);
}
