import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  AuthorizationError,
  ORG_ACTIONS,
  ORG_ROLES,
  assertCan,
  can,
  getActiveRole,
  isPlatformAdmin,
  requireOrgPermission,
} from "@/modules/organizations";
import { generateSequentialNumbers, normalizeRaffleNumber } from "@/modules/raffles";
import { recordAuditEvent, sanitizeAuditMetadata } from "@/platform/audit";
import { hashToken, generateSellerToken } from "@/platform/security/tokens";
import type { Database } from "@/platform/db/types";
import { createTestDb, F, seed, type TestClient } from "./db/harness";

describe("matriz de permisos", () => {
  it("sin rol no hay permisos", () => {
    for (const a of ORG_ACTIONS) expect(can(null, a)).toBe(false);
  });

  it("los roles son estrictamente jerárquicos", () => {
    for (let i = 0; i < ORG_ROLES.length - 1; i++) {
      const higher = ORG_ROLES[i];
      const lower = ORG_ROLES[i + 1];
      for (const a of ORG_ACTIONS) {
        if (can(lower, a)) expect(can(higher, a)).toBe(true);
      }
    }
  });

  it("casos críticos", () => {
    expect(can("viewer", "raffle:edit_draft")).toBe(false);
    expect(can("editor", "raffle:publish")).toBe(false);
    expect(can("editor", "buyers:read")).toBe(false);
    expect(can("admin", "members:manage")).toBe(false);
    expect(can("owner", "members:manage")).toBe(true);
  });

  it("assertCan lanza AuthorizationError", () => {
    expect(() => assertCan("viewer", "raffle:publish")).toThrow(AuthorizationError);
    expect(() => assertCan(null, "raffle:read")).toThrow(AuthorizationError);
    expect(() => assertCan("owner", "raffle:publish")).not.toThrow();
  });
});

describe("tokens de vendedor", () => {
  it("genera tokens distintos y el hash es sha256 hex", () => {
    const a = generateSellerToken();
    const b = generateSellerToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});

describe("saneado de auditoría", () => {
  it("redacta claves sensibles, también anidadas", () => {
    const out = sanitizeAuditMetadata({
      title: "ok",
      password: "x",
      nested: { apiKey: "k", list: [{ token: "t", n: 1 }] },
      bankAccount: "123",
    });
    expect(out).toEqual({
      title: "ok",
      password: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", list: [{ token: "[REDACTED]", n: 1 }] },
      bankAccount: "[REDACTED]",
    });
  });
});

describe("números de campaña", () => {
  it("normaliza y valida", () => {
    expect(normalizeRaffleNumber(" ab1 ")).toBe("AB1");
    expect(() => normalizeRaffleNumber("a b")).toThrow(RangeError);
    expect(() => normalizeRaffleNumber("")).toThrow(RangeError);
    expect(() => normalizeRaffleNumber("1".repeat(13))).toThrow(RangeError);
  });

  it("genera secuencias con ceros a la izquierda", () => {
    expect(generateSequentialNumbers(3)).toEqual(["1", "2", "3"]);
    const hundred = generateSequentialNumbers(100);
    expect(hundred[0]).toBe("001");
    expect(hundred[99]).toBe("100");
    expect(new Set(hundred).size).toBe(100);
    expect(() => generateSequentialNumbers(0)).toThrow(RangeError);
    expect(() => generateSequentialNumbers(1.5)).toThrow(RangeError);
  });
});

describe("autorización en servidor y auditoría (PGlite)", () => {
  let client: TestClient;
  let db: Database;

  beforeAll(async () => {
    const t = await createTestDb();
    client = t.client;
    db = t.db as unknown as Database;
    await seed(client);
  });
  afterAll(async () => {
    await client.close();
  });

  it("getActiveRole respeta membresía y estado", async () => {
    expect(await getActiveRole(db, F.editorA, F.orgA)).toBe("editor");
    expect(await getActiveRole(db, F.editorA, F.orgB)).toBeNull();
    expect(await getActiveRole(db, F.outsider, F.orgA)).toBeNull();
    await client.query(`UPDATE organization_members SET status='suspended' WHERE user_id=$1`, [F.viewerA]);
    expect(await getActiveRole(db, F.viewerA, F.orgA)).toBeNull();
    await client.query(`UPDATE organization_members SET status='active' WHERE user_id=$1`, [F.viewerA]);
  });

  it("requireOrgPermission lanza si no corresponde", async () => {
    await expect(requireOrgPermission(db, F.editorA, F.orgA, "raffle:publish")).rejects.toThrow(AuthorizationError);
    await expect(requireOrgPermission(db, F.ownerB, F.orgA, "raffle:read")).rejects.toThrow(AuthorizationError);
    await expect(requireOrgPermission(db, F.adminA, F.orgA, "raffle:publish")).resolves.toBe("admin");
  });

  it("isPlatformAdmin es independiente de los roles de organización", async () => {
    expect(await isPlatformAdmin(db, F.ownerA)).toBe(false);
    await client.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [F.outsider]);
    expect(await isPlatformAdmin(db, F.outsider)).toBe(true);
    expect(await getActiveRole(db, F.outsider, F.orgA)).toBeNull();
  });

  it("recordAuditEvent guarda metadata saneada y el evento es inmutable", async () => {
    await recordAuditEvent(db, {
      organizationId: F.orgA,
      actorId: F.adminA,
      entityType: "raffle",
      entityId: F.raffleAPub,
      action: "TEST_ACTION",
      metadata: { title: "x", token: "secreto" },
    });
    const r = await db.execute(
      sql`SELECT metadata FROM audit_events WHERE action='TEST_ACTION'`,
    );
    const row = (r as unknown as { rows: { metadata: Record<string, unknown> }[] }).rows[0];
    expect(row.metadata).toEqual({ title: "x", token: "[REDACTED]" });
    await expect(client.query(`UPDATE audit_events SET action='X' WHERE action='TEST_ACTION'`)).rejects.toThrow();
    await expect(client.query(`DELETE FROM audit_events WHERE action='TEST_ACTION'`)).rejects.toThrow();
  });
});
