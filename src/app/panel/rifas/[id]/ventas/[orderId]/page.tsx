import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { requireUser } from "@/modules/auth/session";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { formatMoney, formatZoned, getAppTimeZone, UUID_RE } from "@/modules/raffles";
import { getSaleOperationDetail, SALE_STATE_LABEL, SalesError } from "@/modules/orders/sales-service";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Detalle de operación" };
export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  "demo.purchase_confirmed": "Compra DEMO confirmada",
  "demo.payment_simulated": "Pago DEMO simulado",
};

export default async function SaleOperationPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id, orderId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(orderId)) notFound();
  const user = await requireUser();
  let operation;
  try {
    operation = await getSaleOperationDetail(getDb(), user.id, id, orderId);
  } catch (error) {
    if (error instanceof SalesError || error instanceof AuthorizationError) notFound();
    throw error;
  }
  const tz = getAppTimeZone();
  return <>
    <section className="bg-navy-900 text-white"><Container className="py-7">
      <p className="text-sm text-sky-100">{operation.raffleTitle}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">Detalle de operación</h1><Badge tone={operation.isDemo ? "demo" : "neutral"}>{operation.isDemo ? "DEMO" : "Real"}</Badge><Badge>{SALE_STATE_LABEL[operation.state]}</Badge></div>
    </Container></section>
    <Container className="space-y-5 py-6">
      <PanelNav active="rifas" />
      <ButtonLink href={`/panel/rifas/${id}/ventas`} variant="ghost" className="w-full sm:w-auto">← Volver a ventas</ButtonLink>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-navy-950">Operación</h2><p className="mt-1 text-sm text-muted">{formatZoned(operation.createdAt, tz)}</p></div>
          {operation.receiptAvailable && operation.canSeeBuyers && <a href={`/panel/rifas/${id}/ventas/${orderId}/comprobante`} className="inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white">Descargar comprobante PDF</a>}
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted">Cantidad</dt><dd className="font-semibold">{operation.quantity} números</dd></div>
          <div><dt className="text-muted">Importe</dt><dd className="font-semibold">{formatMoney(operation.amountCents, operation.currency)}{operation.isDemo ? " · DEMO" : " · real"}</dd></div>
          <div><dt className="text-muted">Responsable</dt><dd className="font-semibold">{operation.responsible ?? "No disponible"}</dd></div>
          {operation.buyer && <div><dt className="text-muted">Comprador</dt><dd className="font-semibold">{operation.buyer.name}<br /><span className="font-normal">{operation.buyer.email ?? operation.buyer.phone ?? "Sin contacto"}</span></dd></div>}
        </dl>
        {!operation.canSeeBuyers && <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-navy-900">Los datos del comprador y participantes están protegidos. Tu rol no tiene permiso para verlos.</p>}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-navy-950">Números y folios</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {operation.items.map((item) => <li key={`${item.folio ?? "individual"}-${item.number}`} className="rounded-xl border border-line p-3">
            <p className="font-semibold text-navy-950">{item.folio ? `Folio ${item.folio} · ` : ""}{item.number}</p>
            {operation.canSeeBuyers && <p className="mt-1 text-sm text-muted">Participante: {item.participant ? `${item.participant.name} · ${item.participant.email}` : "Sin datos registrados"}</p>}
          </li>)}
        </ul>
        {operation.items.length === 0 && <p className="mt-2 text-sm text-muted">La operación no tiene números vinculados.</p>}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-navy-950">Trazabilidad</h2>
        <ol className="mt-3 space-y-3 border-l-2 border-sky-100 pl-4">
          <li><p className="text-sm font-semibold text-navy-950">{operation.isDemo ? "Reserva DEMO registrada" : "Operación registrada"}</p><time className="text-xs text-muted">{formatZoned(operation.createdAt, tz)}</time></li>
          {operation.canSeeAudit ? operation.trace.map((event, index) => <li key={`${event.action}-${event.createdAt.toISOString()}-${index}`}>
            <p className="text-sm font-semibold text-navy-950">{EVENT_LABEL[event.action] ?? event.action}</p>
            <time className="text-xs text-muted">{formatZoned(event.createdAt, tz)}</time>
            {(event.amountCents !== null || event.itemCount !== null || event.state) && <p className="text-xs text-muted">{event.itemCount !== null ? `${event.itemCount} números` : ""}{event.amountCents !== null ? ` · ${formatMoney(event.amountCents, operation.currency)}` : ""}{event.state ? ` · ${event.state}` : ""}</p>}
          </li>) : <li><p className="text-sm text-muted">Los eventos de auditoría detallados requieren el permiso de auditoría.</p></li>}
          {operation.canSeeAudit && operation.trace.length === 0 && <li><p className="text-sm text-muted">No hay eventos de auditoría adicionales.</p></li>}
        </ol>
      </Card>
    </Container>
  </>;
}
