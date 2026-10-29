import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { AssignmentGrid } from "@/modules/campaigns/assignment-grid";
import { CopyLink } from "@/modules/campaigns/copy-link";
import { SellerExcelImport } from "@/modules/campaigns/seller-excel-import";
import { CreateSellerForm, ExtendForm, RevokeSellerForm, UnassignForm } from "@/modules/campaigns/forms";
import { CampaignError, getCampaignProgress } from "@/modules/campaigns/service";
import { requireUser } from "@/modules/auth/session";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { PHASE_LABEL, UUID_RE, formatFolio, formatMoney, formatZoned, getAppTimeZone } from "@/modules/raffles";
import { getRaffleDetail, RaffleError } from "@/modules/raffles/service";
import { resolvePublicBaseUrl } from "@/modules/receipts/base-url";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Responsables y avance" };
export const dynamic = "force-dynamic";

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Avance"
      className="h-2 w-full overflow-hidden rounded-full bg-sky-100"
    >
      <div className="h-full bg-lime-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default async function ResponsablesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireUser();
  const db = getDb();
  let p, raffle;
  try {
    p = await getCampaignProgress(db, user.id, id);
    raffle = (await getRaffleDetail(db, user.id, id)).raffle;
  } catch (e) {
    if (e instanceof CampaignError || e instanceof RaffleError || e instanceof AuthorizationError) notFound();
    throw e;
  }
  const tz = getAppTimeZone();
  let base = "";
  try {
    base = resolvePublicBaseUrl();
  } catch {
    base = "";
  }
  const { counts, booklets, state } = p;
  const activeSellers = p.sellers.filter((s) => s.status === "active");
  const assigned = Math.max(0, booklets.total - booklets.unassigned);
  const assignedPercent = booklets.total > 0 ? Math.round((assigned / booklets.total) * 100) : 0;

  return (
    <>
      <section className="bg-navy-900 text-white">
        <Container className="py-8">
          <p className="text-sm text-sky-100">Talonarios colaborativos</p>
          <h1 className="mt-1 break-words text-2xl font-bold sm:text-3xl">{raffle.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={state.phase === "cerrada_incompleta" ? "neutral" : "demo"}>{PHASE_LABEL[state.phase]}</Badge>
            <Badge>Modo demostración</Badge>
          </div>
        </Container>
      </section>
      <Container className="space-y-6 py-6">
        <PanelNav active="rifas" orgId={raffle.organizationId} />
        <ButtonLink href={`/panel/rifas/${raffle.id}`} variant="ghost" className="w-full sm:w-auto">
          ← Volver a la rifa
        </ButtonLink>

        <Card className="bg-sky-50">
          <h2 className="text-lg font-semibold text-navy-900">Cómo funciona</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-900">
            <li>
              <strong>Talonario (folio):</strong> grupo de números impreso. <strong>Número:</strong> su posición dentro del talonario. Ejemplo: T-0003 / N-15 es el número 15 del talonario 3.
            </li>
            <li>Cada responsable tiene un enlace personal. Con ese enlace solo ve y reserva los talonarios que le asignaste.</li>
            <li>Comparte cada enlace solo con su responsable: quien lo tenga puede reservar en su nombre. Puedes revocarlo cuando quieras.</li>
            <li>Todo funciona en modo demostración: las reservas no son ventas ni pagos.</li>
          </ul>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Avance de talonarios</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Total de folios</dt><dd className="font-bold">{booklets.total}</dd></div>
            <div><dt className="text-muted">Asignados</dt><dd className="font-bold">{assigned}</dd></div>
            <div><dt className="text-muted">Sin asignar</dt><dd className="font-bold">{booklets.unassigned}</dd></div>
            <div><dt className="text-muted">Responsables activos</dt><dd className="font-bold">{activeSellers.length}</dd></div>
          </dl>
          <div className="mt-3">
            <Bar done={assigned} total={booklets.total} />
            <p className="mt-1 text-sm text-navy-900">{assignedPercent}% de los folios asignados</p>
          </div>
          {p.canManage && <ButtonLink href="#folios" variant="secondary" className="mt-3 w-full sm:w-auto">Ir a asignar folios</ButtonLink>}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Actividad de la rifa</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Cierre de ventas</dt>
              <dd className="font-semibold">{raffle.salesClosesAt ? formatZoned(raffle.salesClosesAt, tz) : "Sin definir"}</dd>
            </div>
            <div>
              <dt className="text-muted">Fecha del sorteo</dt>
              <dd className="font-semibold">{raffle.drawAt ? formatZoned(raffle.drawAt, tz) : "Sin definir"}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <Bar done={counts.sold} total={counts.total} />
            <p className="mt-2 text-sm text-navy-900">
              {counts.sold} vendidas reales de {counts.total} · {counts.simulatedSold} vendidas (simulado) · {counts.reservedDemo} reservadas (demo) · {counts.available} libres
            </p>
            <p className="mt-1 text-sm text-navy-900">
              Talonarios completos: {booklets.completed} de {booklets.total} · sin responsable: {booklets.unassigned}
            </p>
          </div>
          <div className="mt-4 rounded-xl border border-line p-3">
            <h3 className="font-semibold text-navy-900">Ventas reales confirmadas</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-muted">Pedidos confirmados</dt><dd className="font-semibold">{counts.realConfirmedOrders}</dd></div>
              <div><dt className="text-muted">Ingresos confirmados</dt><dd className="font-semibold">{formatMoney(counts.realRevenueCents, raffle.currency)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">Solo pedidos no demo en estado confirmado; las reservas no se suman como ventas.</p>
          </div>
          <div className="mt-3 rounded-xl border border-sky-300 bg-sky-50 p-3">
            <h3 className="font-semibold text-navy-900">SIMULACIÓN — SIN VALIDEZ</h3>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <div><dt className="text-muted">Reservas demo</dt><dd className="font-semibold">{counts.activeDemoOrders}</dd></div>
              <div><dt className="text-muted">Números reservados</dt><dd className="font-semibold">{counts.activeDemoNumbers}</dd></div>
              <div><dt className="text-muted">Monto simulado</dt><dd className="font-semibold">{formatMoney(counts.activeDemoAmountCents, raffle.currency)}</dd></div>
              <div><dt className="text-muted">Confirmaciones ficticias</dt><dd className="font-semibold">{counts.simulatedConfirmedOrders}</dd></div>
              <div><dt className="text-muted">Números simulados</dt><dd className="font-semibold">{counts.simulatedConfirmedNumbers}</dd></div>
              <div><dt className="text-muted">Importe ficticio</dt><dd className="font-semibold">{formatMoney(counts.simulatedConfirmedAmountCents, raffle.currency)}</dd></div>
              <div><dt className="text-muted">Pagos simulados</dt><dd className="font-semibold">{counts.simulatedPayments}</dd></div>
              <div><dt className="text-muted">Monto pagado simulado</dt><dd className="font-semibold">{formatMoney(counts.simulatedPaidAmountCents, raffle.currency)}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-navy-700">Las confirmaciones se registran solo en auditoría. No cambian los pedidos demo ni suman a ventas o ingresos reales.</p>
          </div>
          {state.phase === "cerrada_incompleta" && (
            <p role="note" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Campaña incompleta: las ventas cerraron con participaciones sin vender. El sorteo sigue bloqueado.
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Las reservas de demostración no son ventas. Los sorteos y pagos reales no están disponibles en esta fase.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Responsables</h2>
          {p.sellers.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Todavía no hay responsables de venta.{" "}
              {p.canManage
                ? "Crea uno más abajo y luego asígnale talonarios para que reciba su enlace personal."
                : "Quien administre la rifa puede crearlos y asignarles talonarios."}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {p.sellers.map((s) => (
                <li key={s.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="break-words font-semibold text-navy-900">{s.displayName}</p>
                    <Badge tone={s.status === "active" ? "demo" : "neutral"}>{s.status === "active" ? "Activo" : "Revocado"}</Badge>
                  </div>
                  <p className="mt-1 break-words text-sm text-navy-900">
                    Talonarios: {s.folios.length > 0 ? s.folios.map((f) => `T-${formatFolio(f)}`).join(", ") : "ninguno"}
                  </p>
                  <p className="text-xs text-muted">
                    {s.sold} vendidas reales · {s.simulatedSold} vendidas (simulado) · {s.reservedDemo} reservadas (demo) · {s.available} libres de {s.total}
                  </p>
                  <div className="mt-2">
                    <Bar done={s.sold} total={s.total} />
                  </div>
                  {s.linkPath && base && (
                    <div className="mt-3">
                      <CopyLink url={`${base}${s.linkPath}`} />
                    </div>
                  )}
                  {p.canManage && s.status === "active" && (
                    <div className="mt-2">
                      <RevokeSellerForm raffleId={raffle.id} sellerId={s.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {p.canManage && (
          <>
            <Card>
              <h2 className="text-lg font-semibold text-navy-900">Nuevo responsable</h2>
              <div className="mt-3 max-w-md">
                <CreateSellerForm raffleId={raffle.id} />
              </div>
              <div className="mt-5 max-w-2xl border-t border-line pt-4">
                <SellerExcelImport raffleId={raffle.id} />
              </div>
            </Card>
            <Card>
              <h2 className="text-lg font-semibold text-navy-900">Asignar o reasignar talonarios</h2>
              <div className="mt-3 max-w-md">
                <p className="text-sm text-muted">Crea primero los responsables; luego selecciónalos en la cuadrícula para asignar sus folios.</p>
              </div>
              <div className="mt-6 max-w-md border-t border-line pt-4">
                <UnassignForm raffleId={raffle.id} />
              </div>
            </Card>
          </>
        )}

        {p.canManage && (
          <Card>
            <AssignmentGrid
              raffleId={raffle.id}
              folios={p.folios}
              sellers={activeSellers.map((s) => ({ id: s.id, displayName: s.displayName }))}
            />
          </Card>
        )}

        {p.canExtend && (
          <Card>
            <h2 className="text-lg font-semibold text-navy-900">Extender plazo de ventas</h2>
            <p className="mt-1 text-sm text-muted">Solo se puede posponer el cierre. Queda registrado con el motivo.</p>
            <div className="mt-3 max-w-xl">
              <ExtendForm raffleId={raffle.id} timeZone={tz} />
            </div>
          </Card>
        )}

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Historial de asignaciones</h2>
          {p.history.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Sin movimientos.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm text-navy-900">
              {p.history.map((h, i) => (
                <li key={i} className="break-words">
                  T-{formatFolio(h.folio)} → {h.sellerName} · desde {formatZoned(h.assignedAt, tz)}
                  {h.endedAt ? ` hasta ${formatZoned(h.endedAt, tz)}` : " (vigente)"}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Container>
    </>
  );
}
