import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { requireUser } from "@/modules/auth/session";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { UUID_RE, formatFolio, keyWidths, seriesLabel } from "@/modules/raffles";
import { RaffleError, getBookletOverview } from "@/modules/raffles/service";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Talonarios" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { available: "Libre", reserved: "Reservado (demo)", sold: "Vendido" };

export default async function TalonariosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ folio?: string }>;
}) {
  const { id } = await params;
  const { folio: folioRaw } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireUser();
  const folio = folioRaw && /^\d{1,5}$/.test(folioRaw) ? Number(folioRaw) : null;
  let d;
  try {
    d = await getBookletOverview(getDb(), user.id, id, folio);
  } catch (e) {
    if (e instanceof RaffleError || e instanceof AuthorizationError) notFound();
    throw e;
  }
  const { raffle: r, summaries, numbers } = d;
  const w = keyWidths({ bookletCount: r.bookletCount!, numbersPerBooklet: r.numbersPerBooklet!, firstFolio: r.firstFolio! });
  const sel = summaries.find((s) => s.folio === d.folio);

  return (
    <>
      <section className="bg-navy-900 text-white">
        <Container className="py-8">
          <p className="text-sm text-sky-100">Talonarios foliados</p>
          <h1 className="mt-1 break-words text-2xl font-bold sm:text-3xl">{r.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>{r.bookletCount} talonarios</Badge>
            <Badge>{r.numbersPerBooklet} números por talonario</Badge>
            <Badge>{r.numberCount} participaciones</Badge>
          </div>
        </Container>
      </section>
      <Container className="space-y-6 py-6">
        <PanelNav active="rifas" orgId={r.organizationId} />
        <ButtonLink href={`/panel/rifas/${r.id}`} variant="ghost" className="w-full sm:w-auto">
          ← Volver a la rifa
        </ButtonLink>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">Folios</h2>
          <p className="mt-1 text-sm text-muted">
            Serie interna de cada talonario: {seriesLabel(r.numbersPerBooklet!)}. Cada participación se identifica por folio y número.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {summaries.map((s) => (
              <li key={s.folio}>
                <Link
                  href={`/panel/rifas/${r.id}/talonarios?folio=${s.folio}`}
                  aria-current={s.folio === d.folio ? "page" : undefined}
                  className={
                    "block min-h-11 rounded-xl border px-2 py-1.5 text-center text-sm " +
                    (s.folio === d.folio ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-navy-900 hover:bg-sky-100")
                  }
                >
                  <span className="block font-semibold">T-{formatFolio(s.folio, w.folio)}</span>
                  <span className="block text-xs">
                    {s.available}/{s.total} libres
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {sel && (
          <Card>
            <h2 className="text-lg font-semibold text-navy-900">Talonario T-{formatFolio(sel.folio, w.folio)}</h2>
            <p className="mt-1 text-sm text-muted">
              {sel.available} libres · {sel.reserved} reservados (demo) · {sel.sold} vendidos reales
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {numbers.map((n) => (
                <li
                  key={n.label}
                  className={
                    "rounded-lg border px-2 py-1.5 text-center text-sm " +
                    (n.status === "available"
                      ? "border-line bg-white text-navy-900"
                      : n.status === "reserved"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-line bg-gray-100 text-gray-500")
                  }
                >
                  <span className="block whitespace-nowrap font-mono font-semibold">{n.label.split(" / ")[1]}</span>
                  <span className="block text-[11px]">{STATUS[n.status]}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {!sel && <p className="text-sm text-muted">Seleccione un folio para ver su serie y estados.</p>}
      </Container>
    </>
  );
}
