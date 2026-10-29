import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { requireUser } from "@/modules/auth/session";
import { DrawError, getSimulationOverview, type SimulationDrawView, type SimulationRunView } from "@/modules/drawings";
import { syntheticParticipant } from "@/modules/drawings/simulation";
import { SimulationForm } from "@/modules/drawings/forms";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { UUID_RE, formatFolio } from "@/modules/raffles";
import { formatZoned, getAppTimeZone } from "@/modules/raffles/campaign";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Sorteos — Simulación" };
export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(2).replace(".", ",")} %`;

function Banner() {
  return (
    <p role="note" className="rounded-xl border-2 border-amber-500 bg-amber-50 px-4 py-3 text-center text-sm font-bold uppercase tracking-wide text-amber-900">
      Simulación — sin validez
    </p>
  );
}

function DrawSteps({ d, nw, individual }: { d: SimulationDrawView; nw: number; individual: boolean }) {
  const total = d.eligibleBefore;
  if (individual) {
    const number = String(d.localNumber).padStart(nw, "0");
    return (
      <li className="rounded-2xl border border-line bg-white p-4">
        <p className="text-sm font-semibold text-navy-900">
          Premio {d.prizePosition}: <span className="break-words">{d.prizeTitle}</span>
        </p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          <li className="rounded-xl bg-sky-100 p-3 text-sm">
            <span className="block text-xs font-medium text-muted">1. Número sorteado</span>
            <span className="block text-lg font-bold text-navy-900">{number}</span>
            <span className="block text-xs text-muted">Uno de {total} números elegibles</span>
          </li>
          <li className="rounded-xl bg-lime-300 p-3 text-sm text-navy-950">
            <span className="block text-xs font-medium">2. Resultado (simulado)</span>
            <span className="block break-words text-lg font-bold">Número {number}</span>
            <span className="block text-xs">Probabilidad: 1 de {total} ({pct(1, total)})</span>
            <span className="mt-1 block text-xs font-medium">Ganador: {syntheticParticipant(d.localNumber)}</span>
          </li>
        </ol>
      </li>
    );
  }
  const num = `N-${String(d.localNumber).padStart(nw, "0")}`;
  return (
    <li className="rounded-2xl border border-line bg-white p-4">
      <p className="text-sm font-semibold text-navy-900">
        Premio {d.prizePosition}: <span className="break-words">{d.prizeTitle}</span>
      </p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        <li className="rounded-xl bg-sky-100 p-3 text-sm">
          <span className="block text-xs font-medium text-muted">1. Folio sorteado</span>
          <span className="block text-lg font-bold text-navy-900">T-{formatFolio(d.folio)}</span>
          <span className="block text-xs text-muted">
            Peso {d.folioWeight} de {total} ({pct(d.folioWeight, total)}) · {d.foliosInPlay} folios en juego
          </span>
        </li>
        <li className="rounded-xl bg-sky-100 p-3 text-sm">
          <span className="block text-xs font-medium text-muted">2. Número sorteado</span>
          <span className="block text-lg font-bold text-navy-900">{num}</span>
          <span className="block text-xs text-muted">Uno de {d.folioWeight} elegibles del folio</span>
        </li>
        <li className="rounded-xl bg-lime-300 p-3 text-sm text-navy-950">
          <span className="block text-xs font-medium">3. Resultado (simulado)</span>
          <span className="block break-words text-lg font-bold">
            T-{formatFolio(d.folio)} / {num}
          </span>
          <span className="block text-xs">Probabilidad: 1 de {total} ({pct(1, total)})</span>
          <span className="mt-1 block text-xs font-medium">Ganador: {syntheticParticipant(d.localNumber)}</span>
        </li>
      </ol>
    </li>
  );
}

function RunView({ run, tz, individual }: { run: SimulationRunView; tz: string; individual: boolean }) {
  const perBooklet = Math.max(...run.draws.map((d) => Math.max(...Object.values(d.weightsBefore))));
  // Individual: los números se guardan con el ancho del total (p. ej. 045 en 100 números).
  const nw = individual ? String(run.totalEligible).length : Math.max(2, String(perBooklet).length);
  const reusedFolio = new Set(run.draws.map((d) => d.folio)).size < run.draws.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {formatZoned(run.createdAt, tz)} · {run.source === "synthetic" ? "Datos sintéticos" : "Configuración de la rifa"} ·{" "}
        {run.totalEligible} participaciones · reglas {run.rulesVersion}
      </p>
      <ul className="space-y-3">
        {run.draws.map((d) => (
          <DrawSteps key={d.prizePosition} d={d} nw={nw} individual={individual} />
        ))}
      </ul>
      {!individual && reusedFolio && (
        <p className="text-sm text-navy-900">
          Un mismo talonario puede salir más de una vez: solo se excluye la participación ganadora, no el folio.
        </p>
      )}
      {new Set(run.draws.map((d) => syntheticParticipant(d.localNumber))).size < run.draws.length && (
        <p className="text-sm text-navy-900">
          Un mismo participante sintético ganó más de un premio con participaciones distintas.
        </p>
      )}
      <details className="text-xs text-muted">
        <summary className="min-h-11 cursor-pointer py-3">Evidencia de integridad</summary>
        <p className="break-all">Instantánea (SHA-256): {run.snapshotHash}</p>
        <p className="break-all">Resultados (SHA-256): {run.resultHash}</p>
        <p className="mt-1">Los digests detectan alteraciones del registro; no prueban por sí solos la aleatoriedad del sorteo.</p>
      </details>
    </div>
  );
}

export default async function SorteosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireUser();
  let o;
  try {
    o = await getSimulationOverview(getDb(), user.id, id);
  } catch (e) {
    if (e instanceof DrawError || e instanceof AuthorizationError) notFound();
    throw e;
  }
  const { raffle: r, gate } = o;
  const tz = getAppTimeZone();
  const individual = r.numberingMode !== "booklets";
  const canUseConfig = o.prizes.length > 0 && (individual ? o.counts.total > 0 : (r.bookletCount ?? 0) > 0);
  const [latest, ...older] = o.runs;

  return (
    <>
      <section className="bg-navy-900 text-white">
        <Container className="py-8">
          <p className="text-sm text-sky-100">Sorteos — Simulación</p>
          <h1 className="mt-1 break-words text-2xl font-bold sm:text-3xl">{r.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>{r.numberingMode === "booklets" ? "Talonarios foliados" : "Numeración individual"}</Badge>
            <Badge>{r.numberCount} participaciones</Badge>
            <Badge>{o.prizes.length} premios</Badge>
          </div>
        </Container>
      </section>
      <Container className="space-y-6 py-6">
        <PanelNav active="rifas" orgId={r.organizationId} />
        <ButtonLink href={`/panel/rifas/${r.id}`} variant="ghost" className="w-full sm:w-auto">
          ← Volver a la rifa
        </ButtonLink>
        <Banner />

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Sorteo oficial: no disponible</h2>
          <p className="mt-1 font-medium text-amber-900">{gate.headline}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {gate.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Cierre de ventas: {r.salesClosesAt ? formatZoned(r.salesClosesAt, tz) : "sin definir"} · Sorteo:{" "}
            {r.drawAt ? formatZoned(r.drawAt, tz) : "sin definir"}. Vendidos confirmados: {o.counts.sold} de {o.counts.total}.
          </p>
          <Button type="button" disabled aria-disabled="true" className="mt-3 w-full sm:w-auto">
            Ejecutar sorteo oficial (no disponible)
          </Button>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Premios, en orden de extracción</h2>
          {o.prizes.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Esta rifa aún no tiene premios.</p>
          ) : (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-navy-900">
              {o.prizes.map((p) => (
                <li key={p.position} className="break-words">
                  {p.title}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-sm text-muted">
            {individual
              ? "Cada premio tiene su propia extracción entre todos los números de la rifa, todos con la misma probabilidad. Solo el número ganador se excluye de los premios siguientes."
              : "Cada premio tiene su propia extracción: primero el folio (con peso igual a sus participaciones elegibles) y luego el número dentro del folio. Solo la participación ganadora se excluye: el talonario sigue participando y una misma persona puede ganar otro premio con un número distinto."}
          </p>
        </Card>

        {o.canSimulate ? (
          <Card>
            <h2 className="text-lg font-semibold text-navy-900">Nueva simulación</h2>
            <p className="mb-3 mt-1 text-sm text-muted">
              Se guarda como simulación, sin ganadores oficiales ni cambios en ventas o reservas.
            </p>
            <SimulationForm
              raffleId={r.id}
              idempotencyKey={randomUUID()}
              canUseConfig={canUseConfig}
              individual={individual}
              defaults={{ bookletCount: 10, numbersPerBooklet: 20, prizeCount: 3 }}
            />
          </Card>
        ) : (
          <p className="text-sm text-muted">Tu rol permite consultar simulaciones, pero no lanzarlas.</p>
        )}

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Última simulación</h2>
          {latest ? (
            <div className="mt-3 space-y-3">
              <Banner />
              <RunView run={latest} tz={tz} individual={individual} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Aún no hay simulaciones.</p>
          )}
        </Card>

        {older.length > 0 && (
          <Card>
            <h2 className="text-lg font-semibold text-navy-900">Historial reciente</h2>
            <div className="mt-2 divide-y divide-line">
              {older.map((run) => (
                <details key={run.id} className="py-1">
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-navy-900">
                    {formatZoned(run.createdAt, tz)} · {run.draws.length} premios · simulación
                  </summary>
                  <div className="pb-3">
                    <RunView run={run} tz={tz} individual={individual} />
                  </div>
                </details>
              ))}
            </div>
          </Card>
        )}
      </Container>
    </>
  );
}
