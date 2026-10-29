import { and, asc, desc, eq, sql } from "drizzle-orm";
import { assertCan, getActiveRole, type OrgRole } from "@/modules/organizations";
import { computeCampaignState, type CampaignState } from "@/modules/raffles/campaign";
import { recordAuditEvent } from "@/platform/audit";
import { booklets, prizes, raffleNumbers, raffles, simulationDraws, simulationRuns } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";
import {
  MAX_BOOKLETS,
  MAX_ELIGIBLE,
  MAX_PER_BOOKLET,
  MAX_PRIZES,
  RULES_VERSION,
  SimulationInputError,
  digest,
  resultDigest,
  runSimulation,
  secureRandomInt,
  snapshotOf,
  type RandomInt,
  type SimBooklet,
  type SimPrize,
} from "./simulation";

export type DrawErrorCode = "not_found" | "invalid" | "blocked" | "limit";

export class DrawError extends Error {
  constructor(
    public code: DrawErrorCode,
    message: string,
    public blockers: string[] = [],
  ) {
    super(message);
    this.name = "DrawError";
  }
}

const notFound = () => new DrawError("not_found", "No se encontró el recurso.");
const rowsOf = <T>(res: unknown): T[] =>
  (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];

export const MAX_RUNS_PER_RAFFLE = 200;
export const SYNTHETIC_MAX_ELIGIBLE = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SimulationSource = "raffle_config" | "synthetic";
export interface SyntheticParams {
  bookletCount: number;
  numbersPerBooklet: number;
  prizeCount: number;
}

export interface SimulationDrawView {
  prizePosition: number;
  prizeTitle: string;
  folio: number;
  localNumber: number;
  eligibleBefore: number;
  folioWeight: number;
  foliosInPlay: number;
  weightsBefore: Record<string, number>;
}
export interface SimulationRunView {
  id: string;
  source: SimulationSource;
  createdAt: Date;
  rulesVersion: string;
  totalEligible: number;
  snapshotHash: string;
  resultHash: string;
  draws: SimulationDrawView[];
}

/**
 * Estado del sorteo REAL. En BUILD-009 nunca está habilitado: faltan la confirmación de pagos y la
 * revisión operativa; una reserva de demostración jamás cuenta como venta.
 */
export interface RealDrawGate {
  enabled: false;
  campaign: CampaignState;
  headline: string;
  blockers: string[];
}

export function evaluateRealDrawGate(
  raffle: { salesClosesAt: Date | null; drawAt: Date | null },
  counts: { total: number; sold: number; reservedDemo: number; simulatedSold?: number },
  prizeCount: number,
  now: Date = new Date(),
): RealDrawGate {
  const campaign = computeCampaignState(raffle, { ...counts, available: counts.total - counts.sold - counts.reservedDemo - (counts.simulatedSold ?? 0) }, now);
  const blockers = [...campaign.drawBlockers];
  if (prizeCount === 0) blockers.push("La rifa no tiene premios.");
  else if (prizeCount > counts.total) blockers.push("Hay más premios que participaciones.");
  if (counts.reservedDemo > 0) {
    blockers.push(`Hay ${counts.reservedDemo} reservas pendientes (de demostración): no son ventas confirmadas.`);
  }
  if ((counts.simulatedSold ?? 0) > 0) blockers.push(`Hay ${counts.simulatedSold} participaciones con pago ficticio: no son ventas reales confirmadas.`);
  blockers.push("No existen pagos confirmados: la confirmación de pagos no está implementada en esta fase.");
  const incomplete = counts.total === 0 || counts.sold < counts.total;
  return {
    enabled: false,
    campaign,
    headline: incomplete ? "Campaña incompleta — sorteo no habilitado" : "Sorteo real no habilitado",
    blockers,
  };
}

async function authorize(db: Database, userId: string, raffleId: string, action: "draws:read" | "draws:simulate") {
  if (!UUID.test(raffleId)) throw notFound();
  const [r] = await db.select().from(raffles).where(eq(raffles.id, raffleId)).limit(1);
  if (!r) throw notFound();
  const role = await getActiveRole(db, userId, r.organizationId);
  if (!role) throw notFound();
  assertCan(role, action);
  return { raffle: r, role: role as OrgRole };
}

export interface SimulationOverview {
  raffle: typeof raffles.$inferSelect;
  prizes: { position: number; title: string }[];
  counts: { total: number; sold: number; reservedDemo: number; simulatedSold: number };
  gate: RealDrawGate;
  runs: SimulationRunView[];
  canSimulate: boolean;
  limits: { maxRuns: number; syntheticMaxEligible: number; maxPrizes: number };
}

async function loadRuns(db: Database, raffleId: string, limit: number): Promise<SimulationRunView[]> {
  const runs = await db
    .select()
    .from(simulationRuns)
    .where(eq(simulationRuns.raffleId, raffleId))
    .orderBy(desc(simulationRuns.createdAt))
    .limit(limit);
  const out: SimulationRunView[] = [];
  for (const r of runs) {
    const draws = await db
      .select()
      .from(simulationDraws)
      .where(eq(simulationDraws.runId, r.id))
      .orderBy(asc(simulationDraws.prizePosition));
    out.push({
      id: r.id,
      source: r.source as SimulationSource,
      createdAt: r.createdAt,
      rulesVersion: r.rulesVersion,
      totalEligible: r.totalEligible,
      snapshotHash: r.snapshotHash,
      resultHash: r.resultHash,
      draws: draws.map((d) => ({
        prizePosition: d.prizePosition,
        prizeTitle: d.prizeTitle,
        folio: d.folio,
        localNumber: d.localNumber,
        eligibleBefore: d.eligibleBefore,
        folioWeight: d.folioWeight,
        foliosInPlay: d.foliosInPlay,
        weightsBefore: d.weightsBefore as Record<string, number>,
      })),
    });
  }
  return out;
}

async function realCounts(db: Database, raffleId: string) {
  const [c] = rowsOf<{ total: string; sold: string; reserved: string; simulated_sold: string }>(
    await db.execute(sql`
      SELECT count(*) AS total,
        count(*) FILTER (WHERE "status" = 'sold') AS sold,
        count(*) FILTER (WHERE "status" = 'reserved' AND "reserved_until" > now()) AS reserved,
        count(*) FILTER (WHERE "status" = 'simulated_sold') AS simulated_sold
      FROM "raffle_numbers" WHERE "raffle_id" = ${raffleId}`),
  );
  return { total: +c.total, sold: +c.sold, reservedDemo: +c.reserved, simulatedSold: +c.simulated_sold };
}

export async function getSimulationOverview(db: Database, userId: string, raffleId: string): Promise<SimulationOverview> {
  const { raffle, role } = await authorize(db, userId, raffleId, "draws:read");
  const pz = await db
    .select({ position: prizes.position, title: prizes.title })
    .from(prizes)
    .where(eq(prizes.raffleId, raffle.id))
    .orderBy(asc(prizes.position));
  const counts = await realCounts(db, raffle.id);
  return {
    raffle,
    prizes: pz,
    counts,
    gate: evaluateRealDrawGate(raffle, counts, pz.length),
    runs: await loadRuns(db, raffle.id, 5),
    canSimulate: role === "owner" || role === "admin",
    limits: { maxRuns: MAX_RUNS_PER_RAFFLE, syntheticMaxEligible: SYNTHETIC_MAX_ELIGIBLE, maxPrizes: MAX_PRIZES },
  };
}

export async function getSimulationRun(db: Database, userId: string, raffleId: string, runId: string) {
  await authorize(db, userId, raffleId, "draws:read");
  if (!UUID.test(runId)) throw notFound();
  const [r] = await db
    .select({ id: simulationRuns.id })
    .from(simulationRuns)
    .where(and(eq(simulationRuns.id, runId), eq(simulationRuns.raffleId, raffleId)))
    .limit(1);
  if (!r) throw notFound();
  const all = await loadRuns(db, raffleId, MAX_RUNS_PER_RAFFLE);
  return all.find((x) => x.id === runId) ?? null;
}

export function validateSynthetic(p: SyntheticParams): SyntheticParams {
  const ok = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
  if (!ok(p.bookletCount, MAX_BOOKLETS) || !ok(p.numbersPerBooklet, MAX_PER_BOOKLET) || !ok(p.prizeCount, MAX_PRIZES)) {
    throw new DrawError("invalid", "Parámetros de simulación fuera de rango.");
  }
  if (p.bookletCount * p.numbersPerBooklet > SYNTHETIC_MAX_ELIGIBLE) {
    throw new DrawError("invalid", `La simulación sintética admite hasta ${SYNTHETIC_MAX_ELIGIBLE} participaciones.`);
  }
  if (p.prizeCount > p.bookletCount * p.numbersPerBooklet) {
    throw new DrawError("invalid", "Hay más premios que participaciones elegibles.");
  }
  return p;
}

export interface RunOptions {
  source: SimulationSource;
  idempotencyKey: string;
  synthetic?: SyntheticParams;
}

/**
 * Ejecuta y persiste una simulación de forma atómica e idempotente. Solo escribe en `simulation_*` y
 * `audit_events`: no toca pedidos, números, reservas ni `drawings`/`winners`.
 * `deps.rng` existe únicamente para pruebas y se rechaza en producción.
 */
export async function runDrawSimulation(
  db: Database,
  userId: string,
  raffleId: string,
  opts: RunOptions,
  deps: { rng?: RandomInt } = {},
): Promise<{ run: SimulationRunView; replay: boolean }> {
  if (deps.rng && process.env.NODE_ENV === "production") throw new Error("El RNG inyectable no se permite en producción.");
  const rng = deps.rng ?? secureRandomInt;
  if (!UUID.test(opts.idempotencyKey)) throw new DrawError("invalid", "Clave de idempotencia no válida.");
  if (opts.source !== "raffle_config" && opts.source !== "synthetic") throw new DrawError("invalid", "Origen no válido.");
  const { raffle: first } = await authorize(db, userId, raffleId, "draws:simulate");

  return db.transaction(async (tx) => {
    const t = tx as unknown as Database;
    // Serializa simulaciones de la misma rifa y fija la instantánea frente a ediciones concurrentes.
    const [raffle] = await t
      .select()
      .from(raffles)
      .where(and(eq(raffles.id, first.id), eq(raffles.organizationId, first.organizationId)))
      .for("update")
      .limit(1);
    if (!raffle) throw notFound();

    const [existing] = await t
      .select({ id: simulationRuns.id })
      .from(simulationRuns)
      .where(and(eq(simulationRuns.raffleId, raffle.id), eq(simulationRuns.idempotencyKey, opts.idempotencyKey)))
      .limit(1);
    if (existing) {
      const [run] = (await loadRuns(t, raffle.id, MAX_RUNS_PER_RAFFLE)).filter((r) => r.id === existing.id);
      return { run, replay: true };
    }

    const [{ n }] = rowsOf<{ n: string }>(
      await t.execute(sql`SELECT count(*) AS n FROM "simulation_runs" WHERE "raffle_id" = ${raffle.id}`),
    );
    if (+n >= MAX_RUNS_PER_RAFFLE) throw new DrawError("limit", `Se alcanzó el máximo de ${MAX_RUNS_PER_RAFFLE} simulaciones por rifa.`);

    let bk: SimBooklet[];
    let pz: SimPrize[];
    if (opts.source === "raffle_config") {
      if (raffle.numberingMode === "booklets") {
        if (!raffle.numbersPerBooklet) throw new DrawError("invalid", "La rifa aún no tiene talonarios generados.");
        const rows = await t.select({ folio: booklets.folio }).from(booklets).where(eq(booklets.raffleId, raffle.id));
        bk = rows.map((b) => ({ folio: b.folio, count: raffle.numbersPerBooklet! }));
        if (bk.length === 0) throw new DrawError("invalid", "La rifa aún no tiene talonarios generados.");
      } else {
        // Numeración individual: un único grupo (folio 1) con todos sus números; el sorteo es de una sola etapa.
        const [{ n: generated }] = await t
          .select({ n: sql<number>`count(*)::int` })
          .from(raffleNumbers)
          .where(eq(raffleNumbers.raffleId, raffle.id));
        if (generated === 0) throw new DrawError("invalid", "La rifa aún no tiene números generados.");
        bk = [{ folio: 1, count: generated }];
      }
      pz = await t
        .select({ position: prizes.position, title: prizes.title })
        .from(prizes)
        .where(eq(prizes.raffleId, raffle.id))
        .orderBy(asc(prizes.position));
      if (pz.length === 0) throw new DrawError("invalid", "La rifa no tiene premios.");
    } else {
      if (!opts.synthetic) throw new DrawError("invalid", "Faltan los parámetros de la simulación sintética.");
      const p = validateSynthetic(opts.synthetic);
      bk = Array.from({ length: p.bookletCount }, (_, i) => ({ folio: i + 1, count: p.numbersPerBooklet }));
      pz = Array.from({ length: p.prizeCount }, (_, i) => ({ position: i + 1, title: `Premio de ejemplo ${i + 1}` }));
    }

    let result;
    try {
      result = runSimulation(bk, pz, rng, raffle.numberingMode === "booklets" || opts.source === "synthetic" ? undefined : MAX_ELIGIBLE);
    } catch (e) {
      if (e instanceof SimulationInputError) throw new DrawError("invalid", e.message);
      throw e;
    }
    const snapshot = snapshotOf(bk, pz);
    const snapshotHash = digest(snapshot);
    const resultHash = resultDigest(result.draws);

    const [run] = await t
      .insert(simulationRuns)
      .values({
        raffleId: raffle.id,
        organizationId: raffle.organizationId,
        createdBy: userId,
        source: opts.source,
        rulesVersion: RULES_VERSION,
        idempotencyKey: opts.idempotencyKey,
        totalEligible: result.totalEligible,
        prizeCount: pz.length,
        snapshot,
        snapshotHash,
        resultHash,
      })
      .returning();
    await t.insert(simulationDraws).values(
      result.draws.map((d) => ({
        runId: run.id,
        raffleId: raffle.id,
        organizationId: raffle.organizationId,
        ...d,
      })),
    );
    await recordAuditEvent(t, {
      organizationId: raffle.organizationId,
      actorId: userId,
      entityType: "simulation_run",
      entityId: run.id,
      action: "draw.simulated",
      metadata: {
        simulation: true,
        source: opts.source,
        rulesVersion: RULES_VERSION,
        prizes: pz.length,
        totalEligible: result.totalEligible,
        snapshotHash,
        resultHash,
      },
    });
    const view = (await loadRuns(t, raffle.id, MAX_RUNS_PER_RAFFLE)).find((r) => r.id === run.id)!;
    return { run: view, replay: false };
  });
}

/**
 * Punto de entrada del sorteo OFICIAL: bloqueado siempre en BUILD-009, también en el servidor.
 * Registra el intento y devuelve los motivos; no existe ninguna ruta que lo habilite.
 */
export async function launchOfficialDraw(db: Database, userId: string, raffleId: string): Promise<never> {
  const { raffle } = await authorize(db, userId, raffleId, "draws:read");
  const pz = await db.select({ id: prizes.id }).from(prizes).where(eq(prizes.raffleId, raffle.id));
  const gate = evaluateRealDrawGate(raffle, await realCounts(db, raffle.id), pz.length);
  await recordAuditEvent(db, {
    organizationId: raffle.organizationId,
    actorId: userId,
    entityType: "raffle",
    entityId: raffle.id,
    action: "draw.official_blocked",
    metadata: { blockers: gate.blockers.length },
  });
  throw new DrawError("blocked", gate.headline, gate.blockers);
}
