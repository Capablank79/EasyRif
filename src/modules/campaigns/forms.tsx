"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  assignBookletsAction,
  createSellerAction,
  extendSalesAction,
  revokeSellerAction,
  unassignBookletsAction,
  type CampaignFormState,
} from "./actions";

const inputCls =
  "mt-1 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-navy-950 focus:border-navy-700 focus:outline-2 focus:outline-offset-2 focus:outline-navy-700";

function Msg({ state }: { state: CampaignFormState }) {
  if (state.error)
    return (
      <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">
        {state.ok}
      </p>
    );
  return null;
}

function L({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-navy-900">
      {children}
    </label>
  );
}

export function CreateSellerForm({ raffleId }: { raffleId: string }) {
  const [state, action, pending] = useActionState<CampaignFormState, FormData>(createSellerAction, {});
  return (
    <form action={action} className="space-y-3" key={state.ok ?? "f"}>
      <input type="hidden" name="raffleId" value={raffleId} />
      <Msg state={state} />
      <div>
        <L htmlFor="displayName">Nombre del responsable</L>
        <input id="displayName" name="displayName" required minLength={2} maxLength={80} className={inputCls} />
      </div>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Creando…" : "Crear responsable"}
      </Button>
    </form>
  );
}

export function AssignForm({
  raffleId,
  sellers,
}: {
  raffleId: string;
  sellers: { id: string; displayName: string }[];
}) {
  const [state, action, pending] = useActionState<CampaignFormState, FormData>(assignBookletsAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="raffleId" value={raffleId} />
      <Msg state={state} />
      <div>
        <L htmlFor="sellerId">Responsable</L>
        <select id="sellerId" name="sellerId" required className={inputCls} defaultValue="">
          <option value="" disabled>
            Seleccione…
          </option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
      </div>
      <div>
        <L htmlFor="folios">Folios (ej. 1-5, 8)</L>
        <input id="folios" name="folios" required className={inputCls} inputMode="numeric" />
      </div>
      <label className="flex min-h-11 items-start gap-2 text-sm text-navy-900">
        <input type="checkbox" name="allowReassign" className="mt-1" />
        <span>
          Confirmo la <strong>reasignación</strong> de los folios que ya tengan responsable. El responsable anterior pierde acceso a
          esos talonarios; el historial y los pedidos existentes se conservan.
        </span>
      </label>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Asignando…" : "Asignar talonarios"}
      </Button>
    </form>
  );
}

export function UnassignForm({ raffleId }: { raffleId: string }) {
  const [state, action, pending] = useActionState<CampaignFormState, FormData>(unassignBookletsAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="raffleId" value={raffleId} />
      <Msg state={state} />
      <div>
        <L htmlFor="unfolios">Folios a dejar sin responsable</L>
        <input id="unfolios" name="folios" required className={inputCls} inputMode="numeric" />
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
        Quitar responsable
      </Button>
    </form>
  );
}

export function RevokeSellerForm({ raffleId, sellerId }: { raffleId: string; sellerId: string }) {
  const [state, action, pending] = useActionState<CampaignFormState, FormData>(revokeSellerAction, {});
  const [confirm, setConfirm] = useState(false);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="raffleId" value={raffleId} />
      <input type="hidden" name="sellerId" value={sellerId} />
      <Msg state={state} />
      {confirm ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
            Confirmar revocación
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirm(false)} className="w-full sm:w-auto">
            Cancelar
          </Button>
        </div>
      ) : (
        <Button type="button" variant="ghost" onClick={() => setConfirm(true)} className="w-full sm:w-auto">
          Revocar enlace
        </Button>
      )}
    </form>
  );
}

export function ExtendForm({ raffleId, timeZone }: { raffleId: string; timeZone: string }) {
  const [state, action, pending] = useActionState<CampaignFormState, FormData>(extendSalesAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="raffleId" value={raffleId} />
      <Msg state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <L htmlFor="ext-close">Nuevo cierre de ventas ({timeZone})</L>
          <input id="ext-close" name="salesClosesAt" type="datetime-local" required className={inputCls} />
        </div>
        <div>
          <L htmlFor="ext-draw">Nueva fecha de sorteo</L>
          <input id="ext-draw" name="drawAt" type="datetime-local" required className={inputCls} />
        </div>
      </div>
      <div>
        <L htmlFor="ext-reason">Motivo (queda auditado)</L>
        <input id="ext-reason" name="reason" required minLength={5} maxLength={300} className={inputCls} />
      </div>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Guardando…" : "Extender plazo"}
      </Button>
    </form>
  );
}
