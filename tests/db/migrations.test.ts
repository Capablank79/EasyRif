import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/platform/db/schema";
import { createTestDb, type TestClient } from "./harness";

let client: TestClient;
const rows = async (sql: string) =>
  (await client.query(sql)).rows as Record<string, unknown>[];

beforeAll(async () => {
  ({ client } = await createTestDb());
});
afterAll(async () => {
  await client.close();
});

const drizzleDir = path.resolve(import.meta.dirname, "..", "..", "drizzle");

describe("migraciones", () => {
  it("el journal coincide con los archivos .sql", () => {
    const journal = JSON.parse(
      readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
    expect(journal.entries.map((e) => e.tag).sort()).toEqual(files);
  });

  it("se aplican completas sobre una base vacía", async () => {
    const t = await rows(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`,
    );
    expect(t[0].n).toBe(24);
  });

  it("el esquema Drizzle coincide con las tablas reales (sin deriva)", async () => {
    const declared = (Object.values(schema) as unknown[])
      .filter((v): v is PgTable => is(v as object, PgTable))
      .map((v) => getTableConfig(v).name)
      .sort();
    const actual = (
      await rows(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)
    ).map((r) => r.tablename);
    expect(declared).toEqual(actual);
  });
});

describe("postura de seguridad", () => {
  it("no hay roles ni esquemas de plataformas externas", async () => {
    const s = await rows(
      `SELECT nspname FROM pg_namespace WHERE nspname IN ('auth','storage')`,
    );
    expect(s).toEqual([]);
  });

  it("RLS no está activada: el aislamiento se aplica en servidor (documentado)", async () => {
    const r = await rows(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity`,
    );
    expect(r).toEqual([]);
  });
});
