import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { formatMoney, formatZoned, getAppTimeZone, isSalesClosed, utcToZonedDateInput } from "@/modules/raffles";
import { getPublicRaffleWithId } from "@/modules/raffles/service";
import { NumberPicker } from "@/modules/reservations/number-picker";
import { expireCampaignReservations, getPublicCounts, getReservationConfig } from "@/modules/reservations/service";
import { getDb } from "@/platform/db/client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await getPublicRaffleWithId(getDb(), slug);
  if (!r) return { title: "Rifa no encontrada", robots: { index: false } };
  const description = (r.description ?? `Rifa ${r.title} en EasyRif`).slice(0, 160);
  return {
    title: r.title,
    description,
    openGraph: {
      title: r.title,
      description,
      type: "website",
      url: `${appUrl()}/r/${r.slug}`,
      images: r.imageKey ? [`${appUrl()}/api/imagenes/${r.imageKey}`] : undefined,
    },
  };
}

function Placeholder({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-navy-900 to-navy-700 text-3xl text-lime-400"
    >
      ★
    </div>
  );
}

export default async function RifaPublicaPage({ params }: Props) {
  const { slug } = await params;
  const db = getDb();
  const r = await getPublicRaffleWithId(db, slug);
  if (!r) notFound();
  await expireCampaignReservations(db, r.id);
  const counts = await getPublicCounts(db, r.id);
  const cfg = getReservationConfig();
  const tz = getAppTimeZone();
  const salesClosed = isSalesClosed(r.salesClosesAt);
  const shareUrl = `${appUrl()}/r/${r.slug}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${r.title} — ${shareUrl}`)}`;

  return (
    <>
      <div className="bg-lime-400 text-navy-950" role="status">
        <Container className="py-2 text-center text-sm font-semibold">
          Modo demostración: sin pagos ni compras reales
        </Container>
      </div>
      <section className="bg-navy-900 text-white">
        <Container className="grid gap-6 py-8 md:grid-cols-[1fr_420px] md:items-center">
          <div className="min-w-0">
            <Badge tone="demo">Rifa publicada</Badge>
            <h1 className="mt-3 break-words text-3xl font-bold md:text-4xl">{r.title}</h1>
            <p className="mt-2 text-lg text-sky-100">
              {formatMoney(r.priceCents, r.currency)} por número · {r.numberCount} números
            </p>
            {r.description && <p className="mt-4 whitespace-pre-line break-words text-sky-100">{r.description}</p>}
            {r.salesClosesAt && (
              <p className="mt-3 text-sm text-sky-100">
                {salesClosed ? "Ventas cerradas el" : "Cierre de ventas:"} {formatZoned(r.salesClosesAt, tz)}
                {r.drawAt ? ` · Sorteo previsto: ${formatZoned(r.drawAt, tz)} (el sorteo no se ejecuta en esta fase)` : ""}
              </p>
            )}
            {r.endsAt && !r.salesClosesAt && (
              <p className="mt-3 text-sm text-sky-100">
                Fecha estimada del sorteo: {utcToZonedDateInput(r.endsAt, tz)} (informativa).
              </p>
            )}
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-white/40 px-5 text-sm font-semibold text-white hover:bg-white/10"
            >
              Compartir por WhatsApp
            </a>
          </div>
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-navy-700">
            {r.imageKey ? (
              <Image
                src={`/api/imagenes/${r.imageKey}`}
                alt={`Imagen de la rifa ${r.title}`}
                fill
                unoptimized
                priority
                sizes="(min-width: 768px) 420px, 100vw"
                className="object-cover"
              />
            ) : (
              <Placeholder label="Sin imagen de la rifa" />
            )}
          </div>
        </Container>
      </section>

      <Container className="space-y-8 py-6">
        <section aria-labelledby="premios">
          <h2 id="premios" className="text-xl font-bold text-navy-900">
            Premios
          </h2>
          <ol className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {r.prizes.map((p, i) => (
              <li key={i}>
                <Card className="h-full overflow-hidden p-0">
                  <div className="relative aspect-video bg-sky-100">
                    {p.imageKey ? (
                      <Image
                        src={`/api/imagenes/${p.imageKey}`}
                        alt={`Premio: ${p.title}`}
                        fill
                        unoptimized
                        sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                        className="object-cover"
                      />
                    ) : (
                      <Placeholder label="Premio sin imagen" />
                    )}
                    <span className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-lime-400 text-xs font-bold text-navy-950">
                      {i + 1}
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="break-words font-semibold text-navy-900">{p.title}</p>
                    {p.description && <p className="mt-1 break-words text-sm text-muted">{p.description}</p>}
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        {salesClosed ? (
          <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Las ventas de esta campaña están cerradas. Ya no se aceptan nuevas reservas.
          </p>
        ) : (
          <NumberPicker
            slug={r.slug}
            priceCents={r.priceCents}
            currency={r.currency}
            maxSelection={cfg.maxSelection}
            ttlMinutes={cfg.ttlMinutes}
            mode={r.numberingMode}
          />
        )}
        <p className="sr-only">
          {counts.available} números disponibles, {counts.reserved} reservados, {counts.sold} vendidos.
        </p>
      </Container>
    </>
  );
}
