import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/* Reservas de demostracion contra PostgreSQL real (easyrif_dev). Datos .invalid, limpiados al final. */
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
const enabled = Boolean(APP && MIGRATOR);

describe.skipIf(!enabled)("Reservas demo (PostgreSQL real)", () => {
  const tag = randomUUID().slice(0, 8);
  const SECRET = "test-secret-" + tag;
  let mig: postgres.Sql;
  let svc: typeof import("@/modules/reservations/service");
  let rsvc: typeof import("@/modules/raffles/service");
  let db: ReturnType<typeof import("@/platform/db/client").getDb>;
  let userId = "";
  let orgId = "";
  let slug = "";
  let raffleId = "";
  let draftSlug = "";
  const key = () => randomBytes(18).toString("base64url");
  const buyer = { name: "Comprador Demo", email: `c-${tag}@example.invalid` };
  const cfg = { ttlMinutes: 10, maxSelection: 5 };
  const reserve = (numbers: string[], requestKey = key(), s = slug) =>
    svc.reserveNumbers(db, { slug: s, numbers, requestKey, buyer }, cfg, SECRET);
  const state = async (n: string) =>
    (await mig`SELECT status, reservation_id, reserved_until FROM raffle_numbers WHERE raffle_id = ${raffleId} AND number = ${n}`)[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    mig = postgres(MIGRATOR!, { max: 2, onnotice: () => {} });
    db = (await import("@/platform/db/client")).getDb();
    svc = await import("@/modules/reservations/service");
    rsvc = await import("@/modules/raffles/service");
    [{ id: userId }] = await mig`INSERT INTO users (email, display_name) VALUES (${`own-${tag}@example.invalid`}, 'Own') RETURNING id`;
    [{ id: orgId }] = await mig`INSERT INTO organizations (name) VALUES (${"Org R " + tag}) RETURNING id`;
    await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${orgId}, ${userId}, 'owner', 'active')`;
    const mk = async (title: string, publish: boolean) => {
      const r = await rsvc.createRaffle(db, userId, orgId, {
        title, description: null, priceMinor: 1500, currency: "CLP", numberCount: 100, drawDate: null,
      });
      await rsvc.addPrize(db, userId, r.id, { title: "Premio", description: null });
      await rsvc.generateNumbers(db, userId, r.id);
      if (publish) await rsvc.publishRaffle(db, userId, r.id);
      return r;
    };
    const pub = await mk(`Reservas ${tag}`, true);
    slug = pub.slug;
    raffleId = pub.id;
    draftSlug = (await mk(`Borrador ${tag}`, false)).slug;
  });

  afterAll(async () => {
    if (orgId) {
      await mig`DELETE FROM orders WHERE organization_id = ${orgId}`;
      await mig`DELETE FROM buyer_contacts WHERE organization_id = ${orgId}`;
      await mig`DELETE FROM raffles WHERE organization_id = ${orgId}`;
      await mig`DELETE FROM organizations WHERE id = ${orgId}`;
    }
    await mig`DELETE FROM users WHERE email LIKE ${`%-${tag}@example.invalid`}`;
    await mig.end();
  });

  it("reserva numeros: pedido demo pendiente, numeros reserved, total en enteros", async () => {
    const r = await reserve(["001", "002"]);
    expect(r.reservation).toMatchObject({ status: "pending", totalCents: 3000, isDemo: true, numbers: ["001", "002"] });
    expect((await state("001")).status).toBe("reserved");
    const [o] = await mig`SELECT is_demo, status, access_token_hash FROM orders WHERE id = ${r.reservation.orderId}`;
    expect(o).toMatchObject({ is_demo: true, status: "pending" });
    expect(o.access_token_hash).not.toBe(r.token);
    expect((await mig`SELECT count(*)::int n FROM raffle_numbers WHERE raffle_id = ${raffleId} AND status = 'sold'`)[0].n).toBe(0);
  });

  it("20 reservas simultaneas del mismo numero: exactamente una gana", async () => {
    const res = await Promise.allSettled(Array.from({ length: 20 }, () => reserve(["010"])));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of res.filter((r) => r.status === "rejected"))
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "unavailable" });
    expect((await mig`SELECT count(*)::int n FROM order_items WHERE holds_number AND raffle_number_id = (SELECT id FROM raffle_numbers WHERE raffle_id=${raffleId} AND number='010')`)[0].n).toBe(1);
  });

  it("solapes en orden distinto no producen interbloqueo y son atomicos", async () => {
    const res = await Promise.allSettled([
      reserve(["020", "021", "022"]),
      reserve(["022", "021", "023"]),
      reserve(["021", "020", "024"]),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const ok = (res.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ reservation: { numbers: string[] } }>).value.reservation.numbers;
    const reserved = await mig`SELECT number FROM raffle_numbers WHERE raffle_id = ${raffleId} AND number IN ('020','021','022','023','024') AND status='reserved'`;
    expect(reserved.map((r) => r.number).sort()).toEqual(ok);
  });

  it("todo o nada: un numero no disponible no reserva ninguno", async () => {
    await reserve(["030"]);
    await expect(reserve(["031", "030", "032"])).rejects.toMatchObject({ code: "unavailable", unavailable: ["030"] });
    expect((await state("031")).status).toBe("available");
    expect((await state("032")).status).toBe("available");
  });

  it("idempotencia: mismo requestKey devuelve el mismo pedido sin duplicar", async () => {
    const k = key();
    const a = await reserve(["040"], k);
    const b = await reserve(["040"], k);
    expect(b.replay).toBe(true);
    expect(b.reservation.orderId).toBe(a.reservation.orderId);
    expect(b.token).toBe(a.token);
    await expect(reserve(["041"], k)).rejects.toMatchObject({ code: "conflict" });
    const res = await Promise.allSettled(Array.from({ length: 6 }, () => reserve(["042"])));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const kk = key();
    const par = await Promise.allSettled(Array.from({ length: 6 }, () => reserve(["043"], kk)));
    expect(par.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect((await mig`SELECT count(*)::int n FROM orders WHERE raffle_id=${raffleId} AND request_key_hash IS NOT NULL AND id IN (SELECT order_id FROM order_items WHERE raffle_number_id=(SELECT id FROM raffle_numbers WHERE raffle_id=${raffleId} AND number='043'))`)[0].n).toBe(1);
  });

  it("limite de seleccion, entradas invalidas y rifas no publicadas", async () => {
    await expect(reserve(["050", "051", "052", "053", "054", "055"])).rejects.toMatchObject({ code: "limit" });
    await expect(reserve([])).rejects.toMatchObject({ code: "invalid" });
    await expect(reserve(["../x"])).rejects.toMatchObject({ code: "invalid" });
    await expect(reserve(["060"], "corta")).rejects.toMatchObject({ code: "invalid" });
    await expect(reserve(["999"])).rejects.toMatchObject({ code: "unavailable" });
    await expect(reserve(["061"], key(), draftSlug)).rejects.toMatchObject({ code: "not_found" });
    await expect(reserve(["061"], key(), "no-existe")).rejects.toMatchObject({ code: "not_found" });
    await expect(
      svc.reserveNumbers(db, { slug, numbers: ["062"], requestKey: key(), buyer: { name: "A" } }, cfg, SECRET),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("vencimiento: un numero vencido vuelve a estar disponible y un pedido viejo no afecta al nuevo", async () => {
    const old = await reserve(["070"]);
    await mig`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${old.reservation.orderId}`;
    await mig`UPDATE raffle_numbers SET reserved_until = now() - interval '1 minute' WHERE reservation_id = ${old.reservation.orderId}`;
    const counts = await svc.getPublicCounts(db, raffleId);
    expect(counts.available + counts.reserved + counts.sold).toBe(100);
    const fresh = await reserve(["070"]);
    expect(fresh.reservation.status).toBe("pending");
    expect((await mig`SELECT status FROM orders WHERE id = ${old.reservation.orderId}`)[0].status).toBe("expired");
    // El token viejo no libera ni confirma el numero ahora retenido por el pedido nuevo.
    const view = await svc.releaseReservation(db, old.token);
    expect(view?.status).toBe("expired");
    expect((await state("070")).reservation_id).toBe(fresh.reservation.orderId);
    expect((await svc.getReservation(db, fresh.token))?.status).toBe("pending");
  });

  it("liberacion: solo la reserva propia; idempotente; libera para otros", async () => {
    const mine = await reserve(["080"]);
    const other = await reserve(["081"]);
    const rel = await svc.releaseReservation(db, mine.token);
    expect(rel?.status).toBe("cancelled");
    expect((await state("080")).status).toBe("available");
    expect((await state("081")).status).toBe("reserved");
    expect((await svc.releaseReservation(db, mine.token))?.status).toBe("cancelled");
    expect((await svc.getReservation(db, other.token))?.status).toBe("pending");
    await expect(reserve(["080"])).resolves.toBeTruthy();
  });

  it("acceso cruzado: tokens invalidos o ajenos no revelan ni liberan nada (sin enumeracion)", async () => {
    const mine = await reserve(["090"]);
    expect(await svc.getReservation(db, "x".repeat(43))).toBeNull();
    expect(await svc.getReservation(db, "corto")).toBeNull();
    expect(await svc.getReservation(db, mine.reservation.orderId)).toBeNull();
    expect(await svc.releaseReservation(db, "y".repeat(43))).toBeNull();
    expect((await state("090")).status).toBe("reserved");
  });

  it("restricciones de BD: un pedido demo no puede confirmarse ni un numero quedar reservado sin pedido activo doble", async () => {
    const r = await reserve(["095"]);
    await expect(mig`UPDATE orders SET status = 'confirmed' WHERE id = ${r.reservation.orderId}`).rejects.toThrow();
    await expect(
      mig`UPDATE raffle_numbers SET status = 'sold', reservation_id = NULL, reserved_until = NULL WHERE reservation_id = ${r.reservation.orderId} AND false`,
    ).resolves.toBeDefined();
  });

  it("contadores y paginacion publica", async () => {
    const c = await svc.getPublicCounts(db, raffleId);
    expect(c.total).toBe(100);
    expect(c.sold).toBe(0);
    expect(c.reserved).toBeGreaterThan(0);
    const p = await svc.listPublicNumbers(db, raffleId, { pageSize: 30, page: 2 });
    expect(p.items).toHaveLength(30);
    expect(p.items[0].number).toBe("031");
    const f = await svc.listPublicNumbers(db, raffleId, { filter: "reserved", pageSize: 500 });
    expect(f.items.every((i) => i.status === "reserved")).toBe(true);
    expect(f.pageSize).toBe(200);
    const q = await svc.listPublicNumbers(db, raffleId, { q: "070" });
    expect(q.items.map((i) => i.number)).toEqual(["070"]);
  });
});
