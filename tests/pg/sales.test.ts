import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { campaignScheduleForDate, utcToZonedDateInput } from "@/modules/raffles/campaign";

let local: Record<string, string | undefined> = {};
try { local = parseEnv(readFileSync(path.resolve(import.meta.dirname, "..", "..", ".env.local"), "utf8").replace(/^\uFEFF/, "")); } catch { /* no .env.local */ }
const APP = process.env.DATABASE_URL ?? local.DATABASE_URL;
const MIGRATOR = process.env.DATABASE_URL_MIGRATOR ?? local.DATABASE_URL_MIGRATOR;
const enabled = Boolean(APP && MIGRATOR);

describe.skipIf(!enabled)("Centro de ventas (PostgreSQL real)", () => {
  const tag = randomUUID().slice(0, 8);
  const secret = `test-secret-sales-${tag}-0000000000`;
  let mig: postgres.Sql;
  let db: ReturnType<typeof import("@/platform/db/client").getDb>;
  let rsvc: typeof import("@/modules/raffles/service");
  let csvc: typeof import("@/modules/campaigns/service");
  let osvc: typeof import("@/modules/orders/sales-service");
  let rsv: typeof import("@/modules/reservations/service");
  let receipts: typeof import("@/modules/receipts/service");
  let ownerId = "";
  let viewerId = "";
  let outsiderId = "";
  let orgId = "";
  let raffleId = "";
  let slug = "";
  let sellerToken = "";
  const buyer = { name: "Comprador de Ventas", email: `comprador-${tag}@example.invalid` };
  const key = () => randomBytes(18).toString("base64url");
  const reserve = (numbers: string[], seller?: string) => rsv.reserveNumbers(db, {
    slug, numbers, requestKey: key(), buyer, sellerToken: seller,
    participants: Object.fromEntries(numbers.map((n, i) => [n, { name: `Persona ${i + 1}`, email: `persona${i}-${tag}@example.invalid` }])),
    consent: true,
  }, { ttlMinutes: 10, maxSelection: 5 }, secret);

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    process.env.BETTER_AUTH_SECRET = secret;
    mig = postgres(MIGRATOR!, { max: 2, onnotice: () => {} });
    db = (await import("@/platform/db/client")).getDb();
    rsvc = await import("@/modules/raffles/service");
    csvc = await import("@/modules/campaigns/service");
    osvc = await import("@/modules/orders/sales-service");
    rsv = await import("@/modules/reservations/service");
    receipts = await import("@/modules/receipts/service");
    [{ id: ownerId }] = await mig`INSERT INTO users (email, display_name) VALUES (${`owner-${tag}@example.invalid`}, 'Owner') RETURNING id`;
    [{ id: viewerId }] = await mig`INSERT INTO users (email, display_name) VALUES (${`viewer-${tag}@example.invalid`}, 'Viewer') RETURNING id`;
    [{ id: outsiderId }] = await mig`INSERT INTO users (email, display_name) VALUES (${`outsider-${tag}@example.invalid`}, 'Outsider') RETURNING id`;
    [{ id: orgId }] = await mig`INSERT INTO organizations (name) VALUES (${`Org Sales ${tag}`}) RETURNING id`;
    await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${orgId}, ${ownerId}, 'owner', 'active'), (${orgId}, ${viewerId}, 'viewer', 'active')`;
    const date = utcToZonedDateInput(new Date(Date.now() + 20 * 86_400_000), "America/Santiago");
    const schedule = campaignScheduleForDate(date, "America/Santiago")!;
    const created = await rsvc.createRaffle(db, ownerId, orgId, {
      title: `Ventas ${tag}`, description: null, priceMinor: 1500, currency: "CLP", numberCount: 4,
      numbering: "booklets", bookletCount: 2, numbersPerBooklet: 2, firstFolio: 1,
      drawDate: schedule.drawAt, salesClosesAt: schedule.salesClosesAt, drawAt: schedule.drawAt,
    });
    raffleId = created.id;
    slug = created.slug;
    await rsvc.addPrize(db, ownerId, raffleId, { title: "Premio", description: null });
    await rsvc.generateNumbers(db, ownerId, raffleId);
    const seller = await csvc.createSeller(db, ownerId, raffleId, "Responsable Demo");
    sellerToken = csvc.deriveSellerToken(seller.id, secret);
    await csvc.assignBooklets(db, ownerId, raffleId, seller.id, [1]);
    await rsvc.publishRaffle(db, ownerId, raffleId);
  });

  afterAll(async () => {
    if (orgId) {
      await mig`DELETE FROM orders WHERE organization_id = ${orgId}`;
      await mig`DELETE FROM buyer_contacts WHERE organization_id = ${orgId}`;
      await mig`ALTER TABLE booklet_assignments DISABLE TRIGGER booklet_assignments_guard`;
      await mig`DELETE FROM booklet_assignments WHERE organization_id = ${orgId}`;
      await mig`ALTER TABLE booklet_assignments ENABLE TRIGGER booklet_assignments_guard`;
      await mig`DELETE FROM sellers WHERE organization_id = ${orgId}`;
      await mig`DELETE FROM raffles WHERE organization_id = ${orgId}`;
      await mig`DELETE FROM organizations WHERE id = ${orgId}`;
    }
    await mig`DELETE FROM users WHERE email LIKE ${`%-${tag}@example.invalid`}`;
    await mig.end();
  });

  it("separa reservas, ventas DEMO y reales; agrega responsables y filtra operaciones", async () => {
    const sold = await reserve(["T0001N01", "T0001N02"], sellerToken);
    await rsv.confirmSimulatedPurchase(db, sold.token);
    await receipts.getReceiptData(db, sold.token);
    await reserve(["T0002N01"]);

    const all = await osvc.getSalesDashboard(db, ownerId, raffleId, osvc.parseSalesFilters({}));
    expect(all.metrics).toMatchObject({
      totalNumbers: 4, soldDemoNumbers: 2, soldRealNumbers: 0,
      confirmedDemoOperations: 1, confirmedRealOperations: 0,
      simulatedIncomeCents: 3000, realIncomeCents: 0,
      activeReservations: 1, availableNumbers: 1,
    });
    expect(all.operations).toHaveLength(2);
    expect(all.operations.map((op) => op.state).sort()).toEqual(["reserved", "sold_demo"]);
    expect(all.operations.find((op) => op.state === "reserved")?.quantity).toBe(1);
    expect(all.operations.find((op) => op.state === "sold_demo")?.receiptAvailable).toBe(true);
    expect(all.sellers).toMatchObject([{ name: "Responsable Demo", assignedBooklets: 1, soldNumbers: 2, simulatedIncomeCents: 3000, realIncomeCents: 0 }]);

    const filtered = await osvc.getSalesDashboard(db, ownerId, raffleId, osvc.parseSalesFilters({ folio: "1", number: "T0001N01", state: "sold_demo" }));
    expect(filtered.totalOperations).toBe(1);
    expect(filtered.operations[0].numbers).toEqual(["T-0001 / N-01", "T-0001 / N-02"]);
  });

  it("aplica permisos a participantes, responsables, auditoría y descarga PDF", async () => {
    const [order] = await mig`SELECT id FROM orders WHERE raffle_id = ${raffleId} AND status = 'pending' ORDER BY created_at LIMIT 1`;
    const owner = await osvc.getSaleOperationDetail(db, ownerId, raffleId, order.id);
    expect(owner.canSeeBuyers).toBe(true);
    expect(owner.canSeeAudit).toBe(true);
    expect(owner.buyer?.name).toBe(buyer.name);
    expect(owner.items.every((item) => item.participant?.name.startsWith("Persona"))).toBe(true);
    expect(owner.trace.map((event) => event.action)).toEqual(["demo.purchase_confirmed", "demo.payment_simulated"]);
    const receipt = await osvc.getExistingSalesReceipt(db, ownerId, raffleId, order.id);
    expect(receipt.verificationCode).toHaveLength(43);

    const viewer = await osvc.getSaleOperationDetail(db, viewerId, raffleId, order.id);
    expect(viewer.buyer).toBeNull();
    expect(viewer.items.every((item) => item.participant === null)).toBe(true);
    expect(viewer.trace).toEqual([]);
    const dashboard = await osvc.getSalesDashboard(db, viewerId, raffleId, osvc.parseSalesFilters({}));
    expect(dashboard.sellers).toEqual([]);
    expect(dashboard.operations.every((op) => op.responsible === null)).toBe(true);
    await expect(osvc.getExistingSalesReceipt(db, viewerId, raffleId, order.id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(osvc.getSalesDashboard(db, outsiderId, raffleId, osvc.parseSalesFilters({}))).rejects.toMatchObject({ code: "not_found" });
  });
});
