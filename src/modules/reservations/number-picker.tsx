"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reserveAction, type ReserveState } from "@/modules/reservations/actions";
import { formatMoney } from "@/modules/raffles/validation";
import { participationLabel } from "@/modules/raffles/booklets";
import { MAX_PARTICIPANTS_PAYLOAD } from "./participants";

type Status = "available" | "reserved" | "simulated_sold" | "sold";
type Filter = "all" | Status;
interface PageData {
  items: { number: string; label: string; folio: number | null; status: Status }[];
  total: number;
  page: number;
  pageSize: number;
  counts: { available: number; reserved: number; simulatedSold: number; sold: number; total: number };
  booklets: { folio: number; total: number; available: number; reserved: number; simulatedSold: number; sold: number }[] | null;
}

const LABEL: Record<Status, string> = { available: "Disponible", reserved: "Reservado", simulated_sold: "Vendido (simulado)", sold: "Vendido" };
const COUNT_LABEL: Record<Status, string> = { available: "Disponibles", reserved: "Reservados", simulated_sold: "Vendidos (simulado)", sold: "Vendidos reales" };
const PAGE_SIZE = 100;
const newKey = () => crypto.randomUUID().replace(/-/g, "");

export function NumberPicker({
  slug,
  priceCents,
  currency,
  maxSelection,
  ttlMinutes,
  mode = "individual",
  sellerToken,
}: {
  slug: string;
  priceCents: number;
  currency: string;
  maxSelection: number;
  ttlMinutes: number;
  mode?: "individual" | "booklets";
  /** Enlace de responsable: restringe a sus talonarios y atribuye el pedido. */
  sellerToken?: string;
}) {
  const isBooklets = mode === "booklets";
  const [parts, setParts] = useState<Record<string, { name: string; email: string; phone: string }>>({});
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const selectionLimit = Math.min(maxSelection, MAX_PARTICIPANTS_PAYLOAD);
  const [folio, setFolio] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("available");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [requestKey, setRequestKey] = useState("");
  const [showForm, setShowForm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (showForm) formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [showForm]);
  const [reloadTick, setReloadTick] = useState(0);
  const [state, formAction, pending] = useActionState<ReserveState, FormData>(async (prev, fd) => {
    const res = await reserveAction(prev, fd);
    // Si el servidor informa numeros ya tomados, se quitan de la seleccion y se refresca.
    if (res.unavailable?.length) {
      const remaining = selected.filter((n) => !res.unavailable!.includes(n));
      setSelected(remaining);
      if (remaining.length === 0) setShowForm(false);
      setRequestKey(newKey());
      setReloadTick((t) => t + 1);
    }
    return res;
  }, {});

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ q, filter, page: String(page), pageSize: String(PAGE_SIZE) });
        if (folio) p.set("folio", folio);
        if (sellerToken) p.set("seller", sellerToken);
        const res = await fetch(`/api/rifas/${encodeURIComponent(slug)}/numeros?${p}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error("http");
        setData((await res.json()) as PageData);
        setLoadError(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setLoadError(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [slug, q, filter, page, folio, reloadTick, sellerToken]);

  // Si el servidor informa numeros ya tomados, se quitan de la seleccion y se refresca.
  const toggle = useCallback(
    (n: string) => {
      setSelected((s) => {
        if (s.includes(n)) return s.filter((x) => x !== n);
        if (s.length >= selectionLimit) return s;
        return [...s, n];
      });
      setRequestKey(newKey());
    },
    [selectionLimit],
  );

  const total = selected.length * priceCents;
  const sorted = useMemo(() => [...selected].sort(), [selected]);
  const shown = (n: string) => participationLabel(n, isBooklets);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const atLimit = selected.length >= selectionLimit;

  return (
    <section aria-labelledby="selector-titulo" className="space-y-4 pb-28 sm:pb-6">
      <div>
        <h2 id="selector-titulo" className="text-xl font-bold text-navy-900">
          Elija sus números
        </h2>
        <p className="text-sm text-muted">
          Reserva temporal de demostración: dura {ttlMinutes} minutos y no implica pago ni participación real.
        </p>
        <ol className="mt-3 grid gap-2 text-sm text-navy-900 sm:grid-cols-3" aria-label="Pasos de compra">
          <li aria-current={!showForm ? "step" : undefined} className={`rounded-xl p-2 ${!showForm ? "bg-navy-900 font-semibold text-white" : "bg-sky-50"}`}>
            1. Seleccionar números
          </li>
          <li aria-current={showForm ? "step" : undefined} className={`rounded-xl p-2 ${showForm ? "bg-navy-900 font-semibold text-white" : "bg-sky-50"}`}>
            2. Datos del comprador y participantes
          </li>
          <li className="rounded-xl bg-sky-50 p-2">3. Resumen y pago simulado</li>
        </ol>
        {isBooklets && (
          <p className="mt-2 text-xs text-muted">
            Cada participación se identifica con folio y número. Ejemplo: T-0003 / N-15 es el número 15 del talonario 3.
          </p>
        )}
        {sellerToken && (
          <p role="note" className="mt-2 rounded-xl bg-sky-100 p-2 text-sm text-navy-900">
            Estás usando el enlace personal de un responsable: solo verás los talonarios que se le asignaron y las reservas se asociarán a ese responsable.
          </p>
        )}
      </div>

      {!showForm && state.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {state.error}{state.unavailable?.length ? ` (${state.unavailable.map(shown).join(", ")})` : ""}
        </p>
      )}

      {!showForm && <>
      {data && (
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(["available", "reserved", "simulated_sold", "sold"] as const).map((s) => (
            <div key={s} className="rounded-xl border border-line bg-white p-2">
              <dt className="text-xs text-muted">{COUNT_LABEL[s]}</dt>
              <dd className="text-lg font-bold text-navy-900">{s === "simulated_sold" ? data.counts.simulatedSold : data.counts[s]}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex-1 text-sm">
          <span className="sr-only">Buscar número</span>
          <input
            type="search"
            inputMode="numeric"
            placeholder={isBooklets ? "Buscar número interno (ej. 14)" : "Buscar número (ej. 045)"}
            value={q}
            maxLength={12}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3"
          />
        </label>
        {isBooklets && data?.booklets && (
          <label className="text-sm">
            <span className="sr-only">Talonario</span>
            <select
              value={sellerToken ? folio || String(data.booklets[0]?.folio ?? "") : folio}
              onChange={(e) => {
                setFolio(e.target.value);
                setPage(1);
              }}
              className="min-h-11 w-full rounded-xl border border-line bg-white px-3 sm:w-56"
            >
              {!sellerToken && <option value="">Todos los talonarios</option>}
              {data.booklets.map((b) => (
                <option key={b.folio} value={b.folio} disabled={b.available === 0}>
                  {`T-${String(b.folio).padStart(4, "0")} · ${b.available} libres`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="sr-only">Filtrar por estado</span>
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as Filter);
              setPage(1);
            }}
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3 sm:w-48"
          >
            <option value="available">Solo disponibles</option>
            <option value="all">Todos</option>
            <option value="reserved">Reservados</option>
            <option value="sold">Vendidos</option>
            <option value="simulated_sold">Vendidos (simulado)</option>
          </select>
        </label>
      </div>

      {loadError && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          No se pudieron cargar los números.{" "}
          <button type="button" className="font-semibold underline" onClick={() => setReloadTick((t) => t + 1)}>
            Reintentar
          </button>
        </p>
      )}

      <div aria-busy={loading} role="group" aria-label="Números de la rifa" className="min-h-40">
        {data && data.items.length === 0 && !loading && (
          <p className="rounded-xl bg-sky-50 p-4 text-sm text-navy-900">
            No hay números que coincidan. Prueba con otro número o cambia el filtro a «Todos».
          </p>
        )}
        <ul
          className={
            isBooklets
              ? "grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
              : "grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10"
          }
        >
          {data?.items.map((it) => {
            const isSel = selected.includes(it.number);
            const free = it.status === "available";
            const blocked = !free || (!isSel && atLimit);
            return (
              <li key={it.number}>
                <button
                  type="button"
                  disabled={blocked}
                  aria-pressed={isSel}
                  aria-label={`${isBooklets ? "Participación" : "Número"} ${it.label}, ${isSel ? "seleccionado" : LABEL[it.status].toLowerCase()}`}
                  onClick={() => toggle(it.number)}
                  className={
                    "flex min-h-11 w-full flex-col items-center justify-center rounded-lg border px-1 py-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-900 " +
                    (isSel
                      ? "border-navy-900 bg-navy-900 text-white"
                      : free
                        ? "border-line bg-white text-navy-900 hover:bg-sky-100"
                        : it.status === "reserved"
                          ? "border-amber-300 bg-amber-50 text-amber-900"
                          : it.status === "simulated_sold"
                            ? "border-violet-300 bg-violet-50 text-violet-900"
                          : "border-line bg-gray-100 text-gray-500 line-through")
                  }
                >
                  <span className="whitespace-nowrap">{it.label}</span>
                  <span className="text-[10px] font-normal leading-none">
                    {isSel ? "Elegido" : free ? "Libre" : LABEL[it.status]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {data && data.total > data.pageSize && (
        <nav aria-label="Paginación de números" className="flex items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="min-h-11 rounded-xl border border-line bg-white px-4 font-semibold disabled:opacity-50"
          >
            Anterior
          </button>
          <span aria-live="polite">
            Página {page} de {pages} · {data.total} {isBooklets ? "participaciones" : "números"}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="min-h-11 rounded-xl border border-line bg-white px-4 font-semibold disabled:opacity-50"
          >
            Siguiente
          </button>
        </nav>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white p-3 shadow-lg sm:static sm:rounded-2xl sm:border sm:shadow-none">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 text-sm" aria-live="polite">
            <p className="font-semibold text-navy-900">
              {selected.length === 0
                ? `Elige al menos ${isBooklets ? "una participación" : "un número"} para continuar`
              : `${selected.length} de ${selectionLimit} · ${formatMoney(total, currency)}`}
            </p>
            {selected.length > 0 && <p className="truncate text-muted">{sorted.map(shown).join(", ")}</p>}
            {atLimit && <p className="text-xs text-amber-800">Alcanzó el máximo de {selectionLimit} números.</p>}
          </div>
          <div className="flex gap-2">
            {selected.length > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setSelected([]);
                  setShowForm(false);
                }}
                className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold disabled:opacity-60"
              >
                Limpiar
              </button>
            )}
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => {
                setRequestKey(newKey());
                setShowForm(true);
              }}
              className="min-h-11 rounded-xl bg-lime-400 px-5 text-sm font-semibold text-navy-950 hover:bg-lime-300 disabled:opacity-50"
            >
              Reservar (demo)
            </button>
          </div>
        </div>
      </div>
      </>}

      {showForm && selected.length > 0 && (
        <form
          ref={formRef}
          action={formAction}
          className="space-y-3 rounded-2xl border border-line bg-white p-4"
          aria-labelledby="form-reserva-titulo"
        >
          <h3 id="form-reserva-titulo" className="font-bold text-navy-900">
            Paso 2: datos del comprador y participantes
          </h3>
          <p className="rounded-xl bg-sky-50 p-3 text-sm text-navy-900">
            Selección: <span className="font-semibold">{sorted.map(shown).join(", ")}</span> · {formatMoney(priceCents, currency)} por número · Total simulado{" "}
            <span className="font-semibold">{formatMoney(total, currency)}</span>. La reserva dura {ttlMinutes} minutos.
          </p>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="numbers" value={sorted.join(",")} />
          <input type="hidden" name="requestKey" value={requestKey} />
          {sellerToken && <input type="hidden" name="sellerToken" value={sellerToken} />}
          <input
              type="hidden"
              name="participants"
              value={JSON.stringify(Object.fromEntries(sorted.map((n) => [n, parts[n] ?? { name: "", email: "", phone: "" }])))}
          />
          <label className="block text-sm">
            Nombre del comprador
            <input name="name" required minLength={2} maxLength={100} autoComplete="name" value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" />
          </label>
          <label className="block text-sm">
            Correo (opcional si indica teléfono)
            <input name="email" type="email" maxLength={254} autoComplete="email" value={buyer.email} onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" />
          </label>
          <label className="block text-sm">
            Teléfono (opcional si indica correo)
            <input name="phone" type="tel" maxLength={20} autoComplete="tel" value={buyer.phone} onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" />
          </label>
          <fieldset className="space-y-3 rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-semibold text-navy-900">
                Participante de cada número ({sorted.length})
              </legend>
              <p className="text-xs text-muted">
                Indica quién participa con cada número. Puedes registrar al comprador o a otra persona; el teléfono es opcional.
              </p>
              <button
                type="button"
                onClick={() => {
                  setParts((p) => ({ ...p, ...Object.fromEntries(sorted.map((n) => [n, { ...buyer }])) }));
                }}
                className="min-h-11 rounded-xl border border-line px-3 text-sm font-semibold"
              >
                Copiar los datos del comprador a todos
              </button>
              {sorted.map((n, i) => {
                const v = parts[n] ?? { name: "", email: "", phone: "" };
                const set = (k: "name" | "email" | "phone", val: string) =>
                  setParts((p) => ({ ...p, [n]: { ...(p[n] ?? { name: "", email: "", phone: "" }), [k]: val } }));
                return (
                  <div key={n} className="space-y-2 rounded-lg bg-sky-50 p-3">
                    <p className="font-mono text-sm font-semibold text-navy-900">{shown(n)}</p>
                    <label className="block text-sm">
                      Nombre del participante
                      <input aria-label={`Nombre del participante ${i + 1}`} required minLength={2} maxLength={100} value={v.name} onChange={(e) => set("name", e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" />
                    </label>
                    <label className="block text-sm">
                      Correo del participante
                      <input aria-label={`Correo del participante ${i + 1}`} type="email" required maxLength={254} value={v.email} onChange={(e) => set("email", e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" />
                    </label>
                    <label className="block text-sm">
                      Teléfono (opcional)
                      <input aria-label={`Teléfono del participante ${i + 1}`} type="tel" maxLength={20} value={v.phone} onChange={(e) => set("phone", e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" />
                    </label>
                  </div>
                );
              })}
              <label className="flex min-h-11 items-start gap-2 text-sm text-navy-900">
                <input type="checkbox" name="consent" required className="mt-1" />
                <span>
                  Confirmo que cuento con autorización para registrar los datos de cada participante en esta demostración.
                </span>
              </label>
          </fieldset>
          <p className="text-xs text-muted">
            Solo se guardan para esta demostración. No se realiza ningún cobro.
          </p>
          {state.error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {state.error}
              {state.unavailable?.length ? ` (${state.unavailable.map(shown).join(", ")})` : ""}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 w-full rounded-xl bg-navy-900 px-5 text-sm font-semibold text-white hover:bg-navy-700 disabled:opacity-60 sm:w-auto"
          >
            {pending ? "Guardando reserva…" : "Crear reserva demo y ver resumen"}
          </button>
          <button type="button" disabled={pending} onClick={() => setShowForm(false)} className="min-h-11 rounded-xl border border-line px-5 text-sm font-semibold text-navy-900 disabled:opacity-60">
            Volver a seleccionar números
          </button>
        </form>
      )}
    </section>
  );
}
