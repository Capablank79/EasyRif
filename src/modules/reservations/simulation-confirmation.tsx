"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { confirmSimulatedPurchaseAction, type ConfirmSimulationState } from "./actions";

export function SimulationConfirmation({ token, slug }: { token: string; slug: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ConfirmSimulationState, FormData>(async (previous, formData) => {
    const result = await confirmSimulatedPurchaseAction(previous, formData);
    if (result.ok) router.refresh();
    return result;
  }, {});
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-950">SIMULACIÓN — SIN VALIDEZ</p>
      <p className="text-sm text-navy-900">Registra una compra y un pago ficticios para practicar el recorrido. No cobra, no confirma una venta y no extiende el tiempo de reserva.</p>
      {state.error && <p role="alert" className="text-sm text-red-800">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm font-semibold text-navy-900">{state.ok}</p>}
      <form action={action} onSubmit={(e) => {
        if (!window.confirm("Registrar una compra y un pago ficticios. El pedido seguirá como reserva demo y no habrá cobro. ¿Continuar?")) e.preventDefault();
      }}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="slug" value={slug} />
        <button type="submit" disabled={pending} className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
          {pending ? "Registrando simulación…" : "Simular compra y pago"}
        </button>
      </form>
    </div>
  );
}
