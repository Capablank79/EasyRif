import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Autenticación contra PostgreSQL real (easyrif_dev) usando la configuración de
 * Better Auth de la aplicación y el rol de aplicación. Se omite sin credenciales.
 * Los usuarios de prueba usan el dominio reservado .invalid y se eliminan al final.
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
const SECRET = process.env.BETTER_AUTH_SECRET ?? local.BETTER_AUTH_SECRET;
const enabled = Boolean(APP && MIGRATOR && SECRET);

describe.skipIf(!enabled)("Autenticación (PostgreSQL real)", () => {
  const tag = randomUUID().slice(0, 8);
  const pwd = "Clave-de-prueba-" + tag;
  const emailA = `auth-a-${tag}@example.invalid`;
  const emailB = `auth-b-${tag}@example.invalid`;
  let mig: postgres.Sql;
  let auth: ReturnType<typeof import("@/platform/auth").getAuth>;
  let db: ReturnType<typeof import("@/platform/db/client").getDb>;
  let orgs: typeof import("@/modules/organizations");

  const userId = async (email: string) =>
    (await mig`SELECT id FROM users WHERE email = ${email}`)[0]?.id as string | undefined;

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    process.env.BETTER_AUTH_SECRET = SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    mig = postgres(MIGRATOR!, { max: 2, onnotice: () => {} });
    auth = (await import("@/platform/auth")).getAuth();
    db = (await import("@/platform/db/client")).getDb();
    orgs = await import("@/modules/organizations");
  });

  afterAll(async () => {
    for (const email of [emailA, emailB]) {
      const id = await userId(email);
      if (!id) continue;
      const mine = await mig`SELECT organization_id FROM organization_members WHERE user_id = ${id}`;
      for (const m of mine) {
        await mig`DELETE FROM organizations WHERE id = ${m.organization_id}`.catch(() => {});
      }
      await mig`DELETE FROM users WHERE id = ${id}`.catch(() => {});
    }
    await mig.end();
  });

  it("registro: crea usuario, hash Argon2id, organización y propietario", async () => {
    await auth.api.signUpEmail({ body: { name: "Ana Prueba", email: emailA.toUpperCase(), password: pwd } });
    const id = await userId(emailA);
    expect(id).toBeTruthy();
    const [acc] = await mig`SELECT password FROM auth_accounts WHERE user_id = ${id!}`;
    expect(acc.password).toMatch(/^\$argon2id\$/);
    expect(acc.password).not.toContain(pwd);
    const list = await orgs.listUserOrganizations(db, id!);
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe("owner");
    const audit = await mig`SELECT action FROM audit_events WHERE actor_id = ${id!}`;
    expect(audit.map((a) => a.action)).toContain("organization.created");
  });

  it("registro duplicado y contraseña corta son rechazados", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "Otra", email: emailA, password: pwd } }),
    ).rejects.toThrow();
    await expect(
      auth.api.signUpEmail({ body: { name: "Corta", email: `x-${tag}@example.invalid`, password: "corta" } }),
    ).rejects.toThrow();
    expect(await userId(`x-${tag}@example.invalid`)).toBeUndefined();
    const dup = await mig`SELECT count(*)::int AS n FROM users WHERE email = ${emailA}`;
    expect(dup[0].n).toBe(1);
  });

  it("login: credenciales inválidas fallan; válidas crean sesión en PostgreSQL", async () => {
    await expect(auth.api.signInEmail({ body: { email: emailA, password: "incorrecta-123456" } })).rejects.toThrow();
    await expect(auth.api.signInEmail({ body: { email: `no-${tag}@example.invalid`, password: pwd } })).rejects.toThrow();
    const res = await auth.api.signInEmail({ body: { email: emailA, password: pwd }, asResponse: true });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const id = await userId(emailA);
    const sessions = await mig`SELECT id, expires_at FROM auth_sessions WHERE user_id = ${id!}`;
    expect(sessions.length).toBeGreaterThan(0);

    const headers = new Headers({ cookie: cookie.split(";")[0] });
    const session = await auth.api.getSession({ headers });
    expect(session?.user.email).toBe(emailA);

    await auth.api.signOut({ headers });
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("aislamiento: un usuario no ve ni obtiene rol en organizaciones ajenas", async () => {
    await auth.api.signUpEmail({ body: { name: "Beto Prueba", email: emailB, password: pwd } });
    const a = (await userId(emailA))!;
    const b = (await userId(emailB))!;
    const [orgA] = await orgs.listUserOrganizations(db, a);
    const [orgB] = await orgs.listUserOrganizations(db, b);
    expect(orgA.id).not.toBe(orgB.id);
    expect(await orgs.getActiveRole(db, a, orgB.id)).toBeNull();
    expect(await orgs.getActiveRole(db, b, orgA.id)).toBeNull();
    await expect(orgs.requireOrgPermission(db, a, orgB.id, "raffle:read")).rejects.toThrow();
    expect((await orgs.listUserOrganizations(db, a)).map((o) => o.id)).not.toContain(orgB.id);
  });

  it("aprovisionamiento idempotente y seguro ante concurrencia", async () => {
    const a = (await userId(emailA))!;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => orgs.ensureDefaultOrganization(db, a, "Ana")),
    );
    expect(results.every((r) => !r.created)).toBe(true);
    expect(await orgs.listUserOrganizations(db, a)).toHaveLength(1);
  });
});
