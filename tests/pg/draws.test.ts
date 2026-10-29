import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/* Simulación de sorteos (BUILD-009) contra PostgreSQL real. Datos .invalid, limpiados al final. */
let local: Record<string, string | undefined> = {};
try {
  local = parseEnv(readFileSync(path.resolve(import.meta.dirname, "..", "..", ".env.local"), "utf8").replace(/^\uFEFF/, ""));
} catch {
  /* sin .env.local */
}
const APP = process.env.DATABASE_URL ?? local.DATABASE_URL;
const MIGRATOR = process.env.DATABASE_URL_MIGRATOR ?? local.DATABASE_URL_MIGRATOR;
const enabled = Boolean(APP && MIGRATOR);

describe.skipIf(!enabled)("Simulación de sorteos (PostgreSQL real)", () => {
  const tag = randomUUID().slice(0, 8);
  let mig: postgres.Sql;
  let rsvc: typeof import("@/modules/raffles/service");
  let draws: typeof import("@/modules/drawings/service");
  let db: ReturnType<typeof import("@/platform/db/client").getDb>;
  const ids = { owner: "", admin: "", editor: "", viewer: "", other: "", outsider: "" };
  let orgId = "";
  let otherOrgId = "";
  let raffleId = "";
  let otherRaffleId = "";
  let realBefore: { slug: string; nums: number; ords: number }[] = [];
  const key = () => randomUUID();
  const base = { description: null, priceMinor: 1500, currency: "CLP" as const, drawDate: null };
  const day = 86_400_000;
  const cfg = { source: "raffle_config" as const };
  const synth = { source: "synthetic" as const, synthetic: { bookletCount: 10, numbersPerBooklet: 20, prizeCount: 3 } };
  const snapshotCounts = async (rid: string) => {
    const [a] = await mig`SELECT
      (SELECT count(*)::int FROM raffle_numbers WHERE raffle_id = ${rid}) nums,
      (SELECT count(*)::int FROM raffle_numbers WHERE raffle_id = ${rid} AND status <> 'available') used,
      (SELECT count(*)::int FROM orders WHERE raffle_id = ${rid}) ords,
      (SELECT count(*)::int FROM drawings WHERE raffle_id = ${rid}) dr,
      (SELECT count(*)::int FROM winners WHERE raffle_id = ${rid}) wi`;
    return a;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = APP;
    mig = postgres(MIGRATOR!, { max: 4, onnotice: () => {} });
    db = (await import("@/platform/db/client")).getDb();
    rsvc = await import("@/modules/raffles/service");
    draws = await import("@/modules/drawings/service");
    realBefore = await mig`SELECT r.slug, (SELECT count(*)::int FROM raffle_numbers n WHERE n.raffle_id = r.id) nums, (SELECT count(*)::int FROM orders o WHERE o.raffle_id = r.id) ords FROM raffles r WHERE r.slug IN ('miguelito','martin') ORDER BY r.slug` as never;
    for (const k of Object.keys(ids) as (keyof typeof ids)[]) {
      [{ id: ids[k] }] = await mig`INSERT INTO users (email, display_name) VALUES (${`${k}-${tag}@example.invalid`}, ${k}) RETURNING id`;
    }
    [{ id: orgId }] = await mig`INSERT INTO organizations (name) VALUES (${"Org Sorteos " + tag}) RETURNING id`;
    [{ id: otherOrgId }] = await mig`INSERT INTO organizations (name) VALUES (${"Org Otra " + tag}) RETURNING id`;
    for (const [k, role] of [["owner", "owner"], ["admin", "admin"], ["editor", "editor"], ["viewer", "viewer"]] as const) {
      await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${orgId}, ${ids[k]}, ${role}, 'active')`;
    }
    await mig`INSERT INTO organization_members (organization_id, user_id, role, status) VALUES (${otherOrgId}, ${ids.other}, 'owner', 'active')`;
    const mk = async (o: string, u: string, title: string) => {
      const r = await rsvc.createRaffle(db, u, o, {
        ...base,
        title,
        numberCount: 200,
        numbering: "booklets",
        bookletCount: 10,
        numbersPerBooklet: 20,
        firstFolio: 1,
        salesClosesAt: new Date(Date.now() + 30 * day),
        drawAt: new Date(Date.now() + 40 * day),
      });
      await rsvc.generateNumbers(db, u, r.id);
      for (const t of ["Primer premio", "Segundo premio", "Tercer premio"]) await rsvc.addPrize(db, u, r.id, { title: t, description: null });
      await rsvc.publishRaffle(db, u, r.id);
      return r;
    };
    raffleId = (await mk(orgId, ids.owner, `Sorteos ${tag}`)).id;
    otherRaffleId = (await mk(otherOrgId, ids.other, `Otra ${tag}`)).id;
  });

  afterAll(async () => {
    for (const o of [orgId, otherOrgId]) {
      if (!o) continue;
      await mig`DELETE FROM raffles WHERE organization_id = ${o}`;
      await mig`DELETE FROM organizations WHERE id = ${o}`;
    }
    await mig`DELETE FROM users WHERE email LIKE ${`%-${tag}@example.invalid`}`;
    await mig.end();
  });

  it("simulación con la configuración de la rifa: 10×20, 3 premios, persistida y auditada", async () => {
    const before = await snapshotCounts(raffleId);
    const { run, replay } = await draws.runDrawSimulation(db, ids.owner, raffleId, { ...cfg, idempotencyKey: key() });
    expect(replay).toBe(false);
    expect(run.totalEligible).toBe(200);
    expect(run.draws.map((d) => d.prizeTitle)).toEqual(["Primer premio", "Segundo premio", "Tercer premio"]);
    expect(new Set(run.draws.map((d) => `${d.folio}-${d.localNumber}`)).size).toBe(3);
    expect(run.draws.map((d) => d.eligibleBefore)).toEqual([200, 199, 198]);
    expect(run.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await mig`SELECT is_simulation, source, rules_version FROM simulation_runs WHERE id = ${run.id}`;
    expect(row).toMatchObject({ is_simulation: true, source: "raffle_config", rules_version: "9.0-weighted-two-stage" });
    const [{ n }] = await mig`SELECT count(*)::int n FROM audit_events WHERE entity_id = ${run.id} AND action = 'draw.simulated' AND organization_id = ${orgId}`;
    expect(n).toBe(1);
    // Sin efectos sobre ventas, reservas, pedidos ni resultados oficiales.
    expect(await snapshotCounts(raffleId)).toEqual(before);
  });

  it("rifa individual: sorteo simulado de una etapa sobre sus números, sin tocar ventas", async () => {
    const r = await rsvc.createRaffle(db, ids.owner, orgId, { ...base, title: `Individual ${tag}`, numberCount: 100 });
    await expect(draws.runDrawSimulation(db, ids.owner, r.id, { ...cfg, idempotencyKey: key() })).rejects.toMatchObject({ code: "invalid" });
    await rsvc.generateNumbers(db, ids.owner, r.id);
    for (const t of ["Premio A", "Premio B", "Premio C"]) await rsvc.addPrize(db, ids.owner, r.id, { title: t, description: null });
    const before = await snapshotCounts(r.id);
    const { run } = await draws.runDrawSimulation(db, ids.owner, r.id, { ...cfg, idempotencyKey: key() });
    expect(run.totalEligible).toBe(100);
    expect(run.draws.map((d) => d.eligibleBefore)).toEqual([100, 99, 98]);
    expect(run.draws.every((d) => d.folio === 1 && d.localNumber >= 1 && d.localNumber <= 100)).toBe(true);
    expect(new Set(run.draws.map((d) => d.localNumber)).size).toBe(3);
    expect(await snapshotCounts(r.id)).toEqual(before);
    // Los números ganadores existen en la rifa con el formato individual (ancho 3).
    const numbers = run.draws.map((d) => String(d.localNumber).padStart(3, "0"));
    const found = await mig`SELECT count(*)::int n FROM raffle_numbers WHERE raffle_id = ${r.id} AND number IN ${mig(numbers)}`;
    expect(found[0].n).toBe(3);
  });

  it("simulación sintética en una rifa cualquiera", async () => {
    const { run } = await draws.runDrawSimulation(db, ids.admin, raffleId, { ...synth, idempotencyKey: key() });
    expect(run.source).toBe("synthetic");
    expect(run.draws).toHaveLength(3);
    expect(run.draws[0].prizeTitle).toBe("Premio de ejemplo 1");
  });

  it("idempotencia: mismo identificador repetido y en paralelo crea una sola ejecución", async () => {
    const k = key();
    const res = await Promise.all(Array.from({ length: 12 }, () => draws.runDrawSimulation(db, ids.owner, raffleId, { ...synth, idempotencyKey: k })));
    expect(res.filter((r) => !r.replay)).toHaveLength(1);
    expect(new Set(res.map((r) => r.run.id)).size).toBe(1);
    const [{ r, d }] = await mig`SELECT (SELECT count(*)::int FROM simulation_runs WHERE idempotency_key = ${k}) r,
      (SELECT count(*)::int FROM simulation_draws WHERE run_id = ${res[0].run.id}) d`;
    expect([r, d]).toEqual([1, 3]);
  });

  it("concurrencia: ejecuciones distintas en paralelo son independientes y sin duplicados internos", async () => {
    const res = await Promise.all(Array.from({ length: 12 }, () => draws.runDrawSimulation(db, ids.owner, raffleId, { ...synth, idempotencyKey: key() })));
    expect(new Set(res.map((r) => r.run.id)).size).toBe(12);
    expect(new Set(res.map((r) => r.run.resultHash)).size).toBe(12);
    for (const { run } of res) {
      expect(run.draws).toHaveLength(3);
      expect(new Set(run.draws.map((d) => `${d.folio}-${d.localNumber}`)).size).toBe(3);
    }
  });

  it("permisos: viewer y editor no simulan; editor lee; ajeno y otra organización no ven nada", async () => {
    for (const u of [ids.viewer, ids.editor]) {
      await expect(draws.runDrawSimulation(db, u, raffleId, { ...synth, idempotencyKey: key() })).rejects.toMatchObject({ name: "AuthorizationError" });
    }
    const o = await draws.getSimulationOverview(db, ids.editor, raffleId);
    expect(o.canSimulate).toBe(false);
    await expect(draws.getSimulationOverview(db, ids.viewer, raffleId)).rejects.toMatchObject({ name: "AuthorizationError" });
    for (const u of [ids.other, ids.outsider]) {
      await expect(draws.getSimulationOverview(db, u, raffleId)).rejects.toMatchObject({ code: "not_found" });
      await expect(draws.runDrawSimulation(db, u, raffleId, { ...synth, idempotencyKey: key() })).rejects.toMatchObject({ code: "not_found" });
      await expect(draws.launchOfficialDraw(db, u, raffleId)).rejects.toMatchObject({ code: "not_found" });
    }
    // Una ejecución de otra organización no se consulta por identificador cruzado.
    const mine = (await draws.runDrawSimulation(db, ids.other, otherRaffleId, { ...synth, idempotencyKey: key() })).run;
    await expect(draws.getSimulationRun(db, ids.owner, raffleId, mine.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(draws.getSimulationRun(db, ids.owner, otherRaffleId, mine.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await draws.getSimulationOverview(db, ids.owner, raffleId)).runs.every((r) => r.id !== mine.id)).toBe(true);
  });

  it("entradas maliciosas o fuera de rango se rechazan sin crear filas", async () => {
    const [{ before }] = await mig`SELECT count(*)::int before FROM simulation_runs WHERE raffle_id = ${raffleId}`;
    const bad = [
      { ...synth, idempotencyKey: "no-es-uuid" },
      { ...synth, idempotencyKey: key(), synthetic: { bookletCount: 10, numbersPerBooklet: 20, prizeCount: 300 } },
      { ...synth, idempotencyKey: key(), synthetic: { bookletCount: 1, numbersPerBooklet: 2, prizeCount: 3 } },
      { ...synth, idempotencyKey: key(), synthetic: { bookletCount: NaN, numbersPerBooklet: 20, prizeCount: 3 } },
      { ...synth, idempotencyKey: key(), synthetic: { bookletCount: 1000, numbersPerBooklet: 9999, prizeCount: 3 } },
      { source: "synthetic" as const, idempotencyKey: key() },
      { source: "oficial" as never, idempotencyKey: key() },
    ];
    for (const o of bad) await expect(draws.runDrawSimulation(db, ids.owner, raffleId, o)).rejects.toMatchObject({ code: "invalid" });
    await expect(draws.runDrawSimulation(db, ids.owner, "not-a-uuid", { ...synth, idempotencyKey: key() })).rejects.toMatchObject({ code: "not_found" });
    const [{ after }] = await mig`SELECT count(*)::int after FROM simulation_runs WHERE raffle_id = ${raffleId}`;
    expect(after).toBe(before);
  });

  it("el RNG inyectable se rechaza en producción", async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      await expect(draws.runDrawSimulation(db, ids.owner, raffleId, { ...synth, idempotencyKey: key() }, { rng: () => 0 })).rejects.toThrow(/producción/);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
    }
  });

  it("restricciones de BD: inmutable, sin pares duplicados, sin marca de simulación falsa", async () => {
    const { run } = await draws.runDrawSimulation(db, ids.owner, raffleId, { ...synth, idempotencyKey: key() });
    await expect(mig`UPDATE simulation_runs SET result_hash = ${"0".repeat(64)} WHERE id = ${run.id}`).rejects.toThrow(/inmutables/);
    await expect(mig`UPDATE simulation_draws SET folio = 9 WHERE run_id = ${run.id}`).rejects.toThrow(/inmutables/);
    const d = run.draws[0];
    const dup = () => mig`INSERT INTO simulation_draws (run_id, raffle_id, organization_id, prize_position, prize_title, folio, local_number, eligible_before, folio_weight, folios_in_play, weights_before)
      VALUES (${run.id}, ${raffleId}, ${orgId}, ${99}, 'x', ${d.folio}, ${d.localNumber}, 10, 1, 1, '{}')`;
    await expect(dup()).rejects.toMatchObject({ code: "23505" });
    await expect(mig`INSERT INTO simulation_draws (run_id, raffle_id, organization_id, prize_position, prize_title, folio, local_number, eligible_before, folio_weight, folios_in_play, weights_before)
      VALUES (${run.id}, ${raffleId}, ${orgId}, ${d.prizePosition}, 'x', 77, 1, 10, 1, 1, '{}')`).rejects.toMatchObject({ code: "23505" });
    await expect(mig`INSERT INTO simulation_runs (raffle_id, organization_id, source, is_simulation, rules_version, idempotency_key, total_eligible, prize_count, snapshot, snapshot_hash, result_hash)
      VALUES (${raffleId}, ${orgId}, 'synthetic', false, 'x', ${key()}, 10, 1, '{}', ${"a".repeat(64)}, ${"b".repeat(64)})`).rejects.toMatchObject({ code: "23514" });
    // Una organización distinta no puede colgar ejecuciones de esta rifa (FK compuesta).
    await expect(mig`INSERT INTO simulation_runs (raffle_id, organization_id, source, rules_version, idempotency_key, total_eligible, prize_count, snapshot, snapshot_hash, result_hash)
      VALUES (${raffleId}, ${otherOrgId}, 'synthetic', 'x', ${key()}, 10, 1, '{}', ${"a".repeat(64)}, ${"b".repeat(64)})`).rejects.toMatchObject({ code: "23503" });
    // El rol de la aplicación no puede escribir en la simulación de otro modo que por el servicio, ni en winners oficiales vía este módulo.
    const [{ w }] = await mig`SELECT count(*)::int w FROM winners WHERE raffle_id = ${raffleId}`;
    expect(w).toBe(0);
  });

  it("sorteo oficial bloqueado en el servidor aunque todo figure vendido, y deja auditoría", async () => {
    await mig`UPDATE raffle_numbers SET status = 'simulated_sold' WHERE raffle_id = ${otherRaffleId}`;
    const o = await draws.getSimulationOverview(db, ids.other, otherRaffleId);
    expect(o.counts).toMatchObject({ total: 200, sold: 0, simulatedSold: 200 });
    expect(o.gate.enabled).toBe(false);
    await expect(draws.launchOfficialDraw(db, ids.other, otherRaffleId)).rejects.toMatchObject({ code: "blocked" });
    const [{ n }] = await mig`SELECT count(*)::int n FROM audit_events WHERE entity_id = ${otherRaffleId} AND action = 'draw.official_blocked'`;
    expect(n).toBe(1);
    // Las ventas ficticias de esta prueba no generan ganadores ni sorteos oficiales.
    const [{ d, w }] = await mig`SELECT (SELECT count(*)::int FROM drawings WHERE raffle_id = ${otherRaffleId}) d, (SELECT count(*)::int FROM winners WHERE raffle_id = ${otherRaffleId}) w`;
    expect([d, w]).toEqual([0, 0]);
  });

  it("el rol de la aplicación tampoco puede modificar el historial ni escribir resultados oficiales de forma indebida", async () => {
    const app = postgres(APP!, { max: 1, onnotice: () => {} });
    try {
      const { run } = await draws.runDrawSimulation(db, ids.owner, raffleId, { ...synth, idempotencyKey: key() });
      await expect(app`UPDATE simulation_draws SET folio = 5 WHERE run_id = ${run.id}`).rejects.toThrow(/inmutables/);
      await expect(app`UPDATE simulation_runs SET prize_count = 1 WHERE id = ${run.id}`).rejects.toThrow(/inmutables/);
      const hist = await draws.getSimulationOverview(db, ids.editor, raffleId);
      expect(hist.runs.some((r) => r.id === run.id)).toBe(true);
      const full = await draws.getSimulationRun(db, ids.editor, raffleId, run.id);
      expect(full).not.toBeNull();
      expect(full!.draws.map((d) => d.prizePosition)).toEqual([1, 2, 3]);
      expect(full!.draws.map((d) => d.eligibleBefore)).toEqual([200, 199, 198]);
    } finally {
      await app.end();
    }
  });

  it("MIGUELITO y martin siguen intactas y sin simulaciones", async () => {
    const after = await mig`SELECT r.slug, (SELECT count(*)::int FROM raffle_numbers n WHERE n.raffle_id = r.id) nums, (SELECT count(*)::int FROM orders o WHERE o.raffle_id = r.id) ords FROM raffles r WHERE r.slug IN ('miguelito','martin') ORDER BY r.slug`;
    expect(after.map((r) => ({ ...r }))).toEqual(realBefore);
    const [{ n }] = await mig`SELECT count(*)::int n FROM simulation_runs s JOIN raffles r ON r.id = s.raffle_id WHERE r.slug IN ('miguelito','martin')`;
    expect(n).toBe(0);
  });
});
