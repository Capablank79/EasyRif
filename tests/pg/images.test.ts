import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StorageProvider } from "@/modules/storage/provider";

/* Imagenes de rifas/premios contra PostgreSQL real: permisos, borrador/publicada y visibilidad. */
let local: Record<string, string | undefined> = {};
try {
  local = parseEnv(
    readFileSync(path.resolve(import.meta.dirname, "..", "..", ".env.local"), "utf8").replace(/^\uFEFF/, ""),
  );
} catch {
  /* sin .env.local */
}
const APP = process.env.DATABASE_URL ?? local.DATABASE_URL;
const MIGRATOR = process.env.DATABASE_URL_MIGRATOR ?? local.DATABASE_URL_MIGRATOR;

class MemStorage implements StorageProvider {
  files = new Map<string, { data: Buffer; contentType: string }>();
  async put(k: string, data: Buffer, contentType: string) {
    this.files.set(k, { data, contentType });
  }
  async get(k: string) {
    return this.files.get(k) ?? null;
  }
  async delete(k: string) {
    this.files.delete(k);
  }
}

describe.skipIf(!(APP && MIGRATOR))("Imagenes (PostgreSQL real)", () => {
  const tag = randomUUID().slice(0, 8);
  let mig: postgres.Sql;
  let db: ReturnType<typeof import("@/platform/db/client").getDb>;
  let img: typeof import("@/modules/raffles/images");
  let rsvc: typeof import("@/modules/raffles/service");
  const ids: Record<string, string> = {};
  let orgA = "";
  let orgB = "";
  let raffleId = "";
  let prizeId = "";
  const store = new MemStorage();
  let png: Buffer;

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    mig = postgres(MIGRATOR!, { max: 2, onnotice: () => {} });
    db = (await import("@/platform/db/client")).getDb();
    img = await import("@/modules/raffles/images");
    rsvc = await import("@/modules/raffles/service");
    png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#0a50c8" } }).png().toBuffer();
    for (const n of ["ownerA", "viewerA", "ownerB"]) {
      const [u] = await mig`INSERT INTO users (email, display_name) VALUES (${`${n.toLowerCase()}-${tag}@example.invalid`}, ${n}) RETURNING id`;
      ids[n] = u.id;
    }
    [{ id: orgA }] = await mig`INSERT INTO organizations (name) VALUES (${"Org IA " + tag}) RETURNING id`;
    [{ id: orgB }] = await mig`INSERT INTO organizations (name) VALUES (${"Org IB " + tag}) RETURNING id`;
    await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${orgA}, ${ids.ownerA}, 'owner', 'active'), (${orgA}, ${ids.viewerA}, 'viewer', 'active'), (${orgB}, ${ids.ownerB}, 'owner', 'active')`;
    const r = await rsvc.createRaffle(db, ids.ownerA, orgA, {
      title: `Img ${tag}`, description: null, priceMinor: 1000, currency: "CLP", numberCount: 50, drawDate: null,
    });
    raffleId = r.id;
    await rsvc.addPrize(db, ids.ownerA, r.id, { title: "P", description: null });
    prizeId = (await mig`SELECT id FROM prizes WHERE raffle_id = ${r.id}`)[0].id;
  });

  afterAll(async () => {
    for (const o of [orgA, orgB]) {
      if (!o) continue;
      await mig`DELETE FROM raffles WHERE organization_id = ${o}`;
      await mig`DELETE FROM organizations WHERE id = ${o}`;
    }
    await mig`DELETE FROM users WHERE email LIKE ${`%-${tag}@example.invalid`}`;
    await mig.end();
  });

  it("permisos: viewer y otra organizacion no pueden subir", async () => {
    await expect(img.setImage(db, ids.viewerA, { kind: "raffle", raffleId }, png, store)).rejects.toThrow();
    await expect(img.setImage(db, ids.ownerB, { kind: "raffle", raffleId }, png, store)).rejects.toMatchObject({ code: "not_found" });
    await expect(img.setImage(db, ids.ownerB, { kind: "prize", raffleId, prizeId }, png, store)).rejects.toMatchObject({ code: "not_found" });
    expect(store.files.size).toBe(0);
  });

  it("archivo danado o falso no se guarda ni cambia la rifa", async () => {
    await expect(img.setImage(db, ids.ownerA, { kind: "raffle", raffleId }, Buffer.from("no soy imagen"), store)).rejects.toMatchObject({ code: "type" });
    expect(store.files.size).toBe(0);
  });

  it("propietario sube imagen de rifa y premio; reemplazo borra el archivo anterior", async () => {
    const a = await img.setImage(db, ids.ownerA, { kind: "raffle", raffleId }, png, store);
    const p = await img.setImage(db, ids.ownerA, { kind: "prize", raffleId, prizeId }, png, store);
    expect(store.files.size).toBe(2);
    const b = await img.setImage(db, ids.ownerA, { kind: "raffle", raffleId }, png, store);
    expect(b.imageKey).not.toBe(a.imageKey);
    expect(store.files.has(a.imageKey)).toBe(false);
    expect(store.files.has(p.imageKey)).toBe(true);
    const [row] = await mig`SELECT image_key FROM raffles WHERE id = ${raffleId}`;
    expect(row.image_key).toBe(b.imageKey);
  });

  it("premio de otra rifa no se puede asociar (IDOR)", async () => {
    await expect(
      img.setImage(db, ids.ownerA, { kind: "prize", raffleId, prizeId: randomUUID() }, png, store),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("visibilidad: borrador solo para miembros; publicada para todos; clave invalida o inexistente = no", async () => {
    const [{ image_key: key }] = await mig`SELECT image_key FROM raffles WHERE id = ${raffleId}`;
    expect(await img.canViewImage(db, key, null)).toBe(false);
    expect(await img.canViewImage(db, key, ids.ownerB)).toBe(false);
    expect(await img.canViewImage(db, key, ids.viewerA)).toBe(true);
    expect(await img.canViewImage(db, key, ids.ownerA)).toBe(true);
    expect(await img.canViewImage(db, randomUUID(), ids.ownerA)).toBe(false);
    expect(await img.canViewImage(db, "../etc/passwd", ids.ownerA)).toBe(false);
    await rsvc.generateNumbers(db, ids.ownerA, raffleId);
    await rsvc.publishRaffle(db, ids.ownerA, raffleId);
    expect(await img.canViewImage(db, key, null)).toBe(true);
  });

  it("publicada: no se puede cambiar ni quitar la imagen", async () => {
    await expect(img.setImage(db, ids.ownerA, { kind: "raffle", raffleId }, png, store)).rejects.toMatchObject({ code: "state" });
    await expect(img.removeImage(db, ids.ownerA, { kind: "raffle", raffleId }, store)).rejects.toMatchObject({ code: "state" });
  });
});
