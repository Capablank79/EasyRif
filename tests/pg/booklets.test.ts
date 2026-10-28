import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeQr } from "../helpers/pdf";

/* Talonarios foliados (BUILD-008) contra PostgreSQL real. Datos .invalid, limpiados al final. */
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

describe.skipIf(!enabled)("Talonarios foliados (PostgreSQL real)", () => {
  const tag = randomUUID().slice(0, 8);
  const SECRET = "test-secret-booklets-" + tag + "-0000000000";
  let mig: postgres.Sql;
  let rsvc: typeof import("@/modules/raffles/service");
  let svc: typeof import("@/modules/reservations/service");
  let rcpt: typeof import("@/modules/receipts/service");
  let pdfm: typeof import("@/modules/receipts/pdf");
  let db: ReturnType<typeof import("@/platform/db/client").getDb>;
  let userId = "";
  let otherUserId = "";
  let orgId = "";
  let otherOrgId = "";
  let raffleId = "";
  let slug = "";
  let individualId = "";
  const key = () => randomBytes(18).toString("base64url");
  const buyer = { name: "Comprador Demo", email: `c-${tag}@example.invalid` };
  const cfg = { ttlMinutes: 10, maxSelection: 200 };
  const parts = (numbers: string[]) =>
    Object.fromEntries(numbers.map((n, i) => [n, { name: `Participante ${i + 1}`, email: `p${i}-${tag}@example.invalid` }]));
  const reserve = (numbers: string[]) =>
    svc.reserveNumbers(db, { slug, numbers, requestKey: key(), buyer, participants: parts(numbers), consent: true }, cfg, SECRET);
  const base = { description: null, priceMinor: 1500, currency: "CLP" as const, drawDate: null };

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    process.env.BETTER_AUTH_SECRET = SECRET;
    mig = postgres(MIGRATOR!, { max: 4, onnotice: () => {} });
    db = (await import("@/platform/db/client")).getDb();
    rsvc = await import("@/modules/raffles/service");
    svc = await import("@/modules/reservations/service");
    rcpt = await import("@/modules/receipts/service");
    pdfm = await import("@/modules/receipts/pdf");
    [{ id: userId }] = await mig`INSERT INTO users (email, display_name) VALUES (${`own-${tag}@example.invalid`}, 'Own') RETURNING id`;
    [{ id: otherUserId }] = await mig`INSERT INTO users (email, display_name) VALUES (${`oth-${tag}@example.invalid`}, 'Oth') RETURNING id`;
    [{ id: orgId }] = await mig`INSERT INTO organizations (name) VALUES (${"Org Tal " + tag}) RETURNING id`;
    [{ id: otherOrgId }] = await mig`INSERT INTO organizations (name) VALUES (${"Org Otra " + tag}) RETURNING id`;
    await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${orgId}, ${userId}, 'owner', 'active')`;
    await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${otherOrgId}, ${otherUserId}, 'owner', 'active')`;
    const r = await rsvc.createRaffle(db, userId, orgId, {
      ...base,
      title: `Talonarios ${tag}`,
      numberCount: 200,
      numbering: "booklets",
      bookletCount: 10,
      numbersPerBooklet: 20,
      firstFolio: 1,
      salesClosesAt: new Date(Date.now() + 30 * 86_400_000),
      drawAt: new Date(Date.now() + 40 * 86_400_000),
    });
    raffleId = r.id;
    slug = r.slug;
    const i = await rsvc.createRaffle(db, userId, orgId, { ...base, title: `Individual ${tag}`, numberCount: 50 });
    individualId = i.id;
    await rsvc.generateNumbers(db, userId, individualId);
  });

  afterAll(async () => {
    for (const o of [orgId, otherOrgId]) {
      if (!o) continue;
      await mig`DELETE FROM orders WHERE organization_id = ${o}`;
      await mig`DELETE FROM buyer_contacts WHERE organization_id = ${o}`;
      await mig`DELETE FROM raffles WHERE organization_id = ${o}`;
      await mig`DELETE FROM organizations WHERE id = ${o}`;
    }
    await mig`DELETE FROM users WHERE email LIKE ${`%-${tag}@example.invalid`}`;
    await mig.end();
  });

  it("10 talonarios x 20 numeros generan 200 participaciones unicas, de forma idempotente y concurrente", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => rsvc.generateNumbers(db, userId, raffleId)));
    expect(results.reduce((a, r) => a + r.created, 0)).toBe(200);
    expect(await rsvc.generateNumbers(db, userId, raffleId)).toMatchObject({ created: 0, total: 200 });
    const [{ b }] = await mig`SELECT count(*)::int b FROM booklets WHERE raffle_id = ${raffleId}`;
    const [{ n, d }] = await mig`SELECT count(*)::int n, count(DISTINCT number)::int d FROM raffle_numbers WHERE raffle_id = ${raffleId}`;
    expect([b, n, d]).toEqual([10, 200, 200]);
    const folios = await mig`SELECT folio FROM booklets WHERE raffle_id = ${raffleId} ORDER BY folio`;
    expect(folios.map((f) => f.folio)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const [{ k }] = await mig`SELECT min(number) k FROM raffle_numbers WHERE raffle_id = ${raffleId}`;
    expect(k).toBe("T0001N01");
    // El mismo numero interno existe en todos los folios sin colision.
    const [{ same }] = await mig`SELECT count(*)::int same FROM raffle_numbers WHERE raffle_id = ${raffleId} AND local_number = 14`;
    expect(same).toBe(10);
  });

  it("restricciones de integridad en PostgreSQL", async () => {
    const [b1] = await mig`SELECT id, organization_id FROM booklets WHERE raffle_id = ${raffleId} AND folio = 1`;
    // folio duplicado
    await expect(mig`INSERT INTO booklets (raffle_id, organization_id, folio) VALUES (${raffleId}, ${orgId}, 1)`).rejects.toThrow();
    // folio fuera de rango configurado
    await expect(mig`INSERT INTO booklets (raffle_id, organization_id, folio) VALUES (${raffleId}, ${orgId}, 11)`).rejects.toThrow();
    // numero interno duplicado en el mismo talonario (con otra clave)
    await expect(
      mig`INSERT INTO raffle_numbers (raffle_id, organization_id, number, booklet_id, local_number) VALUES (${raffleId}, ${orgId}, 'T0001N01', ${b1.id}, 1)`,
    ).rejects.toThrow();
    // clave que no coincide con folio/numero interno
    await expect(
      mig`INSERT INTO raffle_numbers (raffle_id, organization_id, number, booklet_id, local_number) VALUES (${raffleId}, ${orgId}, 'T0002N99', ${b1.id}, 99)`,
    ).rejects.toThrow();
    // numero de una rifa de talonarios sin talonario
    await expect(mig`INSERT INTO raffle_numbers (raffle_id, organization_id, number) VALUES (${raffleId}, ${orgId}, 'X1')`).rejects.toThrow();
    // renumerar o mover un numero
    await expect(mig`UPDATE raffle_numbers SET number = 'T0001N77' WHERE raffle_id = ${raffleId} AND number = 'T0001N01'`).rejects.toThrow();
    await expect(mig`UPDATE raffle_numbers SET local_number = 5 WHERE raffle_id = ${raffleId} AND number = 'T0001N01'`).rejects.toThrow();
    // folio inmutable y talonario de otra organizacion
    await expect(mig`UPDATE booklets SET folio = 99 WHERE id = ${b1.id}`).rejects.toThrow();
    await expect(
      mig`INSERT INTO booklets (raffle_id, organization_id, folio) VALUES (${raffleId}, ${otherOrgId}, 1)`,
    ).rejects.toThrow();
    // una rifa individual no admite talonarios
    await expect(mig`INSERT INTO booklets (raffle_id, organization_id, folio) VALUES (${individualId}, ${orgId}, 1)`).rejects.toThrow();
    // configuracion inmutable tras generar
    await expect(mig`UPDATE raffles SET numbers_per_booklet = 30, number_count = 300 WHERE id = ${raffleId}`).rejects.toThrow();
    await expect(mig`UPDATE raffles SET numbering_mode = 'individual', booklet_count = NULL, numbers_per_booklet = NULL, first_folio = NULL WHERE id = ${raffleId}`).rejects.toThrow();
    // CHECK de coherencia
    await expect(
      mig`INSERT INTO raffles (organization_id, slug, title, price_cents, currency, number_count, numbering_mode, booklet_count, numbers_per_booklet, first_folio) VALUES (${orgId}, ${"bad-" + tag}, 'Mal', 100, 'CLP', 199, 'booklets', 10, 20, 1)`,
    ).rejects.toThrow();
    const [{ n }] = await mig`SELECT count(*)::int n FROM raffle_numbers WHERE raffle_id = ${raffleId}`;
    expect(n).toBe(200);
  });

  it("no se puede cambiar la numeracion desde el servicio una vez generada", async () => {
    await expect(
      rsvc.updateRaffle(db, userId, raffleId, {
        ...base, title: "x", numberCount: 300, numbering: "booklets", bookletCount: 15, numbersPerBooklet: 20, firstFolio: 1,
      }),
    ).rejects.toMatchObject({ code: "state" });
  });

  it("publicacion exige todos los talonarios y listados incluyen folio y etiqueta", async () => {
    await rsvc.addPrize(db, userId, raffleId, { title: "Premio", description: null });
    await rsvc.publishRaffle(db, userId, raffleId);
    const sums = await svc.listBookletSummaries(db, raffleId);
    expect(sums).toHaveLength(10);
    expect(sums.every((s) => s.total === 20 && s.available === 20)).toBe(true);
    const page = await svc.listPublicNumbers(db, raffleId, { folio: 7, pageSize: 50 });
    expect(page.total).toBe(20);
    expect(page.items[0]).toMatchObject({ number: "T0007N01", label: "T-0007 / N-01", folio: 7 });
    const byLocal = await svc.listPublicNumbers(db, raffleId, { q: "14" });
    expect(byLocal.total).toBe(10);
    expect((await svc.getPublicCounts(db, raffleId, 3)).total).toBe(20);
    const pub = await rsvc.getPublicRaffle(db, slug);
    expect(pub).toMatchObject({ numberingMode: "booklets", bookletCount: 10, numbersPerBooklet: 20 });
  });

  it("reserva participaciones de varios folios, genera comprobante con etiquetas y libera", async () => {
    const r = await reserve(["T0002N05", "T0001N14", "T0010N20"]);
    expect(r.reservation.numbers).toEqual(["T0001N14", "T0002N05", "T0010N20"]);
    expect(r.reservation.labels).toEqual(["T-0001 / N-14", "T-0002 / N-05", "T-0010 / N-20"]);
    // Mismo numero interno en otro folio sigue libre.
    expect((await svc.listPublicNumbers(db, raffleId, { folio: 5, q: "5", filter: "available" })).items.some((i) => i.label === "T-0005 / N-05")).toBe(true);
    const sums = await svc.listBookletSummaries(db, raffleId);
    expect(sums.find((s) => s.folio === 1)).toMatchObject({ available: 19, reserved: 1 });

    const data = await rcpt.getReceiptData(db, r.token);
    expect(data.numbers).toEqual(["T-0001 / N-14", "T-0002 / N-05", "T-0010 / N-20"]);
    const pdf = await pdfm.buildReceiptPdf(data, "https://example.test");
    expect(await decodeQr(pdf)).toBe(`https://example.test/verificar/${data.verificationCode}`);
    const v = await rcpt.getVerification(db, data.verificationCode);
    expect(v?.numbers).toEqual(data.numbers);
    expect(JSON.stringify(v)).not.toContain(buyer.email);

    // Otro cliente no puede tomar una participacion ya reservada.
    await expect(reserve(["T0002N05"])).rejects.toMatchObject({ code: "unavailable" });

    await svc.releaseReservation(db, r.token);
    expect((await svc.listBookletSummaries(db, raffleId)).every((s) => s.available === 20)).toBe(true);
    expect((await rcpt.getReceiptData(db, r.token)).numbers).toEqual(data.numbers);
  });

  it("reservas concurrentes sobre la misma participacion: solo una gana", async () => {
    const res = await Promise.allSettled(Array.from({ length: 6 }, () => reserve(["T0004N04"])));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const [{ r }] = await mig`SELECT count(*)::int r FROM raffle_numbers WHERE raffle_id = ${raffleId} AND status = 'reserved'`;
    expect(r).toBe(1);
  });

  it("comprobante de un talonario completo (20) y de 200 participaciones ocupa varias paginas", async () => {
    const all = (await mig`SELECT number FROM raffle_numbers WHERE raffle_id = ${raffleId} AND status = 'available' ORDER BY number`).map((x) => x.number as string);
    expect(all.length).toBeGreaterThan(190);
    const r = await reserve(all.slice(0, 120));
    const data = await rcpt.getReceiptData(db, r.token);
    expect(data.numbers).toHaveLength(120);
    const pdf = await pdfm.buildReceiptPdf(data, "https://example.test");
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);
    expect(await decodeQr(pdf)).toContain(data.verificationCode);
  });

  it("aislamiento por organizacion en el panel de talonarios", async () => {
    const ok = await rsvc.getBookletOverview(db, userId, raffleId, 3);
    expect(ok.summaries).toHaveLength(10);
    expect(ok.numbers).toHaveLength(20);
    await expect(rsvc.getBookletOverview(db, otherUserId, raffleId, 3)).rejects.toMatchObject({ code: "not_found" });
    await expect(rsvc.getBookletOverview(db, userId, individualId, null)).rejects.toMatchObject({ code: "not_found" });
  });

  it("compatibilidad: rifa individual intacta y sin talonarios", async () => {
    const [m] = await mig`SELECT numbering_mode, booklet_count FROM raffles WHERE id = ${individualId}`;
    expect(m).toMatchObject({ numbering_mode: "individual", booklet_count: null });
    const [{ n, nb }] = await mig`SELECT count(*)::int n, count(booklet_id)::int nb FROM raffle_numbers WHERE raffle_id = ${individualId}`;
    expect([n, nb]).toEqual([50, 0]);
    expect((await svc.listPublicNumbers(db, individualId, { pageSize: 3 })).items[0]).toMatchObject({ number: "01", label: "01", folio: null });
    // Las rifas reales existentes (si estan en esta base) conservan numeracion individual.
    const real = await mig`SELECT numbering_mode FROM raffles WHERE slug IN ('miguelito', 'martin')`;
    for (const x of real) expect(x.numbering_mode).toBe("individual");
  });
});
