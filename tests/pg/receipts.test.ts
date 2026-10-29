import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeQr } from "../helpers/pdf";

/* Comprobante PDF y verificacion contra PostgreSQL real. Datos .invalid, limpiados al final. */
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

describe.skipIf(!enabled)("Comprobante y verificacion (PostgreSQL real)", () => {
  const tag = randomUUID().slice(0, 8);
  const SECRET = "test-secret-receipts-" + tag + "-0000000000";
  let mig: postgres.Sql;
  let rcpt: typeof import("@/modules/receipts/service");
  let ver: typeof import("@/modules/receipts/verification");
  let pdfm: typeof import("@/modules/receipts/pdf");
  let svc: typeof import("@/modules/reservations/service");
  let db: ReturnType<typeof import("@/platform/db/client").getDb>;
  let userId = "";
  let orgId = "";
  let slug = "";
  let raffleId = "";
  const key = () => randomBytes(18).toString("base64url");
  const buyer = { name: "Comprador Demo", email: `c-${tag}@example.invalid` };
  const cfg = { ttlMinutes: 10, maxSelection: 5 };
  const reserve = (numbers: string[]) =>
    svc.reserveNumbers(db, {
      slug,
      numbers,
      requestKey: key(),
      buyer,
      participants: Object.fromEntries(numbers.map((n, i) => [n, { name: `Participante ${i + 1}`, email: `p${i}-${tag}@example.invalid` }])),
      consent: true,
    }, cfg, SECRET);

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    process.env.BETTER_AUTH_SECRET = SECRET;
    mig = postgres(MIGRATOR!, { max: 2, onnotice: () => {} });
    db = (await import("@/platform/db/client")).getDb();
    svc = await import("@/modules/reservations/service");
    rcpt = await import("@/modules/receipts/service");
    ver = await import("@/modules/receipts/verification");
    pdfm = await import("@/modules/receipts/pdf");
    const rsvc = await import("@/modules/raffles/service");
    [{ id: userId }] = await mig`INSERT INTO users (email, display_name) VALUES (${`own-${tag}@example.invalid`}, 'Own') RETURNING id`;
    [{ id: orgId }] = await mig`INSERT INTO organizations (name) VALUES (${"Org Comp " + tag}) RETURNING id`;
    await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${orgId}, ${userId}, 'owner', 'active')`;
    const r = await rsvc.createRaffle(db, userId, orgId, {
      title: `Comprobantes ${tag}`, description: null, priceMinor: 1500, currency: "CLP", numberCount: 100, drawDate: null,
    });
    await rsvc.addPrize(db, userId, r.id, { title: "Premio", description: null });
    await rsvc.generateNumbers(db, userId, r.id);
    await rsvc.publishRaffle(db, userId, r.id);
    slug = r.slug;
    raffleId = r.id;
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

  it("migracion 0007: columnas, indice unico y trigger existen", async () => {
    const cols = await mig`SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name IN ('verification_hash','receipt_issued_at')`;
    expect(cols).toHaveLength(2);
    expect((await mig`SELECT 1 FROM pg_indexes WHERE indexname='orders_verification_uq'`)).toHaveLength(1);
    expect((await mig`SELECT 1 FROM pg_trigger WHERE tgname LIKE '%no_demo_sold%' AND NOT tgisinternal`).length).toBeGreaterThan(0);
  });

  it("varios numeros: un solo comprobante, un solo QR, mismo codigo en descargas repetidas y concurrentes", async () => {
    const r = await reserve(["001", "002", "003"]);
    const results = await Promise.all(Array.from({ length: 8 }, () => rcpt.getReceiptData(db, r.token)));
    const codes = new Set(results.map((d) => d.verificationCode));
    expect(codes.size).toBe(1);
    expect(new Set(results.map((d) => d.issuedAt.getTime())).size).toBe(1);
    expect(results[0].numbers).toEqual(["001", "002", "003"]);
    expect(results[0].participants?.map((p) => p.label)).toEqual(["001", "002", "003"]);
    expect(results[0].totalCents).toBe(4500);
    const [{ n }] = await mig`SELECT count(*)::int n FROM orders WHERE organization_id = ${orgId}`;
    expect(n).toBe(1);
    const [{ items }] = await mig`SELECT count(*)::int items FROM order_items WHERE order_id = ${r.reservation.orderId}`;
    expect(items).toBe(3);

    const pdf = await pdfm.buildReceiptPdf(results[0], "https://example.test");
    const qr = await decodeQr(pdf);
    expect(qr).toBe(`https://example.test/verificar/${results[0].verificationCode}`);
    expect(qr).not.toContain(r.token);
    // El codigo de verificacion no es el token y no sirve para liberar ni consultar la reserva.
    expect(results[0].verificationCode).not.toBe(r.token);
    expect(await svc.releaseReservation(db, results[0].verificationCode)).toBeNull();
    expect(await svc.getReservation(db, results[0].verificationCode)).toBeNull();
    const [{ sold }] = await mig`SELECT count(*)::int sold FROM raffle_numbers WHERE raffle_id = ${raffleId} AND status='sold'`;
    expect(sold).toBe(0);
  });

  it("compra pública individual: participantes y pago ficticio quedan trazados sin convertirse en venta", async () => {
    const r = await reserve(["055", "056"]);
    expect(r.reservation.canConfirmSimulation).toBe(true);
    const first = await svc.confirmSimulatedPurchase(db, r.token);
    expect(first.replay).toBe(false);
    expect((await svc.confirmSimulatedPurchase(db, r.token)).replay).toBe(true);

    const [order] = await mig`SELECT status, is_demo, seller_id, total_cents FROM orders WHERE id = ${r.reservation.orderId}`;
    expect(order).toEqual({ status: "pending", is_demo: true, seller_id: null, total_cents: 3000 });
    const [{ participants }] = await mig`SELECT count(*)::int participants FROM order_item_participants WHERE order_id = ${r.reservation.orderId}`;
    expect(participants).toBe(2);
    const [{ sold }] = await mig`SELECT count(*)::int sold FROM raffle_numbers WHERE raffle_id = ${raffleId} AND number IN ('055','056') AND status = 'sold'`;
    expect(sold).toBe(0);
    const [{ simulated }] = await mig`SELECT count(*)::int simulated FROM raffle_numbers WHERE raffle_id = ${raffleId} AND number IN ('055','056') AND status = 'simulated_sold'`;
    expect(simulated).toBe(2);
    await expect(reserve(["055"])).rejects.toBeTruthy();
    const [purchase] = await mig`SELECT metadata FROM audit_events WHERE entity_type='demo_purchase' AND entity_id=${r.reservation.orderId} AND action='demo.purchase_confirmed'`;
    const [payment] = await mig`SELECT metadata FROM audit_events WHERE entity_type='demo_payment' AND entity_id=${r.reservation.orderId} AND action='demo.payment_simulated'`;
    expect(purchase.metadata).toMatchObject({ simulation: true, raffleId, orderId: r.reservation.orderId, itemCount: 2, amountCents: 3000 });
    expect(purchase.metadata.items.every((item: { participantId: string | null; folio: number | null; sellerId: string | null }) => item.participantId && item.folio === null && item.sellerId === null)).toBe(true);
    expect(payment.metadata).toMatchObject({ simulation: true, state: "paid_fictional", raffleId, orderId: r.reservation.orderId, amountCents: 3000 });
    const receipt = await rcpt.getReceiptData(db, r.token);
    expect(receipt.simulationPaidAt).toBeInstanceOf(Date);
    const publicView = await rcpt.getVerification(db, receipt.verificationCode);
    expect(publicView?.simulationPaidAt).toBeInstanceOf(Date);
    expect(JSON.stringify(publicView)).not.toContain("Participante");
  });

  it("verificacion publica: activa, vencida y liberada, sin datos personales", async () => {
    const r = await reserve(["010", "011"]);
    const d = await rcpt.getReceiptData(db, r.token);
    const v1 = await rcpt.getVerification(db, d.verificationCode);
    expect(v1).toMatchObject({ status: "pending", numbers: ["010", "011"] });
    expect(JSON.stringify(v1)).not.toContain(buyer.email);
    expect(JSON.stringify(v1)).not.toContain(r.token);

    await mig`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id = ${r.reservation.orderId}`;
    expect((await rcpt.getVerification(db, d.verificationCode))?.status).toBe("expired");

    const r2 = await reserve(["020"]);
    const d2 = await rcpt.getReceiptData(db, r2.token);
    await svc.releaseReservation(db, r2.token);
    const v2 = await rcpt.getVerification(db, d2.verificationCode);
    expect(v2?.status).toBe("cancelled");
    expect(v2?.numbers).toEqual(["020"]);
    // Tras liberar, el comprobante sigue mostrando los mismos numeros.
    expect((await rcpt.getReceiptData(db, r2.token)).numbers).toEqual(["020"]);
  });

  it("descargas repetidas del PDF no alteran pedidos, numeros, QR ni estado", async () => {
    const r = await reserve(["040", "041"]);
    const snap = async () => ({
      orders: (await mig`SELECT count(*)::int n FROM orders WHERE organization_id = ${orgId}`)[0].n,
      items: (await mig`SELECT count(*)::int n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.organization_id = ${orgId}`)[0].n,
      order: (await mig`SELECT status, verification_hash, receipt_issued_at, expires_at FROM orders WHERE id = ${r.reservation.orderId}`)[0],
      nums: await mig`SELECT number, status, reserved_until FROM raffle_numbers WHERE raffle_id = ${raffleId} AND number IN ('040','041') ORDER BY number`,
      sold: (await mig`SELECT count(*)::int n FROM raffle_numbers WHERE raffle_id = ${raffleId} AND status='sold'`)[0].n,
    });
    const first = await rcpt.getReceiptData(db, r.token);
    const qr0 = await decodeQr(await pdfm.buildReceiptPdf(first, "https://example.test"));
    const before = await snap();
    for (let i = 0; i < 15; i++) {
      const d = await rcpt.getReceiptData(db, r.token);
      expect(await decodeQr(await pdfm.buildReceiptPdf(d, "https://example.test"))).toBe(qr0);
    }
    expect(await snap()).toEqual(before);
    expect(before.sold).toBe(0);
  }, 60_000);

  it("codigos y tokens invalidos o inexistentes", async () => {
    expect(await rcpt.getVerification(db, "corto")).toBeNull();
    expect(await rcpt.getVerification(db, ver.deriveVerificationCode(randomUUID(), SECRET))).toBeNull();
    await expect(rcpt.getReceiptData(db, "no-valido")).rejects.toMatchObject({ code: "not_found" });
    await expect(rcpt.getReceiptData(db, key())).rejects.toMatchObject({ code: "not_found" });
  });

  it("los pedidos demo nunca pasan a vendido ni se confirman", async () => {
    const r = await reserve(["030"]);
    await expect(
      mig`UPDATE raffle_numbers SET status='sold' WHERE raffle_id=${raffleId} AND number='030'`,
    ).rejects.toThrow();
    await expect(
      mig`UPDATE orders SET status='confirmed' WHERE id=${r.reservation.orderId}`,
    ).rejects.toThrow();
    const [{ sold }] = await mig`SELECT count(*)::int sold FROM raffle_numbers WHERE raffle_id = ${raffleId} AND status='sold'`;
    expect(sold).toBe(0);
  });
});
