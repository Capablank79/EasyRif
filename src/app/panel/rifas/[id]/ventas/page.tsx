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
import { formatMoney, formatZoned, getAppTimeZone, UUID_RE } from "@/modules/raffles";
import { getSalesDashboard, parseSalesFilters, SALE_STATE_LABEL, SalesError } from "@/modules/orders/sales-service";
import { getDb } from "@/platform/db/client";

export const metadata: Metadata = { title: "Ventas de la rifa" };
export const dynamic = "force-dynamic";

const inputCls = "min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-navy-950";

function Metric({ label, value, detail, tone = "" }: { label: string; value: string; detail?: string; tone?: string }) {
  return <div className={`rounded-xl border border-line p-3 ${tone}`}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-xl font-bold text-navy-950">{value}</dd>{detail && <dd className="mt-1 text-xs text-muted">{detail}</dd>}</div>;
}

export default async function SalesPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const user = await requireUser();
  const query = await searchParams;
  const filters = parseSalesFilters(query);
  let data;
  try {
    data = await getSalesDashboard(getDb(), user.id, id, filters);
  } catch (error) {
    if (error instanceof SalesError || error instanceof AuthorizationError) notFound();
    throw error;
  }
  const tz = getAppTimeZone();
  const isBooklets = data.raffle.numberingMode === "booklets";
  const pages = Math.max(1, Math.ceil(data.totalOperations / data.pageSize));
  const queryString = (page: number) => {
    const values = new URLSearchParams();
    if (filters.folio) values.set("folio", String(filters.folio));
    if (filters.number) values.set("number", filters.number);
    if (filters.seller) values.set("seller", filters.seller);
    if (filters.state !== "all") values.set("state", filters.state);
    if (filters.from) values.set("from", filters.from);
    if (filters.to) values.set("to", filters.to);
    if (page > 1) values.set("page", String(page));
    return values.size ? `?${values.toString()}` : "";
  };

  return <>
    <section className="bg-navy-900 text-white"><Container className="py-7">
      <p className="text-sm text-sky-100">Centro de ventas · {data.raffle.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold sm:text-3xl">Ventas</h1><Badge tone="demo">DEMO separado de real</Badge></div>
      <p className="mt-2 max-w-3xl text-sm text-sky-100">Las reservas se muestran como operaciones pendientes; no se suman a los números vendidos ni a los ingresos.</p>
    </Container></section>
    <Container className="space-y-5 py-6">
      <PanelNav active="rifas" orgId={data.raffle.organizationId} />
      <ButtonLink href={`/panel/rifas/${id}`} variant="ghost" className="w-full sm:w-auto">← Volver a la rifa</ButtonLink>

      <section aria-label="Indicadores de ventas" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Metric label="Números vendidos" value={String(data.metrics.soldDemoNumbers + data.metrics.soldRealNumbers)} detail={`${data.metrics.soldDemoNumbers} DEMO · ${data.metrics.soldRealNumbers} reales`} />
        <Metric label="Operaciones confirmadas" value={String(data.metrics.confirmedDemoOperations + data.metrics.confirmedRealOperations)} detail={`${data.metrics.confirmedDemoOperations} DEMO · ${data.metrics.confirmedRealOperations} reales`} />
        <Metric label="Ingresos DEMO" value={formatMoney(data.metrics.simulatedIncomeCents, data.raffle.currency)} detail="Simulados · no son ingresos reales" tone="bg-violet-50" />
        <Metric label="Ingresos reales" value={formatMoney(data.metrics.realIncomeCents, data.raffle.currency)} detail="Pedidos reales confirmados" />
        <Metric label="Reservas activas" value={String(data.metrics.activeReservations)} detail="No cuentan como ventas" tone="bg-amber-50" />
        <Metric label="Números disponibles" value={String(data.metrics.availableNumbers)} detail={`de ${data.metrics.totalNumbers} en total`} tone="bg-emerald-50" />
      </section>

      <Card>
        <h2 className="text-lg font-semibold text-navy-950">Operaciones</h2>
        <form method="get" className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-6" aria-label="Buscar y filtrar operaciones">
          {isBooklets && <label className="text-xs font-medium text-navy-900">Folio
            <input name="folio" inputMode="numeric" defaultValue={filters.folio ?? ""} placeholder="Todos" className={`${inputCls} mt-1`} />
          </label>}
          <label className="text-xs font-medium text-navy-900">Número
            <input name="number" defaultValue={filters.number} placeholder="Buscar número" className={`${inputCls} mt-1`} />
          </label>
          {isBooklets && data.permissions.sellers && <label className="text-xs font-medium text-navy-900">Responsable
            <input name="seller" defaultValue={filters.seller} placeholder="Nombre" className={`${inputCls} mt-1`} />
          </label>}
          <label className="text-xs font-medium text-navy-900">Estado
            <select name="state" defaultValue={filters.state} className={`${inputCls} mt-1`}>
              <option value="all">Todos</option>
              {Object.entries(SALE_STATE_LABEL).map(([state, label]) => <option key={state} value={state}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-navy-900">Desde
            <input name="from" type="date" defaultValue={filters.from} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs font-medium text-navy-900">Hasta
            <input name="to" type="date" defaultValue={filters.to} className={`${inputCls} mt-1`} />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
            <button className="min-h-11 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white">Buscar</button>
            <Link href={`/panel/rifas/${id}/ventas`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold text-navy-900">Limpiar</Link>
          </div>
        </form>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[850px] border-collapse text-left text-sm">
            <thead className="bg-sky-50 text-xs text-navy-900"><tr>
              <th className="p-3">Fecha · tipo</th>{isBooklets && <th className="p-3">Folio</th>}<th className="p-3">Números</th>{isBooklets && <th className="p-3">Responsable</th>}<th className="p-3">Cant.</th><th className="p-3">Importe</th><th className="p-3">Estado</th>
            </tr></thead>
            <tbody>
              {data.operations.map((op) => <tr key={op.id} className="border-t border-line align-top">
                <td className="p-3"><Link href={`/panel/rifas/${id}/ventas/${op.id}`} className="font-semibold text-navy-900 underline underline-offset-2">{formatZoned(op.createdAt, tz)}</Link><span className={`mt-1 block text-xs font-semibold ${op.isDemo ? "text-violet-800" : "text-emerald-800"}`}>{op.isDemo ? "DEMO" : "Real"}</span></td>
                {isBooklets && <td className="p-3">{op.folios.length ? op.folios.join(", ") : "—"}</td>}
                <td className="max-w-64 whitespace-normal p-3">{op.numbers.length ? op.numbers.join(", ") : "—"}</td>
                {isBooklets && <td className="p-3">{op.responsible ?? "—"}</td>}<td className="p-3">{op.quantity}</td>
                <td className="whitespace-nowrap p-3">{formatMoney(op.amountCents, op.currency)}</td>
                <td className="p-3"><Badge tone={op.state === "sold_demo" ? "demo" : "neutral"}>{SALE_STATE_LABEL[op.state]}</Badge></td>
              </tr>)}
              {data.operations.length === 0 && <tr><td colSpan={isBooklets ? 7 : 5} className="p-6 text-center text-sm text-muted">No hay operaciones para estos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted">{data.totalOperations} operaciones · página {data.page} de {pages}</p>
          <nav aria-label="Paginación de operaciones" className="flex gap-2">
            {data.page > 1 && <Link href={`/panel/rifas/${id}/ventas${queryString(data.page - 1)}`} className="inline-flex min-h-10 items-center rounded-lg border border-line px-3">← Anterior</Link>}
            {data.page < pages && <Link href={`/panel/rifas/${id}/ventas${queryString(data.page + 1)}`} className="inline-flex min-h-10 items-center rounded-lg border border-line px-3">Siguiente →</Link>}
          </nav>
        </div>
      </Card>

      {isBooklets && data.permissions.sellers && <Card>
        <h2 className="text-lg font-semibold text-navy-950">Resumen por responsable</h2>
        <p className="mt-1 text-xs text-muted">Los ingresos DEMO y reales se mantienen separados. Las reservas no se cuentan como vendidos.</p>
        {data.sellers.length === 0 ? <p className="mt-3 text-sm text-muted">Esta rifa no tiene responsables.</p> : <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-sky-50 text-xs"><tr><th className="p-2">Responsable</th><th className="p-2">Talonarios asignados</th><th className="p-2">Números vendidos</th><th className="p-2">Ingreso DEMO</th><th className="p-2">Ingreso real</th></tr></thead>
            <tbody>{data.sellers.map((seller) => <tr key={seller.id} className="border-t border-line"><td className="p-2">{seller.name}{seller.status === "revoked" && <span className="ml-2 text-xs text-muted">Revocado</span>}</td><td className="p-2">{seller.assignedBooklets}</td><td className="p-2">{seller.soldNumbers}</td><td className="p-2 text-violet-900">{formatMoney(seller.simulatedIncomeCents, data.raffle.currency)}</td><td className="p-2">{formatMoney(seller.realIncomeCents, data.raffle.currency)}</td></tr>)}</tbody>
          </table>
        </div>}
      </Card>}
    </Container>
  </>;
}
