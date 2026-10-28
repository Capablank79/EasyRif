import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/platform/db/schema";

/*
 * Entorno de pruebas: PostgreSQL embebido (PGlite) en memoria, con las migraciones
 * reales. No sustituye una prueba contra un servidor PostgreSQL real.
 * Todos los datos son fixtures de test, no datos reales.
 */

const root = path.resolve(import.meta.dirname, "..", "..");

export async function createTestDb() {
  const client = new PGlite();
  const journal = JSON.parse(
    readFileSync(path.join(root, "drizzle", "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    const sql = readFileSync(path.join(root, "drizzle", `${tag}.sql`), "utf8");
    await client.exec(sql);
  }
  return { client, db: drizzle(client, { schema }) };
}

export type TestClient = PGlite;

export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Ids fijos de los fixtures. */
export const F = {
  ownerA: id(1),
  adminA: id(2),
  editorA: id(3),
  viewerA: id(4),
  ownerB: id(5),
  outsider: id(6),
  orgA: id(101),
  orgB: id(102),
  raffleADraft: id(201),
  raffleAPub: id(202),
  raffleBPub: id(203),
  prizeA: id(301),
  productA: id(401),
  productB: id(402),
  numA1: id(501),
  numA2: id(502),
  numB1: id(503),
  buyerA: id(601),
  sellerA: id(701),
  hashA: "a".repeat(64),
} as const;

/** Dos organizaciones aisladas con usuarios por rol, campañas y números de prueba. */
export async function seed(client: PGlite) {
  const u = [F.ownerA, F.adminA, F.editorA, F.viewerA, F.ownerB, F.outsider];
  for (const [i, uid] of u.entries()) {
    await client.query(
      `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
      [uid, `test${i + 1}@example.invalid`, `TEST usuario ${i + 1}`],
    );
  }
  await client.query(
    `INSERT INTO organizations (id, name, type) VALUES ($1,'TEST Org A','individual'), ($2,'TEST Org B','individual')`,
    [F.orgA, F.orgB],
  );
  const members: [string, string, string][] = [
    [F.orgA, F.ownerA, "owner"],
    [F.orgA, F.adminA, "admin"],
    [F.orgA, F.editorA, "editor"],
    [F.orgA, F.viewerA, "viewer"],
    [F.orgB, F.ownerB, "owner"],
  ];
  for (const [o, user, role] of members) {
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)`,
      [o, user, role],
    );
  }
  const raffle = (rid: string, org: string, slug: string, status: string) =>
    client.query(
      `INSERT INTO raffles (id, organization_id, slug, title, status, number_count, price_cents)
       VALUES ($1,$2,$3,'TEST campaña',$4,100,1000)`,
      [rid, org, slug, status],
    );
  await raffle(F.raffleADraft, F.orgA, "test-a-borrador", "draft");
  await raffle(F.raffleAPub, F.orgA, "test-a-publicada", "published");
  await raffle(F.raffleBPub, F.orgB, "test-b-publicada", "published");
  await client.query(
    `INSERT INTO prizes (id, raffle_id, organization_id, title, position) VALUES ($1,$2,$3,'TEST premio',1)`,
    [F.prizeA, F.raffleAPub, F.orgA],
  );
  await client.query(
    `INSERT INTO digital_products (id, raffle_id, organization_id, name) VALUES
      ($1,$2,$3,'TEST producto A'), ($4,$5,$6,'TEST producto B')`,
    [F.productA, F.raffleAPub, F.orgA, F.productB, F.raffleBPub, F.orgB],
  );
  await client.query(
    `INSERT INTO raffle_numbers (id, raffle_id, organization_id, number) VALUES
      ($1,$2,$3,'001'), ($4,$2,$3,'002'), ($5,$6,$7,'001')`,
    [F.numA1, F.raffleAPub, F.orgA, F.numA2, F.numB1, F.raffleBPub, F.orgB],
  );
  await client.query(
    `INSERT INTO buyer_contacts (id, organization_id, name, email) VALUES ($1,$2,'TEST comprador','test@example.invalid')`,
    [F.buyerA, F.orgA],
  );
  await client.query(
    `INSERT INTO sellers (id, organization_id, raffle_id, display_name, token_hash) VALUES ($1,$2,$3,'TEST vendedor',$4)`,
    [F.sellerA, F.orgA, F.raffleAPub, F.hashA],
  );
}
