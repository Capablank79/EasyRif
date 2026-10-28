import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { CopyLink } from "@/modules/campaigns/copy-link";
import { AssignForm, CreateSellerForm, ExtendForm, RevokeSellerForm, UnassignForm } from "@/modules/campaigns/forms";
import { CampaignError, getCampaignProgress } from "@/modules/campaigns/service";
import { requireUser } from "@/modules/auth/session";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { PHASE_LABEL, UUID_RE, formatFolio, formatZoned, getAppTimeZone } from "@/modules/raffles";
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

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Avance de la campaña</h2>
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
              {counts.sold} vendidas reales de {counts.total} · {counts.reservedDemo} reservadas (demo) · {counts.available} libres
            </p>
            <p className="mt-1 text-sm text-navy-900">
              Talonarios completos: {booklets.completed} de {booklets.total} · sin responsable: {booklets.unassigned}
            </p>
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
            <p className="mt-2 text-sm text-muted">Todavía no hay responsables de venta.</p>
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
                    {s.sold} vendidas · {s.reservedDemo} reservadas (demo) · {s.available} libres de {s.total}
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
            </Card>
            <Card>
              <h2 className="text-lg font-semibold text-navy-900">Asignar o reasignar talonarios</h2>
              <div className="mt-3 max-w-md">
                <AssignForm raffleId={raffle.id} sellers={activeSellers} />
              </div>
              <div className="mt-6 max-w-md border-t border-line pt-4">
                <UnassignForm raffleId={raffle.id} />
              </div>
            </Card>
          </>
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
