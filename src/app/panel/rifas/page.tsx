import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { requireOrganizationContext } from "@/modules/auth/session";
import { can } from "@/modules/organizations/permissions";
import { RaffleControlCenter } from "@/modules/raffles/raffle-control-center";
import { listRaffles } from "@/modules/raffles/service";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Mis rifas" };
export const dynamic = "force-dynamic";

export default async function RifasPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const { user, organizations, active } = await requireOrganizationContext(typeof org === "string" ? org : undefined);
  const list = await listRaffles(getDb(), user.id, active.id);
  const canCreate = can(active.role, "raffle:edit_draft");
  const canManage = can(active.role, "sellers:manage");
  const q = `?org=${active.id}`;
  const nowMs = new Date().getTime();

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
                <p className="mt-1 text-sm text-muted">Te guiamos paso a paso: creas un borrador, agregas premios con fotos, generas los números y la publicas.</p>
                <ButtonLink href={`/panel/rifas/nueva${q}`} className="mt-4 w-full sm:w-auto">
                  Crear mi primera rifa
                </ButtonLink>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">Tu rol es de solo lectura.</p>
            )}
          </Card>
        ) : <RaffleControlCenter list={list} canManage={canManage} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"} nowMs={nowMs} />}
      </Container>
    </>
  );
}
