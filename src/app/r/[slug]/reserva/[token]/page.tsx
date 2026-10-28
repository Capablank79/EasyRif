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
        Modo demostración: sin pagos ni compras reales
      </div>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={active ? "demo" : "neutral"}>{STATUS[v.status]}</Badge>
          <span className="text-sm text-muted">ID de reserva: {v.orderId.slice(0, 8).toUpperCase()}</span>
        </div>
        <h1 className="break-words text-2xl font-bold text-navy-900">{v.raffleTitle}</h1>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Números</dt>
            <dd className="break-words font-semibold text-navy-900">{v.labels.join(", ")}</dd>
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
        <p className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">
          Esto es una reserva temporal de demostración. No se realizó ningún pago ni se adquirió participación real en
          la rifa.
          {active ? " Si no la libera, los números volverán a estar disponibles al vencer." : ""}
        </p>
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
        <p className="text-xs text-muted">
          El PDF es una copia de demostración con un código QR que abre la verificación de esta reserva. No se
          actualiza por sí mismo: el estado vigente se consulta escaneando el QR.
        </p>
      </Card>
    </Container>
  );
}
