"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { runSimulationAction, type SimulationFormState } from "./actions";

const inputCls =
  "mt-1 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-navy-950 focus:border-navy-700 focus:outline-2 focus:outline-offset-2 focus:outline-navy-700";

export function SimulationForm({
  raffleId,
  idempotencyKey,
  canUseConfig,
  individual = false,
  defaults,
}: {
  raffleId: string;
  /** Generada en el servidor para cada render: un doble envío no duplica la simulación. */
  idempotencyKey: string;
  canUseConfig: boolean;
  /** Numeración individual: un solo grupo de números, sin folios ni talonarios. */
  individual?: boolean;
  defaults: { bookletCount: number; numbersPerBooklet: number; prizeCount: number };
}) {
  const [state, action, pending] = useActionState<SimulationFormState, FormData>(runSimulationAction, {});
  const [source, setSource] = useState<"raffle_config" | "synthetic">(canUseConfig ? "raffle_config" : "synthetic");
  return (
    <form action={action} className="space-y-4" key={idempotencyKey}>
      <input type="hidden" name="raffleId" value={raffleId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="source" value={source} />
      {state.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="rounded-xl bg-sky-100 p-3 text-sm text-navy-900">
          {state.ok}
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-navy-900">Datos de la simulación</legend>
        <label className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm has-[:disabled]:opacity-50">
          <input
            type="radio"
            name="sourceChoice"
            checked={source === "raffle_config"}
            disabled={!canUseConfig}
            onChange={() => setSource("raffle_config")}
            className="mt-1 size-4"
          />
          <span>
            <span className="block font-medium text-navy-900">Configuración de esta rifa</span>
            <span className="block text-muted">
              {individual ? "Usa sus números y premios actuales como instantánea." : "Usa sus talonarios y premios actuales como instantánea."} No lee ni modifica ventas, reservas ni compradores.
              {!canUseConfig && " (Requiere premios y números generados.)"}
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm">
          <input
            type="radio"
            name="sourceChoice"
            checked={source === "synthetic"}
            onChange={() => setSource("synthetic")}
            className="mt-1 size-4"
          />
          <span>
            <span className="block font-medium text-navy-900">Datos sintéticos</span>
            <span className="block text-muted">{individual ? "Números y premios ficticios, aislados de esta rifa." : "Talonarios y premios ficticios, aislados de esta rifa."}</span>
          </span>
        </label>
      </fieldset>
      {source === "synthetic" && (
        <div className={individual ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-3"}>
          {individual ? <input type="hidden" name="bookletCount" value="1" /> : <div>
            <label htmlFor="bookletCount" className="text-sm font-medium text-navy-900">Talonarios</label>
            <input id="bookletCount" name="bookletCount" type="number" inputMode="numeric" min={1} max={1000} defaultValue={defaults.bookletCount} required className={inputCls} />
          </div>}
          <div>
            <label htmlFor="numbersPerBooklet" className="text-sm font-medium text-navy-900">{individual ? "Cantidad de números" : "Números por talonario"}</label>
            <input id="numbersPerBooklet" name="numbersPerBooklet" type="number" inputMode="numeric" min={1} max={9999} defaultValue={defaults.numbersPerBooklet} required className={inputCls} />
          </div>
          <div>
            <label htmlFor="prizeCount" className="text-sm font-medium text-navy-900">Premios</label>
            <input id="prizeCount" name="prizeCount" type="number" inputMode="numeric" min={1} max={50} defaultValue={defaults.prizeCount} required className={inputCls} />
          </div>
        </div>
      )}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Simulando…" : "Simular extracción"}
      </Button>
    </form>
  );
}
