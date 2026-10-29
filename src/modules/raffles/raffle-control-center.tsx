"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyLink } from "@/modules/campaigns/copy-link";
import { nextDraftAction } from "./guidance";
import { STATUS_LABEL } from "./validation";
import { formatMoney } from "./validation";
import { formatZoned, getAppTimeZone } from "./campaign";
import type { RaffleListItem } from "./service";

type StatusFilter = "all" | RaffleListItem["status"];
const inputClass = "min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm";

function closeInDays(raffle: RaffleListItem, nowMs: number) {
  if (raffle.status !== "published" || !raffle.salesClosesAt) return null;
  const remaining = new Date(raffle.salesClosesAt).getTime() - nowMs;
  if (remaining < 0 || remaining > 7 * 24 * 60 * 60 * 1000) return null;
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}

function requiresAttention(raffle: RaffleListItem, nowMs: number) {
  return raffle.status === "draft" || raffle.unassignedBooklets > 0 || closeInDays(raffle, nowMs) !== null;
}

export function RaffleControlCenter({
  list,
  canManage,
  canViewSales,
  appUrl,
  nowMs,
}: {
  list: RaffleListItem[];
  canManage: boolean;
  canViewSales: boolean;
  appUrl: string;
  nowMs: number;
}) {
  const timeZone = getAppTimeZone();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const active = list.filter((r) => r.status === "published");
  const summary = active.reduce((totals, r) => ({
    soldSimulated: totals.soldSimulated + r.simulatedSold,
    soldReal: totals.soldReal + r.realSold,
    reservations: totals.reservations + r.activeReservations,
    revenueSimulated: { ...totals.revenueSimulated, [r.currency]: (totals.revenueSimulated[r.currency] ?? 0) + r.simulatedRevenueCents },
    revenueReal: { ...totals.revenueReal, [r.currency]: (totals.revenueReal[r.currency] ?? 0) + r.realRevenueCents },
    unassigned: totals.unassigned + r.unassignedBooklets,
  }), { soldSimulated: 0, soldReal: 0, reservations: 0, revenueSimulated: {} as Record<string, number>, revenueReal: {} as Record<string, number>, unassigned: 0 });
  const amountByCurrency = (amounts: Record<string, number>) => Object.entries(amounts).map(([currency, cents]) => formatMoney(cents, currency)).join(" · ") || formatMoney(0, "CLP");

  const attention = list.flatMap((r) => {
    const alerts: { id: string; message: string; href: string }[] = [];
    if (r.status === "draft") alerts.push({ id: `${r.id}-draft`, message: `${r.title}: borrador pendiente`, href: `/panel/rifas/${r.id}` });
    if (r.unassignedBooklets > 0) alerts.push({
      id: `${r.id}-folios`,
      message: `${r.title}: ${r.unassignedBooklets} talonarios sin asignar`,
      href: `/panel/rifas/${r.id}/responsables#folios`,
    });
    const days = closeInDays(r, nowMs);
    if (days !== null) alerts.push({
      id: `${r.id}-close`,
      message: `${r.title}: cierre ${days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`}`,
      href: `/panel/rifas/${r.id}`,
    });
    return alerts;
  });

  const needle = query.trim().toLocaleLowerCase("es-CL");
  const filtered = list.filter((r) => {
    const matchesText = !needle || r.title.toLocaleLowerCase("es-CL").includes(needle) || r.slug.toLocaleLowerCase("es-CL").includes(needle);
    const matchesStatus = status === "all" || r.status === status;
    const matchesAttention = !attentionOnly || requiresAttention(r, nowMs);
    return matchesText && matchesStatus && matchesAttention;
  });

  return (
    <div className="space-y-6">
      <section aria-labelledby="control-resumen" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="control-resumen" className="text-lg font-semibold text-navy-900">Resumen comercial</h2>
            <p className="text-xs text-muted">Datos de las {active.length} rifas publicadas. DEMO y ventas reales se contabilizan por separado.</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-xl border border-line bg-white p-3"><dt className="text-xs text-muted">Rifas activas</dt><dd className="mt-1 text-xl font-bold text-navy-900">{active.length}</dd></div>
          <div className="rounded-xl border border-line bg-white p-3"><dt className="text-xs text-muted">Números vendidos</dt><dd className="mt-1 text-xl font-bold text-navy-900">{summary.soldSimulated + summary.soldReal}</dd><span className="text-[11px] text-muted">{summary.soldSimulated} DEMO · {summary.soldReal} reales</span></div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><dt className="text-xs text-amber-900">Reservas activas</dt><dd className="mt-1 text-xl font-bold text-amber-950">{summary.reservations}</dd><span className="text-[11px] text-amber-900">No cuentan como ventas</span></div>
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3"><dt className="text-xs text-violet-900">Recaudación simulada · DEMO</dt><dd className="mt-1 text-base font-bold text-violet-950">{amountByCurrency(summary.revenueSimulated)}</dd><span className="text-[11px] text-violet-900">No es ingreso real</span></div>
          <div className="rounded-xl border border-line bg-white p-3"><dt className="text-xs text-muted">Ingresos reales</dt><dd className="mt-1 text-base font-bold text-navy-900">{amountByCurrency(summary.revenueReal)}</dd><span className="text-[11px] text-muted">Pagos confirmados</span></div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3"><dt className="text-xs text-navy-800">Talonarios pendientes</dt><dd className="mt-1 text-xl font-bold text-navy-900">{summary.unassigned}</dd><span className="text-[11px] text-muted">Sin responsable</span></div>
        </dl>
      </section>

      {attention.length > 0 && (
        <section aria-labelledby="attention-title" className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 id="attention-title" className="font-semibold text-amber-950">Requieren atención</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {attention.slice(0, 8).map((alert) => <li key={alert.id}><Link href={alert.href} className="text-sm font-medium text-amber-950 underline decoration-amber-500 underline-offset-2">{alert.message} →</Link></li>)}
          </ul>
          {attention.length > 8 && <p className="mt-2 text-xs text-amber-900">Hay {attention.length - 8} alertas más. Usa el filtro para ver todas las rifas que requieren atención.</p>}
        </section>
      )}

      <section aria-label="Buscar y filtrar rifas" className="grid gap-3 rounded-2xl border border-line bg-white p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
        <label className="text-sm font-medium text-navy-900">Buscar rifa
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre o enlace" className={`${inputClass} mt-1`} />
        </label>
        <label className="text-sm font-medium text-navy-900">Estado
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={`${inputClass} mt-1`}>
            <option value="all">Todos los estados</option>
            {(Object.keys(STATUS_LABEL) as RaffleListItem["status"][]).map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
          </select>
        </label>
        <button type="button" aria-pressed={attentionOnly} onClick={() => setAttentionOnly((v) => !v)} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${attentionOnly ? "border-amber-600 bg-amber-100 text-amber-950" : "border-line bg-white text-navy-900"}`}>
          {attentionOnly ? "✓ Requieren atención" : "Requieren atención"}
        </button>
      </section>

      {filtered.length === 0 ? (
        <Card><p className="text-sm text-muted">No hay rifas que coincidan con estos filtros.</p></Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {filtered.map((r) => {
            const days = closeInDays(r, nowMs);
            const publicUrl = `${appUrl}/r/${encodeURIComponent(r.slug)}`;
            const canShare = r.status === "published";
            return (
              <li key={r.id}>
                <Card className="h-full">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="min-w-0 break-words text-lg font-semibold text-navy-900">{r.title}</h2>
                    <Badge tone={r.status === "published" ? "demo" : "neutral"}>{STATUS_LABEL[r.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{r.numberingMode === "booklets" ? "Talonarios foliados" : "Numeración individual"} · {r.numberTotal}/{r.numberCount} generados · {r.prizeCount} {r.prizeCount === 1 ? "premio" : "premios"}</p>

                  {(r.unassignedBooklets > 0 || days !== null) && <div className="mt-3 space-y-1">
                    {r.unassignedBooklets > 0 && <p className="rounded-lg bg-sky-50 p-2 text-sm text-navy-900">{r.unassignedBooklets} talonarios sin asignar{canManage && r.numberingMode === "booklets" && <Link href={`/panel/rifas/${r.id}/responsables#folios`} className="ml-1 font-semibold underline">Asignar</Link>}</p>}
                    {(r.salesClosesAt || r.drawAt) && <p className="text-xs text-muted">Cierre {r.salesClosesAt ? formatZoned(new Date(r.salesClosesAt), timeZone) : "sin definir"} · Sorteo {r.drawAt ? formatZoned(new Date(r.drawAt), timeZone) : "sin definir"}</p>}
                    {days !== null && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-950">Cierra {days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`}</p>}
                  </div>}

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-sky-50 p-2"><dt className="text-xs text-muted">Total</dt><dd className="font-semibold text-navy-900">{r.numberTotal}</dd></div>
                    <div className="rounded-lg bg-violet-50 p-2"><dt className="text-xs text-muted">Vendidos · DEMO</dt><dd className="font-semibold text-violet-900">{r.simulatedSold}</dd></div>
                    <div className="rounded-lg bg-amber-50 p-2"><dt className="text-xs text-muted">Reservas activas</dt><dd className="font-semibold text-amber-900">{r.activeReservations}</dd></div>
                    <div className="rounded-lg bg-emerald-50 p-2"><dt className="text-xs text-muted">Disponibles</dt><dd className="font-semibold text-emerald-900">{r.availableNumbers}</dd></div>
                    <div className="rounded-lg border border-line p-2"><dt className="text-xs text-muted">Vendidos reales</dt><dd className="font-semibold text-navy-900">{r.realSold}</dd></div>
                    <div className="rounded-lg border border-line p-2"><dt className="text-xs text-muted">Porcentaje vendido</dt><dd className="font-semibold text-navy-900">{r.soldPercent.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%</dd><span className="block text-[10px] text-muted">Reales + DEMO, sin reservas</span></div>
                  </dl>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-2"><dt className="text-[11px] text-violet-900">Ingreso simulado · DEMO</dt><dd className="font-semibold text-violet-950">{formatMoney(r.simulatedRevenueCents, r.currency)}</dd></div>
                    <div className="rounded-lg border border-line p-2"><dt className="text-[11px] text-muted">Ingreso real confirmado</dt><dd className="font-semibold text-navy-900">{formatMoney(r.realRevenueCents, r.currency)}</dd></div>
                  </dl>

                  {r.status === "draft" && <p className="mt-3 rounded-xl bg-sky-50 p-2 text-sm text-navy-900"><span className="font-semibold">Siguiente paso:</span> {nextDraftAction({ prizeCount: r.prizeCount, numberTotal: r.numberTotal, numberCount: r.numberCount }).label}.</p>}
                  <nav aria-label={`Acciones para ${r.title}`} className="mt-4 grid grid-cols-2 gap-2">
                    <ButtonLink href={`/panel/rifas/${r.id}`} variant="ghost" className="w-full px-2">Ver detalle</ButtonLink>
                    {canShare ? <CopyLink url={publicUrl} label="Compartir enlace" compact /> : <button type="button" disabled title="Publica la rifa para compartir su enlace" className="min-h-11 rounded-xl border border-line px-2 text-sm font-semibold text-muted">Compartir enlace</button>}
                    {canManage && (r.numberingMode === "booklets" ? <ButtonLink href={`/panel/rifas/${r.id}/responsables`} variant="ghost" className="w-full px-2">Administrar responsables</ButtonLink> : <button type="button" disabled title="Disponible en rifas con talonarios foliados" className="min-h-11 rounded-xl border border-line px-2 text-sm font-semibold text-muted">Administrar responsables</button>)}
                    {canViewSales ? <ButtonLink href={`/panel/rifas/${r.id}/ventas`} variant="ghost" className="w-full px-2">Consultar ventas</ButtonLink> : <button type="button" disabled title="Tu rol no permite consultar operaciones" className="min-h-11 rounded-xl border border-line px-2 text-sm font-semibold text-muted">Consultar ventas</button>}
                  </nav>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
