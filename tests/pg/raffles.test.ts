import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { campaignScheduleForDate, getAppTimeZone, utcToZonedDateInput } from "@/modules/raffles/campaign";

/*
 * Módulo de rifas contra PostgreSQL real (easyrif_dev) con el rol de aplicación.
 * Usuarios y organizaciones de prueba (.invalid) se crean y eliminan con el rol migrador.
 */
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

describe.skipIf(!enabled)("Rifas (PostgreSQL real)", () => {
  const tag = randomUUID().slice(0, 8);
  let mig: postgres.Sql;
  let svc: typeof import("@/modules/raffles/service");
  let db: ReturnType<typeof import("@/platform/db/client").getDb>;
  const ids: Record<string, string> = {};
  let orgA = "";
  let orgB = "";
  const input = (over: Record<string, unknown> = {}) => ({
    title: "Rifa de prueba",
    description: null,
    priceMinor: 1000,
    currency: "CLP" as const,
    numberCount: 100,
    drawDate: null,
    ...over,
  });

  async function mkUser(name: string) {
    const [u] = await mig`INSERT INTO users (email, display_name) VALUES (${`${name.toLowerCase()}-${tag}@example.invalid`}, ${name}) RETURNING id`;
    ids[name] = u.id;
  }
  async function member(org: string, user: string, role: string) {
    await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${org}, ${ids[user]}, ${role}, 'active')`;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    mig = postgres(MIGRATOR!, { max: 2, onnotice: () => {} });
    db = (await import("@/platform/db/client")).getDb();
    svc = await import("@/modules/raffles/service");
    for (const n of ["ownerA", "adminA", "editorA", "viewerA", "ownerB"]) await mkUser(n);
    [{ id: orgA }] = await mig`INSERT INTO organizations (name) VALUES (${"Org A " + tag}) RETURNING id`;
    [{ id: orgB }] = await mig`INSERT INTO organizations (name) VALUES (${"Org B " + tag}) RETURNING id`;
    await member(orgA, "ownerA", "owner");
    await member(orgA, "adminA", "admin");
    await member(orgA, "editorA", "editor");
    await member(orgA, "viewerA", "viewer");
    await member(orgB, "ownerB", "owner");
  });

  afterAll(async () => {
    for (const o of [orgA, orgB]) {
      if (!o) continue;
      // organizations → raffles es RESTRICT: se borran primero las rifas (premios y números en cascada).
      await mig`DELETE FROM raffles WHERE organization_id = ${o}`;
      await mig`DELETE FROM organizations WHERE id = ${o}`;
    }
    await mig`DELETE FROM users WHERE email LIKE ${`%-${tag}@example.invalid`}`;
    await mig.end();
  });

  const prize = { title: "Premio", description: null };

  it("crea borrador con slug único y auditoría; slugs repetidos no colisionan", async () => {
    const a = await svc.createRaffle(db, ids.ownerA, orgA, input({ title: `Rifa ${tag}` }));
    const b = await svc.createRaffle(db, ids.ownerA, orgA, input({ title: `Rifa ${tag}` }));
    expect(a.slug).toBe(`rifa-${tag}`);
    expect(b.slug).not.toBe(a.slug);
    const d = await svc.getRaffleDetail(db, ids.ownerA, a.id);
    expect(d.raffle.status).toBe("draft");
    const [{ n }] = await mig`SELECT count(*)::int n FROM audit_events WHERE entity_id = ${a.id} AND action = 'raffle.created'`;
    expect(n).toBe(1);
  });

  it("creación simultánea con el mismo título produce slugs distintos", async () => {
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => svc.createRaffle(db, ids.ownerA, orgA, input({ title: `Concurrente ${tag}` }))),
    );
    expect(new Set(rs.map((r) => r.slug)).size).toBe(5);
  });

  it("permisos: viewer no crea ni edita; editor crea; organización ajena se rechaza", async () => {
    await expect(svc.createRaffle(db, ids.viewerA, orgA, input())).rejects.toThrow();
    await expect(svc.createRaffle(db, ids.ownerB, orgA, input())).rejects.toThrow();
    const r = await svc.createRaffle(db, ids.editorA, orgA, input());
    await expect(svc.updateRaffle(db, ids.viewerA, r.id, input())).rejects.toThrow();
    await svc.updateRaffle(db, ids.editorA, r.id, input({ title: "Editada" }));
    expect((await svc.getRaffleDetail(db, ids.viewerA, r.id)).raffle.title).toBe("Editada");
  });

  it("rifa individual: permite guardar fechas compartidas y conservarlas al editar otros campos", async () => {
    const timezone = getAppTimeZone();
    const localDate = (days: number) => utcToZonedDateInput(new Date(Date.now() + days * 86_400_000), timezone);
    const firstSchedule = campaignScheduleForDate(localDate(30), timezone)!;
    const raffle = await svc.createRaffle(db, ids.editorA, orgA, input({
      title: `Individual con fechas ${tag}`, drawDate: firstSchedule.drawAt,
      salesClosesAt: firstSchedule.salesClosesAt, drawAt: firstSchedule.drawAt,
    }));

    await svc.updateRaffle(db, ids.editorA, raffle.id, input({
      title: "Individual editada", drawDate: firstSchedule.drawAt,
      salesClosesAt: firstSchedule.salesClosesAt, drawAt: firstSchedule.drawAt,
    }));
    let saved = await svc.getRaffleDetail(db, ids.editorA, raffle.id);
    expect(saved.raffle).toMatchObject({
      title: "Individual editada", numberingMode: "individual",
      salesClosesAt: firstSchedule.salesClosesAt, drawAt: firstSchedule.drawAt,
    });

    const secondSchedule = campaignScheduleForDate(localDate(35), timezone)!;
    await svc.updateRaffle(db, ids.editorA, raffle.id, input({
      title: "Fecha individual actualizada", drawDate: secondSchedule.drawAt,
      salesClosesAt: secondSchedule.salesClosesAt, drawAt: secondSchedule.drawAt,
    }));
    saved = await svc.getRaffleDetail(db, ids.editorA, raffle.id);
    expect(saved.raffle).toMatchObject({ salesClosesAt: secondSchedule.salesClosesAt, drawAt: secondSchedule.drawAt });
  });

  it("IDOR: otra organización no ve, edita ni opera la rifa", async () => {
    const r = await svc.createRaffle(db, ids.ownerA, orgA, input());
    await expect(svc.getRaffleDetail(db, ids.ownerB, r.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.updateRaffle(db, ids.ownerB, r.id, input())).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.addPrize(db, ids.ownerB, r.id, prize)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.generateNumbers(db, ids.ownerB, r.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.publishRaffle(db, ids.ownerB, r.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.getRaffleDetail(db, ids.ownerB, randomUUID())).rejects.toMatchObject({ code: "not_found" });
    const list = await svc.listRaffles(db, ids.ownerB, orgB);
    expect(list.find((x) => x.id === r.id)).toBeUndefined();
    await expect(svc.listRaffles(db, ids.ownerB, orgA)).rejects.toThrow();
  });

  it("premios de otra rifa no se pueden tocar aunque se conozca su id", async () => {
    const own = await svc.createRaffle(db, ids.ownerA, orgA, input());
    const other = await svc.createRaffle(db, ids.ownerB, orgB, input());
    await svc.addPrize(db, ids.ownerB, other.id, prize);
    const [p] = await mig`SELECT id FROM prizes WHERE raffle_id = ${other.id}`;
    await expect(svc.updatePrize(db, ids.ownerA, own.id, p.id, prize)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.deletePrize(db, ids.ownerA, own.id, p.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.movePrize(db, ids.ownerA, own.id, p.id, "up")).rejects.toMatchObject({ code: "not_found" });
  });

  it("premios: alta, orden, mover, editar y eliminar", async () => {
    const r = await svc.createRaffle(db, ids.ownerA, orgA, input());
    for (const t of ["Uno", "Dos", "Tres"]) await svc.addPrize(db, ids.ownerA, r.id, { title: t, description: null });
    let d = await svc.getRaffleDetail(db, ids.ownerA, r.id);
    expect(d.prizes.map((p) => p.title)).toEqual(["Uno", "Dos", "Tres"]);
    await svc.movePrize(db, ids.ownerA, r.id, d.prizes[2].id, "up");
    d = await svc.getRaffleDetail(db, ids.ownerA, r.id);
    expect(d.prizes.map((p) => p.title)).toEqual(["Uno", "Tres", "Dos"]);
    await svc.updatePrize(db, ids.ownerA, r.id, d.prizes[0].id, { title: "Uno bis", description: "x" });
    await svc.deletePrize(db, ids.ownerA, r.id, d.prizes[1].id);
    d = await svc.getRaffleDetail(db, ids.ownerA, r.id);
    expect(d.prizes.map((p) => p.title)).toEqual(["Uno bis", "Dos"]);
    await svc.addPrize(db, ids.ownerA, r.id, prize);
    d = await svc.getRaffleDetail(db, ids.ownerA, r.id);
    expect(new Set(d.prizes.map((p) => p.position)).size).toBe(3);
  });

  it("numeración: idempotente, formato y cantidad exacta", async () => {
    const r = await svc.createRaffle(db, ids.ownerA, orgA, input({ numberCount: 120 }));
    const first = await svc.generateNumbers(db, ids.ownerA, r.id);
    expect(first.created).toBe(120);
    const again = await svc.generateNumbers(db, ids.ownerA, r.id);
    expect(again.created).toBe(0);
    const d = await svc.getRaffleDetail(db, ids.ownerA, r.id);
    expect(d.numbers).toMatchObject({ total: 120, available: 120 });
    expect(d.numbers.sample[0]).toBe("001");
    await expect(svc.updateRaffle(db, ids.ownerA, r.id, input({ numberCount: 50 }))).rejects.toMatchObject({
      code: "state",
    });
    await expect(svc.generateNumbers(db, ids.viewerA, r.id)).rejects.toThrow();
  });

  it("numeración concurrente: sin duplicados ni parciales", async () => {
    const r = await svc.createRaffle(db, ids.ownerA, orgA, input({ numberCount: 500 }));
    const res = await Promise.all(Array.from({ length: 6 }, () => svc.generateNumbers(db, ids.ownerA, r.id)));
    expect(res.reduce((a, x) => a + x.created, 0)).toBe(500);
    const [row] = await mig`SELECT count(*)::int n, count(DISTINCT number)::int d FROM raffle_numbers WHERE raffle_id = ${r.id}`;
    expect(row).toMatchObject({ n: 500, d: 500 });
  });

  it("publicar: bloqueada si está incompleta; editor no publica; admin sí", async () => {
    const r = await svc.createRaffle(db, ids.ownerA, orgA, input({ numberCount: 10 }));
    await expect(svc.publishRaffle(db, ids.adminA, r.id)).rejects.toMatchObject({ code: "state" });
    await svc.addPrize(db, ids.ownerA, r.id, prize);
    await expect(svc.publishRaffle(db, ids.adminA, r.id)).rejects.toMatchObject({ code: "state" });
    await svc.generateNumbers(db, ids.ownerA, r.id);
    await expect(svc.publishRaffle(db, ids.editorA, r.id)).rejects.toThrow();
    await expect(svc.publishRaffle(db, ids.viewerA, r.id)).rejects.toThrow();
    await svc.publishRaffle(db, ids.adminA, r.id);
    const d = await svc.getRaffleDetail(db, ids.ownerA, r.id);
    expect(d.raffle.status).toBe("published");
    await expect(svc.publishRaffle(db, ids.adminA, r.id)).rejects.toMatchObject({ code: "state" });

    // Tras publicar: no se edita ni se cambian premios o números.
    await expect(svc.updateRaffle(db, ids.ownerA, r.id, input({ title: "x" }))).rejects.toMatchObject({ code: "state" });
    await expect(svc.addPrize(db, ids.ownerA, r.id, prize)).rejects.toMatchObject({ code: "state" });
    await expect(svc.generateNumbers(db, ids.ownerA, r.id)).rejects.toMatchObject({ code: "state" });
  });

  it("precio cero no se puede publicar", async () => {
    const r = await svc.createRaffle(db, ids.ownerA, orgA, input({ numberCount: 5, priceMinor: 0 }));
    await svc.addPrize(db, ids.ownerA, r.id, prize);
    await svc.generateNumbers(db, ids.ownerA, r.id);
    await expect(svc.publishRaffle(db, ids.ownerA, r.id)).rejects.toMatchObject({ code: "state" });
  });

  it("trigger de BD: inmutabilidad tras publicar y publicación incompleta (defensa en profundidad)", async () => {
    const r = await svc.createRaffle(db, ids.ownerA, orgA, input({ numberCount: 5 }));
    await expect(mig`UPDATE raffles SET status='published' WHERE id=${r.id}`).rejects.toThrow(/sin premios/);
    await svc.addPrize(db, ids.ownerA, r.id, prize);
    await expect(mig`UPDATE raffles SET status='published' WHERE id=${r.id}`).rejects.toThrow(/números generados/);
    await svc.generateNumbers(db, ids.ownerA, r.id);
    await mig`UPDATE raffles SET status='published' WHERE id=${r.id}`;
    await expect(mig`UPDATE raffles SET number_count=6 WHERE id=${r.id}`).rejects.toThrow(/inmutable/);
    await expect(mig`UPDATE raffles SET price_cents=1 WHERE id=${r.id}`).rejects.toThrow(/inmutables/);
    await expect(mig`UPDATE raffles SET slug='otro-slug' WHERE id=${r.id}`).rejects.toThrow(/inmutable/);
    await expect(mig`UPDATE raffles SET status='draft' WHERE id=${r.id}`).rejects.toThrow(/borrador/);
    await mig`UPDATE raffles SET title='Nuevo título' WHERE id=${r.id}`;
  });

  it("listado: contadores 0 / parciales / completos, sin contaminación entre rifas ni organizaciones", async () => {
    const empty = await svc.createRaffle(db, ids.ownerA, orgA, input({ title: `Vacia ${tag}`, numberCount: 7 }));
    const full = await svc.createRaffle(db, ids.ownerA, orgA, input({ title: `Llena ${tag}`, numberCount: 30 }));
    const otherB = await svc.createRaffle(db, ids.ownerB, orgB, input({ title: `OtraOrg ${tag}`, numberCount: 11 }));
    await svc.addPrize(db, ids.ownerA, full.id, prize);
    await svc.addPrize(db, ids.ownerA, full.id, { title: "Segundo", description: null });
    await svc.addPrize(db, ids.ownerB, otherB.id, prize);
    await svc.generateNumbers(db, ids.ownerB, otherB.id);
    const get = async (user: string, org: string, id: string) =>
      (await svc.listRaffles(db, user, org)).find((x) => x.id === id);

    expect(await get(ids.ownerA, orgA, empty.id)).toMatchObject({ prizeCount: 0, numberCount: 7, numberTotal: 0 });
    expect(await get(ids.ownerA, orgA, full.id)).toMatchObject({ prizeCount: 2, numberCount: 30, numberTotal: 0 });
    await svc.generateNumbers(db, ids.ownerA, full.id);
    expect(await get(ids.ownerA, orgA, full.id)).toMatchObject({ prizeCount: 2, numberCount: 30, numberTotal: 30 });
    expect(await get(ids.ownerA, orgA, empty.id)).toMatchObject({ prizeCount: 0, numberTotal: 0 });
    expect(await get(ids.ownerB, orgB, otherB.id)).toMatchObject({ prizeCount: 1, numberCount: 11, numberTotal: 11 });

    // Coherencia con el detalle y reflejo de cambios.
    const d = await svc.getRaffleDetail(db, ids.ownerA, full.id);
    expect(d.prizes.length).toBe(2);
    expect(d.numbers.total).toBe(30);
    await svc.deletePrize(db, ids.ownerA, empty.id, randomUUID()).catch(() => {});
    await svc.addPrize(db, ids.ownerA, empty.id, prize);
    expect((await get(ids.ownerA, orgA, empty.id))?.prizeCount).toBe(1);
    // Sin cruce entre organizaciones.
    expect((await svc.listRaffles(db, ids.ownerB, orgB)).find((x) => x.id === full.id)).toBeUndefined();
  });

  it("ficha pública: solo publicadas y sin datos internos", async () => {
    const draft = await svc.createRaffle(db, ids.ownerA, orgA, input({ numberCount: 5 }));
    expect(await svc.getPublicRaffle(db, draft.slug)).toBeNull();
    await svc.addPrize(db, ids.ownerA, draft.id, { title: "Bicicleta", description: null });
    await svc.generateNumbers(db, ids.ownerA, draft.id);
    await svc.publishRaffle(db, ids.ownerA, draft.id);
    const pub = await svc.getPublicRaffle(db, draft.slug);
    expect(pub?.prizes).toEqual([{ title: "Bicicleta", description: null, imageKey: null }]);
    expect(JSON.stringify(pub)).not.toMatch(new RegExp(`${orgA}|${ids.ownerA}|${draft.id}`));
    expect(await svc.getPublicRaffle(db, "no-existe-xyz")).toBeNull();
  });
});
