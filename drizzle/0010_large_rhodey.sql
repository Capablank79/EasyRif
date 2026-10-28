CREATE TABLE "simulation_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"is_simulation" boolean DEFAULT true NOT NULL,
	"prize_position" integer NOT NULL,
	"prize_title" text NOT NULL,
	"folio" integer NOT NULL,
	"local_number" integer NOT NULL,
	"eligible_before" integer NOT NULL,
	"folio_weight" integer NOT NULL,
	"folios_in_play" integer NOT NULL,
	"weights_before" jsonb NOT NULL,
	"drawn_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulation_draws_prize_uq" UNIQUE("run_id","prize_position"),
	CONSTRAINT "simulation_draws_participation_uq" UNIQUE("run_id","folio","local_number"),
	CONSTRAINT "simulation_draws_is_simulation" CHECK ("simulation_draws"."is_simulation" = true),
	CONSTRAINT "simulation_draws_ranges" CHECK ("simulation_draws"."prize_position" >= 1 and "simulation_draws"."folio" >= 1 and "simulation_draws"."local_number" >= 1 and "simulation_draws"."folio_weight" >= 1 and "simulation_draws"."eligible_before" >= "simulation_draws"."folio_weight")
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"source" text NOT NULL,
	"is_simulation" boolean DEFAULT true NOT NULL,
	"rules_version" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"total_eligible" integer NOT NULL,
	"prize_count" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"result_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulation_runs_id_raffle_uq" UNIQUE("id","raffle_id"),
	CONSTRAINT "simulation_runs_idem_uq" UNIQUE("raffle_id","idempotency_key"),
	CONSTRAINT "simulation_runs_is_simulation" CHECK ("simulation_runs"."is_simulation" = true),
	CONSTRAINT "simulation_runs_source" CHECK ("simulation_runs"."source" in ('raffle_config', 'synthetic')),
	CONSTRAINT "simulation_runs_counts" CHECK ("simulation_runs"."total_eligible" > 0 and "simulation_runs"."prize_count" between 1 and 50 and "simulation_runs"."prize_count" <= "simulation_runs"."total_eligible"),
	CONSTRAINT "simulation_runs_hashes" CHECK ("simulation_runs"."snapshot_hash" ~ '^[0-9a-f]{64}$' and "simulation_runs"."result_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "simulation_draws" ADD CONSTRAINT "simulation_draws_run_fk" FOREIGN KEY ("run_id","raffle_id") REFERENCES "public"."simulation_runs"("id","raffle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_draws" ADD CONSTRAINT "simulation_draws_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_raffle_org_fk" FOREIGN KEY ("raffle_id","organization_id") REFERENCES "public"."raffles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "simulation_draws_run_idx" ON "simulation_draws" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "simulation_runs_raffle_created_idx" ON "simulation_runs" USING btree ("raffle_id","created_at");--> statement-breakpoint
-- Las simulaciones son inmutables: sin UPDATE (el DELETE solo ocurre por cascada al borrar la rifa).
CREATE FUNCTION simulation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Las simulaciones de sorteo son inmutables';
END $$;
--> statement-breakpoint
CREATE TRIGGER simulation_runs_no_update BEFORE UPDATE ON simulation_runs FOR EACH ROW EXECUTE FUNCTION simulation_immutable();
--> statement-breakpoint
CREATE TRIGGER simulation_draws_no_update BEFORE UPDATE ON simulation_draws FOR EACH ROW EXECUTE FUNCTION simulation_immutable();