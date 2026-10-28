import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { requireOrganizationContext } from "@/modules/auth/session";
import { can } from "@/modules/organizations/permissions";
import { STATUS_LABEL } from "@/modules/raffles";
import { listRaffles } from "@/modules/raffles/service";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Mis rifas" };
export const dynamic = "force-dynamic";

export default async function RifasPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const { user, organizations, active } = await requireOrganizationContext(typeof org === "string" ? org : undefined);
  const list = await listRaffles(getDb(), user.id, active.id);
  const canCreate = can(active.role, "raffle:edit_draft");
  const q = `?org=${active.id}`;

  return (
    <>
      <section className="bg-navy-900 text-white">
        <Container className="py-8">
          <p className="text-sm text-sky-100">{active.name}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Mis rifas</h1>
        </Container>
      </section>
      <Container className="space-y-6 py-6">
        <PanelNav active="rifas" orgId={active.id} />
        {organizations.length > 1 && (
          <nav aria-label="Organizaciones" className="flex flex-wrap gap-2">
            {organizations.map((o) => (
              <Link
                key={o.id}
                href={`/panel/rifas?org=${o.id}`}
                aria-current={o.id === active.id ? "true" : undefined}
                className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-medium hover:bg-sky-100 aria-[current=true]:bg-sky-100"
              >
                {o.name}
              </Link>
            ))}
          </nav>
        )}
        {canCreate && list.length > 0 && (
          <ButtonLink href={`/panel/rifas/nueva${q}`} className="w-full sm:w-auto">
            Nueva rifa
          </ButtonLink>
        )}
        {list.length === 0 ? (
          <Card>
            <h2 className="text-lg font-semibold text-navy-900">Aún no tienes rifas</h2>
            {canCreate ? (
              <>
                <p className="mt-1 text-sm text-muted">Crea un borrador, agrega premios y genera los números.</p>
                <ButtonLink href={`/panel/rifas/nueva${q}`} className="mt-4 w-full sm:w-auto">
                  Crear mi primera rifa
                </ButtonLink>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">Tu rol es de solo lectura.</p>
            )}
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {list.map((r) => (
              <li key={r.id}>
                <Card className="h-full">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="min-w-0 break-words text-lg font-semibold text-navy-900">{r.title}</h2>
                    <Badge tone={r.status === "published" ? "demo" : "neutral"}>{STATUS_LABEL[r.status]}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-muted">Premios</dt>
                      <dd className="font-semibold text-navy-900">{r.prizeCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{r.numberingMode === "booklets" ? "Participaciones" : "Números"}</dt>
                      <dd className="font-semibold text-navy-900">
                        {r.numberCount}
                        {r.numberingMode === "booklets" && (
                          <span className="block text-xs font-normal text-muted">
                            {r.bookletCount} talonarios × {r.numbersPerBooklet}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Generados</dt>
                      <dd className="font-semibold text-navy-900">{r.numberTotal}</dd>
                    </div>
                  </dl>
                  <ButtonLink href={`/panel/rifas/${r.id}`} variant="ghost" className="mt-4 w-full">
                    {r.status === "draft" && can(active.role, "raffle:edit_draft") ? "Administrar" : "Ver detalle"}
                  </ButtonLink>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}
