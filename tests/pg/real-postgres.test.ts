import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Pruebas contra un PostgreSQL REAL (easyrif_dev). Se omiten si no hay credenciales
 * en .env.local; en ese caso NO cuentan como verificación. Los datos de prueba llevan
 * un prefijo único y se eliminan al terminar.
 */
let local: Record<string, string | undefined> = {};
try {
  local = parseEnv(
    readFileSync(path.resolve(import.meta.dirname, "..", "..", ".env.local"), "utf8"),
  );
} catch {
  /* sin .env.local */
}
const MIGRATOR = process.env.DATABASE_URL_MIGRATOR ?? local.DATABASE_URL_MIGRATOR;
const APP = process.env.DATABASE_URL ?? local.DATABASE_URL;
const enabled = Boolean(MIGRATOR && APP);

describe.skipIf(!enabled)("PostgreSQL real", () => {
  let mig: postgres.Sql;
  let app: postgres.Sql;
  const tag = randomUUID().slice(0, 8);
  const org = randomUUID();
  const org2 = randomUUID();
  const user = randomUUID();
  const raffle = randomUUID();
  const numbers = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    mig = postgres(MIGRATOR!, { max: 2, onnotice: () => {} });
    app = postgres(APP!, { max: 12, onnotice: () => {} });
    await app`INSERT INTO users (id, email) VALUES (${user}, ${`pg-${tag}@example.invalid`})`;
    await app`INSERT INTO organizations (id, name) VALUES (${org}, ${"TEST A " + tag}), (${org2}, ${"TEST B " + tag})`;
    await app`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${org}, ${user}, 'owner')`;
    await app`INSERT INTO raffles (id, organization_id, slug, title, status, number_count, price_cents)
              VALUES (${raffle}, ${org}, ${"test-pg-" + tag}, 'TEST', 'published', 10, 1000)`;
    await app`INSERT INTO raffle_numbers (id, raffle_id, organization_id, number)
              VALUES (${numbers[0]}, ${raffle}, ${org}, '001'), (${numbers[1]}, ${raffle}, ${org}, '002')`;
  });

  afterAll(async () => {
    await mig`DELETE FROM orders WHERE raffle_id = ${raffle}`;
    await mig`DELETE FROM raffles WHERE id = ${raffle}`;
    // El trigger de propietario único no aplica si la organización ya no existe; se borra la org primero.
    await mig`DELETE FROM organizations WHERE id IN (${org}, ${org2})`.catch(() => {});
    await mig`DELETE FROM users WHERE id = ${user}`.catch(() => {});
    await app.end();
    await mig.end();
  });

  it("es PostgreSQL 18 con las 24 tablas", async () => {
    const [v] = await mig`SHOW server_version_num`;
    expect(Number(v.server_version_num)).toBeGreaterThanOrEqual(180000);
    const [t] = await mig`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`;
    expect(t.n).toBe(24);
  });

  it("existen triggers, claves foráneas e índices esperados", async () => {
    const [tr] = await mig`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal`;
    expect(tr.n).toBe(43);
    const [fk] = await mig`SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f'`;
    expect(fk.n).toBeGreaterThanOrEqual(25);
    const [ix] = await mig`SELECT count(*)::int AS n FROM pg_indexes WHERE indexname='order_items_number_held_uq'`;
    expect(ix.n).toBe(1);
  });

  it("los roles no son superusuario ni saltan RLS", async () => {
    const r = await mig`SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname IN ('easyrif_app','easyrif_migrator')`;
    expect(r).toHaveLength(2);
    for (const x of r) {
      expect([x.rolsuper, x.rolbypassrls, x.rolcreatedb, x.rolcreaterole]).toEqual([false, false, false, false]);
    }
  });

  it("el rol de aplicación no es propietario de tablas ni puede alterarlas", async () => {
    const [o] = await mig`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tableowner='easyrif_app'`;
    expect(o.n).toBe(0);
    await expect(app.unsafe(`ALTER TABLE raffles DISABLE TRIGGER ALL`)).rejects.toThrow(/propietario|owner|dueño/i);
    await expect(app.unsafe(`DROP TRIGGER audit_events_no_update ON audit_events`)).rejects.toThrow(/propietario|owner|dueño/i);
    await expect(app.unsafe(`TRUNCATE raffles`)).rejects.toThrow(/permiso|permission/i);
    await expect(app.unsafe(`CREATE TABLE public.x_tmp (a int)`)).rejects.toThrow(/permiso|permission/i);
  });

  it("el rol de aplicación no puede modificar la auditoría histórica", async () => {
    await expect(app.unsafe(`UPDATE audit_events SET action='x'`)).rejects.toThrow(/permiso|permission/i);
    await expect(app.unsafe(`DELETE FROM audit_events`)).rejects.toThrow(/permiso|permission/i);
    await expect(app.unsafe(`TRUNCATE audit_events`)).rejects.toThrow(/permiso|permission/i);
    await expect(app.unsafe(`SELECT 1 FROM drizzle.__drizzle_migrations`)).rejects.toThrow(/permiso|permission/i);
  });

  it("rechaza número duplicado y claves compuestas cruzadas entre organizaciones", async () => {
    await expect(
      app`INSERT INTO raffle_numbers (raffle_id, organization_id, number) VALUES (${raffle}, ${org}, '001')`,
    ).rejects.toThrow(/raffle_numbers_raffle_number_uq/);
    await expect(
      app`INSERT INTO prizes (raffle_id, organization_id, title, position) VALUES (${raffle}, ${org2}, 'TEST', 1)`,
    ).rejects.toThrow(/prizes_raffle_org_fk/);
  });

  it("la transacción fallida revierte por completo (atomicidad)", async () => {
    const slug = "test-pg-rollback-" + tag;
    await expect(
      app.begin(async (tx) => {
        await tx`INSERT INTO raffles (organization_id, slug, title, number_count, price_cents) VALUES (${org}, ${slug}, 'TEST', 1, 0)`;
        await tx`INSERT INTO raffles (organization_id, slug, title, number_count, price_cents) VALUES (${org}, ${slug}, 'TEST', 1, 0)`;
      }),
    ).rejects.toThrow(/raffles_slug_uq/);
    const [c] = await app`SELECT count(*)::int AS n FROM raffles WHERE slug = ${slug}`;
    expect(c.n).toBe(0);
  });

  it("concurrencia: 10 pedidos simultáneos sobre un número, solo uno lo retiene", async () => {
    const attempt = () =>
      app.begin(async (tx) => {
        const [o] = await tx`INSERT INTO orders (raffle_id, organization_id, status) VALUES (${raffle}, ${org}, 'pending') RETURNING id`;
        await tx`INSERT INTO order_items (order_id, raffle_id, organization_id, raffle_number_id, price_cents)
                 VALUES (${o.id}, ${raffle}, ${org}, ${numbers[0]}, 1000)`;
      });
    const results = await Promise.allSettled(Array.from({ length: 10 }, attempt));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect(String((r as PromiseRejectedResult).reason.message)).toMatch(/order_items_number_held_uq/);
    }
    const [h] = await app`SELECT count(*)::int AS n FROM order_items WHERE raffle_number_id=${numbers[0]} AND holds_number`;
    expect(h.n).toBe(1);
  });

  it("triggers: último propietario protegido y organization_id inmutable", async () => {
    await expect(
      app`UPDATE organization_members SET role='viewer' WHERE organization_id=${org} AND user_id=${user}`,
    ).rejects.toThrow(/al menos un propietario/);
    await expect(app`UPDATE raffles SET organization_id=${org2} WHERE id=${raffle}`).rejects.toThrow(/inmutable/);
  });
});
