import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { getSellerPortal } from "@/modules/campaigns/service";
import { formatFolio, formatMoney, formatZoned, getAppTimeZone } from "@/modules/raffles";
import { getPublicRaffleWithId } from "@/modules/raffles/service";
import { NumberPicker } from "@/modules/reservations/number-picker";
import { getReservationConfig } from "@/modules/reservations/service";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = {
  title: "Mis talonarios",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function ResponsablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const portal = await getSellerPortal(db, token);
  if (!portal) notFound();
  const r = await getPublicRaffleWithId(db, portal.raffle.slug);
  if (!r) notFound();
  const cfg = getReservationConfig();
  const tz = getAppTimeZone();

  return (
    <>
      <div className="bg-lime-400 text-navy-950" role="status">
        <Container className="py-2 text-center text-sm font-semibold">Modo demostración: sin pagos ni ventas reales</Container>
      </div>
      <section className="bg-navy-900 text-white">
        <Container className="py-8">
          <Badge tone="demo">Enlace de responsable</Badge>
          <h1 className="mt-3 break-words text-2xl font-bold sm:text-3xl">{r.title}</h1>
          <p className="mt-1 text-sky-100">
            Responsable: {portal.sellerName} · {formatMoney(r.priceCents, r.currency)} por número
          </p>
          {portal.raffle.salesClosesAt && (
            <p className="mt-1 text-sm text-sky-100">
              {portal.salesOpen ? "Cierre de ventas:" : "Ventas cerradas el"} {formatZoned(portal.raffle.salesClosesAt, tz)}
            </p>
          )}
        </Container>
      </section>
      <Container className="space-y-6 py-6">
        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Mis talonarios</h2>
          {portal.folios.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Todavía no tiene talonarios asignados.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {portal.folios.map((f) => (
                <li key={f.folio} className="rounded-xl border border-line p-2 text-center text-sm">
                  <span className="block font-semibold text-navy-900">T-{formatFolio(f.folio)}</span>
                  <span className="block text-xs text-muted">
                    {f.available}/{f.total} libres
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {portal.folios.length > 0 &&
          (portal.salesOpen ? (
            <NumberPicker
              slug={r.slug}
              priceCents={r.priceCents}
              currency={r.currency}
              maxSelection={cfg.maxSelection}
              ttlMinutes={cfg.ttlMinutes}
              mode="booklets"
              sellerToken={token}
            />
          ) : (
            <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              Las ventas están cerradas. Ya no se aceptan nuevas reservas.
            </p>
          ))}
      </Container>
    </>
  );
}
