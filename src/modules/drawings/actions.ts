"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/modules/auth/session";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { UUID_RE } from "@/modules/raffles/validation";
import { getDb } from "@/platform/db/client";
import { DrawError, runDrawSimulation, type SimulationSource } from "./service";

export interface SimulationFormState {
  error?: string;
  ok?: string;
  blockers?: string[];
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const int = (fd: FormData, k: string) => (/^\d{1,6}$/.test(str(fd, k)) ? Number(str(fd, k)) : NaN);

function toState(e: unknown): SimulationFormState {
  if (e instanceof DrawError) return { error: e.message, blockers: e.blockers };
  if (e instanceof AuthorizationError) return { error: "Tu rol no permite realizar esta acción." };
  throw e;
}

export async function runSimulationAction(_: SimulationFormState, fd: FormData): Promise<SimulationFormState> {
  const user = await requireUser();
  const raffleId = str(fd, "raffleId");
  if (!UUID_RE.test(raffleId)) return { error: "Rifa no válida." };
  const source: SimulationSource = str(fd, "source") === "synthetic" ? "synthetic" : "raffle_config";
  try {
    const { replay } = await runDrawSimulation(getDb(), user.id, raffleId, {
      source,
      idempotencyKey: str(fd, "idempotencyKey"),
      synthetic:
        source === "synthetic"
          ? { bookletCount: int(fd, "bookletCount"), numbersPerBooklet: int(fd, "numbersPerBooklet"), prizeCount: int(fd, "prizeCount") }
          : undefined,
    });
    revalidatePath(`/panel/rifas/${raffleId}/sorteos`);
    return { ok: replay ? "Esta simulación ya estaba registrada; no se creó otra." : "Simulación registrada. SIMULACIÓN — SIN VALIDEZ." };
  } catch (e) {
    return toState(e);
  }
}
