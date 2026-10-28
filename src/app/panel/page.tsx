import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { requireOrganizationContext } from "@/modules/auth/session";
import { getOrganizationStats } from "@/modules/organizations/stats";
import { can } from "@/modules/organizations/permissions";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Mi panel" };
export const dynamic = "force-dynamic";

const ROLE_LABEL = {
  owner: "Propietario",
  admin: "Administrador",
  editor: "Editor",
  viewer: "Lector",
} as const;

export default async function PanelPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const { user, organizations, active } = await requireOrganizationContext(
    typeof org === "string" ? org : undefined,
  );
  const stats = await getOrganizationStats(getDb(), active.id);
  const canCreate = can(active.role, "raffle:edit_draft");

  const indicators = [
    { label: "Rifas", value: stats.raffles },
    { label: "Números", value: stats.numbers },
    { label: "Vendedores", value: stats.sellers },
  ];

  return (
    <>
      <section className="bg-navy-900 text-white">
        <Container className="py-8">
          <p className="text-sm text-sky-100">Hola, {user.name || user.email}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{active.name}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="demo">{ROLE_LABEL[active.role]}</Badge>
            <Badge>{active.type === "school" ? "Colegio" : "Organizador individual"}</Badge>
          </div>
        </Container>
      </section>

      <Container className="space-y-6 py-6">
        <PanelNav active="resumen" orgId={active.id} />

        {organizations.length > 1 && (
          <nav aria-label="Organizaciones" className="flex flex-wrap gap-2">
            {organizations.map((o) => (
              <Link
                key={o.id}
                href={`/panel?org=${o.id}`}
                aria-current={o.id === active.id ? "true" : undefined}
                className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-medium hover:bg-sky-100 aria-[current=true]:bg-sky-100"
              >
                {o.name}
              </Link>
            ))}
          </nav>
        )}

        <section aria-labelledby="resumen" className="grid gap-4 sm:grid-cols-3">
          <h2 id="resumen" className="sr-only">
            Resumen
          </h2>
          {indicators.map((i) => (
            <Card key={i.label}>
              <p className="text-sm text-muted">{i.label}</p>
              <p className="mt-1 text-3xl font-bold text-navy-900">{i.value}</p>
            </Card>
          ))}
        </section>

        <Card>
          <h2 className="text-lg font-semibold text-navy-900">
            {stats.raffles === 0 ? "Aún no tienes rifas" : "Tus rifas"}
          </h2>
          {canCreate ? (
            <>
              <p className="mt-1 text-sm text-muted">
                {stats.raffles === 0
                  ? "Crea un borrador, agrega premios y genera los números."
                  : "Administra tus rifas desde el listado."}
              </p>
              <ButtonLink
                href={stats.raffles === 0 ? `/panel/rifas/nueva?org=${active.id}` : `/panel/rifas?org=${active.id}`}
                className="mt-4 w-full sm:w-auto"
              >
                {stats.raffles === 0 ? "Crear mi primera rifa" : "Ver mis rifas"}
              </ButtonLink>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">Tu rol es de solo lectura.</p>
              <ButtonLink href={`/panel/rifas?org=${active.id}`} variant="ghost" className="mt-4 w-full sm:w-auto">
                Ver rifas
              </ButtonLink>
            </>
          )}
        </Card>
      </Container>
    </>
  );
}
