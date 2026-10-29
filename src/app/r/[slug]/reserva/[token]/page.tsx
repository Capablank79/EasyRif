import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { formatMoney } from "@/modules/raffles";
import { deadlineLabel, formatDateTimeUtc } from "@/modules/receipts/labels";
import { releaseAction } from "@/modules/reservations/actions";
import { getReservation } from "@/modules/reservations/service";
import { isDemoPurchaseConfirmationEnabled } from "@/modules/reservations/service";
import { SimulationConfirmation } from "@/modules/reservations/simulation-confirmation";
import { getDb } from "@/platform/db/client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; token: string }> };

export const metadata: Metadata = {
  title: "Reserva de demostración",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STATUS: Record<string, string> = {
  pending: "Reserva temporal activa",
  cancelled: "Reserva liberada",
  expired: "Reserva vencida",
};

export default async function ReservaPage({ params }: Props) {
  const { slug, token } = await params;
  const v = await getReservation(getDb(), token);
  if (!v || v.raffleSlug !== slug) notFound();
  const active = v.status === "pending";
  return (
    <Container className="max-w-2xl space-y-5 py-8">
      <div className="rounded-xl bg-lime-400 p-3 text-center text-sm font-semibold text-navy-950" role="status">
        SIMULACIÓN — SIN VALIDEZ · No hay pagos ni compras reales
      </div>
      <Card className="space-y-4">
        <ol className="grid gap-2 text-xs sm:grid-cols-3" aria-label="Pasos de compra">
          <li className="rounded-xl bg-emerald-50 p-2 font-semibold text-emerald-900">1. Números seleccionados</li>
          <li className="rounded-xl bg-emerald-50 p-2 font-semibold text-emerald-900">2. Datos registrados</li>
          <li aria-current="step" className="rounded-xl bg-navy-900 p-2 font-semibold text-white">3. Resumen y pago simulado</li>
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={active ? "demo" : "neutral"}>{STATUS[v.status]}</Badge>
          <span className="text-sm text-muted">ID de reserva: {v.orderId.slice(0, 8).toUpperCase()}</span>
        </div>
        <h1 className="break-words text-2xl font-bold text-navy-900">{v.raffleTitle}</h1>
        <h2 className="text-lg font-semibold text-navy-900">Resumen del pedido de demostración</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Números / participaciones ({v.labels.length})</dt>
            <dd className="break-words font-semibold text-navy-900">{v.labels.join(", ")}</dd>
          </div>
          <div>
            <dt className="text-muted">Precio por número</dt>
            <dd className="font-semibold text-navy-900">{formatMoney(v.unitPriceCents, v.currency)}</dd>
          </div>
          <div>
            <dt className="text-muted">Total simulado</dt>
            <dd className="font-semibold text-navy-900">{formatMoney(v.totalCents, v.currency)}</dd>
          </div>
          <div>
            <dt className="text-muted">{deadlineLabel(v.status)}</dt>
            <dd className="font-semibold text-navy-900">{formatDateTimeUtc(v.expiresAt)}</dd>
          </div>
        </dl>
        {v.participants.length > 0 && (
          <div className="rounded-xl border border-line p-3">
            <h3 className="text-sm font-semibold text-navy-900">Participantes por número</h3>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {v.participants.map((p) => <li key={p.label}><span className="font-mono">{p.label}</span> · {p.name}</li>)}
            </ul>
          </div>
        )}
        <p className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">
          Esto es una reserva temporal de demostración. No se realizó ningún pago ni se adquirió participación real en
          la rifa.
          {active ? " Si no la libera, los números volverán a estar disponibles al vencer." : ""}
        </p>
        {v.simulationConfirmedAt && (
          <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Compra y pago ficticios registrados: {formatDateTimeUtc(v.simulationPaidAt ?? v.simulationConfirmedAt)}. El pedido sigue como reserva de demostración; no representa venta ni ingreso real.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/comprobante/${token}`}
            download
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-lime-400 px-5 text-sm font-semibold text-navy-950 hover:bg-lime-300"
          >
            Descargar comprobante de demostración
          </a>
          {active && (
            <form action={releaseAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="slug" value={slug} />
              <button
                type="submit"
                className="min-h-11 rounded-xl border border-navy-900/20 bg-white px-5 text-sm font-semibold text-navy-900 hover:bg-sky-100"
              >
                Liberar mi reserva
              </button>
            </form>
          )}
          <ButtonLink href={`/r/${slug}`} variant="secondary">
            Volver a la rifa
          </ButtonLink>
        </div>
        {active && v.canConfirmSimulation && !v.simulationConfirmedAt && isDemoPurchaseConfirmationEnabled() && (
          <SimulationConfirmation token={token} slug={slug} />
        )}
        <p className="text-xs text-muted">
          El PDF es una copia de demostración con un código QR que abre la verificación de esta reserva. No se
          actualiza por sí mismo: el estado vigente se consulta escaneando el QR.
        </p>
      </Card>
    </Container>
  );
}
