import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { deadlineLabel, formatDateTimeUtc } from "@/modules/receipts/labels";
import { getVerification } from "@/modules/receipts/service";
import { rateLimit } from "@/modules/reservations/rate-limit";
import { getDb } from "@/platform/db/client";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verificación de reserva de demostración",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STATUS = {
  pending: { label: "Reserva activa", tone: "demo" as const, note: "La reserva de demostración está vigente hasta su vencimiento." },
  expired: { label: "Reserva vencida", tone: "neutral" as const, note: "La reserva venció y sus números volvieron a estar disponibles." },
  cancelled: { label: "Reserva liberada", tone: "neutral" as const, note: "La reserva fue liberada y sus números volvieron a estar disponibles." },
};

export default async function VerificarPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0, 64);
  const allowed = rateLimit(`verificar:${ip}`, 60, 60_000);
  const v = allowed ? await getVerification(getDb(), codigo.slice(0, 80)) : null;
  return (
    <Container className="max-w-2xl space-y-5 py-8">
      <div className="rounded-xl bg-lime-400 p-3 text-center text-sm font-semibold text-navy-950" role="status">
        SIMULACIÓN — SIN VALIDEZ · DEMOSTRACIÓN — SIN VALIDEZ DE COMPRA NI PARTICIPACIÓN
      </div>
      <Card className="space-y-4">
        {!allowed ? (
          <>
            <h1 className="text-2xl font-bold text-navy-900">Demasiadas consultas</h1>
            <p className="text-sm">Espere un minuto e inténtelo de nuevo.</p>
          </>
        ) : !v ? (
          <>
            <Badge tone="neutral">No verificable</Badge>
            <h1 className="text-2xl font-bold text-navy-900">No se pudo verificar este código</h1>
            <p className="text-sm">El código no corresponde a ninguna reserva de demostración conocida.</p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Badge>
              <span className="text-sm text-muted">Referencia: {v.reference}</span>
            </div>
            <h1 className="break-words text-2xl font-bold text-navy-900">{v.raffleTitle}</h1>
            <p className="text-sm">{STATUS[v.status].note}</p>
            {v.simulationConfirmedAt && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                Se registró una compra y un pago ficticios el {formatDateTimeUtc(v.simulationPaidAt ?? v.simulationConfirmedAt)}. No acredita cobro, venta ni participación real.
              </p>
            )}
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Números de la reserva ({v.numbers.length})</dt>
                <dd className="break-words font-semibold text-navy-900">{v.numbers.join(", ")}</dd>
              </div>
              <div>
                <dt className="text-muted">{deadlineLabel(v.status)}</dt>
                <dd className="font-semibold text-navy-900">{formatDateTimeUtc(v.expiresAt)}</dd>
              </div>
            </dl>
          </>
        )}
        <p className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">
          Esta página es de solo lectura y muestra el estado actual. Una reserva de demostración no acredita pago,
          compra ni participación en ninguna rifa.
        </p>
        <ButtonLink href="/" variant="secondary">
          Ir a EasyRif
        </ButtonLink>
      </Card>
    </Container>
  );
}
