import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PanelNav } from "@/components/layout/panel-nav";
import { requireOrganizationContext } from "@/modules/auth/session";
import { can } from "@/modules/organizations/permissions";
import { RaffleForm } from "@/modules/raffles/forms";
import { CURRENCIES, DEFAULT_CURRENCY, getAppTimeZone, getMaxRaffleNumbers } from "@/modules/raffles";

export const metadata: Metadata = { title: "Nueva rifa" };
export const dynamic = "force-dynamic";

export default async function NuevaRifaPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const { active } = await requireOrganizationContext(typeof org === "string" ? org : undefined);
  if (!can(active.role, "raffle:edit_draft")) notFound();
  return (
    <>
      <section className="bg-navy-900 text-white">
        <Container className="py-8">
          <p className="text-sm text-sky-100">{active.name}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Crear una rifa</h1>
        </Container>
      </section>
      <Container className="space-y-6 py-6">
        <PanelNav active="rifas" orgId={active.id} />
        <Card className="max-w-2xl">
          <p className="mb-4 text-sm text-muted">
            Te guiamos en 3 pasos cortos. Se guardará como borrador: nada es público hasta que tú la publiques. Después podrás agregar premios e imágenes y generar los números.
          </p>
          <RaffleForm
            mode="create"
            organizationId={active.id}
            defaults={{ title: "", description: "", price: "", currency: DEFAULT_CURRENCY, numberCount: "100", drawDate: "" }}
            timeZone={getAppTimeZone()}
            currencies={Object.keys(CURRENCIES)}
            maxNumbers={getMaxRaffleNumbers()}
          />
        </Card>
      </Container>
    </>
  );
}
