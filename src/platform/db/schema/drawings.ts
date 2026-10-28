import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { drawingStatus, redemptionStatus } from "./enums";
import { orderItems } from "./orders";
import { prizes, raffles } from "./raffles";

/** Solo estructura: en esta fase no se ejecutan sorteos. */
export const drawings = pgTable(
  "drawings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    status: drawingStatus("status").notNull().default("pending"),
    performedAt: timestamp("performed_at", { withTimezone: true }),
    resultEvidence: jsonb("result_evidence"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "drawings_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("restrict"),
    unique("drawings_id_raffle_uq").on(t.id, t.raffleId),
    index("drawings_raffle_idx").on(t.raffleId),
    check(
      "drawings_completed_has_date",
      sql`${t.status} <> 'completed' or ${t.performedAt} is not null`,
    ),
  ],
);

export const winners = pgTable(
  "winners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    drawingId: uuid("drawing_id").notNull(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    orderItemId: uuid("order_item_id").notNull(),
    prizeId: uuid("prize_id").notNull(),
    redemptionStatus: redemptionStatus("redemption_status")
      .notNull()
      .default("pending"),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "winners_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "winners_drawing_fk",
      columns: [t.drawingId, t.raffleId],
      foreignColumns: [drawings.id, drawings.raffleId],
    }).onDelete("restrict"),
    foreignKey({
      name: "winners_prize_fk",
      columns: [t.prizeId, t.raffleId],
      foreignColumns: [prizes.id, prizes.raffleId],
    }).onDelete("restrict"),
    foreignKey({
      name: "winners_order_item_fk",
      columns: [t.orderItemId, t.raffleId],
      foreignColumns: [orderItems.id, orderItems.raffleId],
    }).onDelete("restrict"),
    unique("winners_prize_item_uq").on(t.prizeId, t.orderItemId),
    index("winners_drawing_idx").on(t.drawingId),
    check(
      "winners_redemption_consistent",
      sql`(${t.redemptionStatus} = 'redeemed') = (${t.redeemedAt} is not null)`,
    ),
  ],
);

/**
 * Simulaciones de sorteo (BUILD-009). Tablas SEPARADAS de `drawings`/`winners`: nunca contienen resultados
 * oficiales. `is_simulation` es siempre true (check) y las filas no se pueden modificar (trigger).
 */
export const simulationRuns = pgTable(
  "simulation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    createdBy: uuid("created_by"),
    /** raffle_config: estructura real de la rifa; synthetic: parámetros ficticios. */
    source: text("source").notNull(),
    isSimulation: boolean("is_simulation").notNull().default(true),
    rulesVersion: text("rules_version").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    totalEligible: integer("total_eligible").notNull(),
    prizeCount: integer("prize_count").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    resultHash: text("result_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "simulation_runs_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    unique("simulation_runs_id_raffle_uq").on(t.id, t.raffleId),
    unique("simulation_runs_idem_uq").on(t.raffleId, t.idempotencyKey),
    index("simulation_runs_raffle_created_idx").on(t.raffleId, t.createdAt),
    check("simulation_runs_is_simulation", sql`${t.isSimulation} = true`),
    check("simulation_runs_source", sql`${t.source} in ('raffle_config', 'synthetic')`),
    check("simulation_runs_counts", sql`${t.totalEligible} > 0 and ${t.prizeCount} between 1 and 50 and ${t.prizeCount} <= ${t.totalEligible}`),
    check("simulation_runs_hashes", sql`${t.snapshotHash} ~ '^[0-9a-f]{64}$' and ${t.resultHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const simulationDraws = pgTable(
  "simulation_draws",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    isSimulation: boolean("is_simulation").notNull().default(true),
    prizePosition: integer("prize_position").notNull(),
    prizeTitle: text("prize_title").notNull(),
    folio: integer("folio").notNull(),
    localNumber: integer("local_number").notNull(),
    /** Participaciones elegibles antes de esta extracción y peso (elegibles) del folio sorteado. */
    eligibleBefore: integer("eligible_before").notNull(),
    folioWeight: integer("folio_weight").notNull(),
    foliosInPlay: integer("folios_in_play").notNull(),
    /** Conteo de elegibles por folio antes de la extracción: { "1": 20, "2": 19, ... }. */
    weightsBefore: jsonb("weights_before").notNull(),
    drawnAt: timestamp("drawn_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "simulation_draws_run_fk",
      columns: [t.runId, t.raffleId],
      foreignColumns: [simulationRuns.id, simulationRuns.raffleId],
    }).onDelete("cascade"),
    foreignKey({
      name: "simulation_draws_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    unique("simulation_draws_prize_uq").on(t.runId, t.prizePosition),
    unique("simulation_draws_participation_uq").on(t.runId, t.folio, t.localNumber),
    index("simulation_draws_run_idx").on(t.runId),
    check("simulation_draws_is_simulation", sql`${t.isSimulation} = true`),
    check("simulation_draws_ranges", sql`${t.prizePosition} >= 1 and ${t.folio} >= 1 and ${t.localNumber} >= 1 and ${t.folioWeight} >= 1 and ${t.eligibleBefore} >= ${t.folioWeight}`),
  ],
);
