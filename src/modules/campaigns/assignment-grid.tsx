"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { assignBookletsAction, type CampaignFormState } from "./actions";

type Folio = { folio: number; sellerId: string | null; sellerName: string | null };
type Seller = { id: string; displayName: string };
type FolioStatus = "all" | "unassigned" | "assigned";

export function AssignmentGrid({
  raffleId,
  folios,
  sellers,
}: {
  raffleId: string;
  folios: Folio[];
  sellers: Seller[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<FolioStatus>("unassigned");
  const [sellerFilter, setSellerFilter] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [reassignMode, setReassignMode] = useState(false);
  const [optimisticAssignment, setOptimisticAssignment] = useState<{ baseKey: string; folios: number[] } | null>(null);
  const assignmentKey = folios.map((f) => `${f.folio}:${f.sellerId ?? ""}`).join("|");
  const [state, action, pending] = useActionState<CampaignFormState, FormData>(async (previous, formData) => {
    const submitted = selected;
    const wasReassignment = reassignMode;
    const result = await assignBookletsAction(previous, formData);
    if (result.ok) {
      if (!wasReassignment) setOptimisticAssignment((current) => ({
        baseKey: current?.baseKey === assignmentKey ? current.baseKey : assignmentKey,
        folios: [...new Set([...(current?.baseKey === assignmentKey ? current.folios : []), ...submitted])],
      }));
      setSelected([]);
      setReassignMode(false);
      setStatus("unassigned");
      router.refresh();
    }
    return result;
  }, {});

  const selectedFolios = useMemo(() => new Set(selected), [selected]);
  const locallyAssigned = useMemo(() => new Set(optimisticAssignment?.baseKey === assignmentKey ? optimisticAssignment.folios : []), [optimisticAssignment, assignmentKey]);
  const isAssigned = (folio: Folio) => Boolean(folio.sellerId) || locallyAssigned.has(folio.folio);
  const unassignedCount = folios.filter((f) => !isAssigned(f)).length;
  const assignedCount = folios.length - unassignedCount;
  const visible = folios.filter((f) => {
    const matchesQuery = String(f.folio).includes(query.trim());
    const assigned = isAssigned(f);
    const matchesStatus = status === "all" || (status === "assigned" ? assigned : !assigned);
    const matchesSeller = !sellerFilter || f.sellerId === sellerFilter;
    return matchesQuery && matchesStatus && matchesSeller;
  });
  const assignedSelected = selected.filter((folio) => {
    const item = folios.find((f) => f.folio === folio);
    return Boolean(item && isAssigned(item));
  });

  function toggle(folio: number) {
    const item = folios.find((f) => f.folio === folio);
    if (!item) return;
    const assigned = isAssigned(item);
    if ((assigned && !reassignMode) || (!assigned && reassignMode)) return;
    setSelected((prev) => prev.includes(folio) ? prev.filter((n) => n !== folio) : [...prev, folio].sort((a, b) => a - b));
  }

  function beginReassignment(folio: number) {
    setSelected([folio]);
    setReassignMode(true);
    setStatus("assigned");
    setSellerFilter("");
  }

  function cancelReassignment() {
    setSelected([]);
    setReassignMode(false);
    setStatus("unassigned");
  }

  return (
    <section id="folios" aria-labelledby="folios-heading" className="space-y-4">
      <div>
        <h2 id="folios-heading" className="text-lg font-semibold text-navy-900">Asignación visual de folios</h2>
        <p className="mt-1 text-sm text-muted">La vista inicia con los folios sin asignar. Para cambiar un responsable, usa la acción explícita «Reasignar»; el historial se conserva.</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-center text-sm sm:grid-cols-3">
        <div className="rounded-xl border border-line p-2"><dt className="text-muted">Total</dt><dd className="font-bold">{folios.length}</dd></div>
        <div className="rounded-xl border border-line p-2"><dt className="text-muted">Sin asignar</dt><dd className="font-bold">{unassignedCount}</dd></div>
        <div className="rounded-xl border border-line p-2"><dt className="text-muted">Asignados</dt><dd className="font-bold">{assignedCount}</dd></div>
      </dl>

      {state.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">{state.ok}</p>}

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm">
          Buscar folio
          <input type="search" inputMode="numeric" value={query} onChange={(e) => setQuery(e.target.value.replace(/\D/g, ""))} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3" placeholder="Ej. 3" />
        </label>
        <label className="text-sm">
          Estado
          <select value={status} onChange={(e) => setStatus(e.target.value as FolioStatus)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3">
            <option value="unassigned">Sin asignar</option><option value="assigned">Asignados</option><option value="all">Todos</option>
          </select>
        </label>
        <label className="text-sm">
          Responsable
          <select value={sellerFilter} onChange={(e) => setSellerFilter(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line px-3">
            <option value="">Todos</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
          </select>
        </label>
      </div>

      {folios.length === 0 ? (
        <p className="rounded-xl bg-sky-50 p-4 text-sm text-navy-900">Aún no hay folios. Genera los números de esta rifa para poder asignarlos.</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl bg-sky-50 p-4 text-sm text-navy-900">No hay folios con esos filtros.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-label="Folios de la rifa">
          {visible.map((f) => {
            const assigned = isAssigned(f);
            return (
              <li key={f.folio} className="rounded-xl">
                <label className={`flex min-h-16 items-start gap-2 rounded-xl border border-line p-3 text-sm ${assigned && !reassignMode ? "cursor-not-allowed bg-gray-50 opacity-75" : "cursor-pointer bg-white hover:bg-sky-50"}`}>
                  <input type="checkbox" checked={selectedFolios.has(f.folio)} disabled={assigned ? !reassignMode : reassignMode} onChange={() => toggle(f.folio)} className="mt-1 h-4 w-4 accent-navy-900" />
                  <span className="min-w-0">
                    <span className="block font-semibold text-navy-900">T-{String(f.folio).padStart(4, "0")}</span>
                    <span className="block text-xs text-muted">{f.sellerName ? `Asignado · ${f.sellerName}` : assigned ? "Asignado" : "Sin asignar"}</span>
                  </span>
                </label>
                {assigned && !reassignMode && (
                  <button type="button" onClick={() => beginReassignment(f.folio)} className="mt-1 min-h-9 rounded-lg px-3 text-xs font-semibold text-navy-900 underline">Reasignar</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form action={action} onSubmit={(e) => {
        if (reassignMode && (!assignedSelected.length || !window.confirm(`Se reasignarán ${assignedSelected.length} folios. La asignación anterior quedará en el historial y se registrará la acción. ¿Continuar?`))) e.preventDefault();
      }} className="space-y-3 rounded-xl border border-line bg-sky-50 p-3">
        <input type="hidden" name="raffleId" value={raffleId} />
        <input type="hidden" name="folios" value={selected.join(",")} />
        {reassignMode && <input type="hidden" name="allowReassign" value="on" />}
        {reassignMode && <p role="status" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Modo de reasignación: solo puedes mover folios que ya tienen responsable.</p>}
        <label className="block max-w-md text-sm">
          {reassignMode ? "Nuevo responsable" : "Asignar selección a"}
          <select name="sellerId" required defaultValue="" className="mt-1 min-h-11 w-full rounded-xl border border-line bg-white px-3">
            <option value="" disabled>Elige un responsable de esta rifa</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending || selected.length === 0 || sellers.length === 0 || (reassignMode && assignedSelected.length !== selected.length)} className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
          {pending ? "Guardando…" : `${reassignMode ? "Reasignar" : "Asignar"} ${selected.length} folio${selected.length === 1 ? "" : "s"}`}
        </button>
        {reassignMode && <button type="button" disabled={pending} onClick={cancelReassignment} className="min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-navy-900">Cancelar reasignación</button>}
        {!reassignMode && <button type="button" disabled={pending || selected.length === 0} onClick={() => setSelected([])} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-navy-900 underline disabled:opacity-50">Limpiar selección</button>}
        <p className="text-xs text-muted" aria-live="polite">{visible.length} visibles · {selected.length} seleccionados</p>
      </form>
    </section>
  );
}
