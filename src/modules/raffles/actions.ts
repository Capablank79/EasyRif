"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/modules/auth/session";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { getDb } from "@/platform/db/client";
import { ImageError, MAX_IMAGE_BYTES } from "@/modules/storage/image";
import { removeImage, setImage } from "./images";
import * as svc from "./service";
import { RaffleError } from "./service";
import {
  UUID_RE,
  validatePrizeForm,
  validateRaffleForm,
  type PrizeFieldErrors,
  type RaffleFieldErrors,
} from "./validation";

export interface RaffleFormState {
  error?: string;
  ok?: string;
  fieldErrors?: RaffleFieldErrors & PrizeFieldErrors;
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const id = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return UUID_RE.test(v) ? v : null;
};

/** Traduce errores de dominio/permisos a mensajes seguros; lo inesperado se relanza. */
function toState(e: unknown): RaffleFormState {
  if (e instanceof RaffleError) return { error: e.message };
  if (e instanceof AuthorizationError) return { error: "Tu rol no permite realizar esta acción." };
  throw e;
}

const raffleRaw = (fd: FormData) => ({
  title: str(fd, "title"),
  description: str(fd, "description"),
  price: str(fd, "price"),
  currency: str(fd, "currency"),
  numberCount: str(fd, "numberCount"),
  numbering: str(fd, "numbering") || "individual",
  bookletCount: str(fd, "bookletCount"),
  numbersPerBooklet: str(fd, "numbersPerBooklet"),
  firstFolio: str(fd, "firstFolio"),
  drawDate: str(fd, "drawDate"),
  salesClosesAt: str(fd, "salesClosesAt"),
  drawAt: str(fd, "drawAt"),
});

export async function createRaffleAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const orgId = id(fd, "organizationId");
  if (!orgId) return { error: "Organización no válida." };
  const parsed = validateRaffleForm(raffleRaw(fd));
  if (!parsed.ok) return { fieldErrors: parsed.errors };
  let raffleId: string;
  try {
    raffleId = (await svc.createRaffle(getDb(), user.id, orgId, parsed.values)).id;
  } catch (e) {
    return toState(e);
  }
  redirect(`/panel/rifas/${raffleId}`);
}

export async function updateRaffleAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const raffleId = id(fd, "raffleId");
  if (!raffleId) return { error: "Rifa no válida." };
  const parsed = validateRaffleForm(raffleRaw(fd));
  if (!parsed.ok) return { fieldErrors: parsed.errors };
  try {
    await svc.updateRaffle(getDb(), user.id, raffleId, parsed.values);
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/panel/rifas/${raffleId}`);
  return { ok: "Cambios guardados." };
}

export async function addPrizeAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const raffleId = id(fd, "raffleId");
  if (!raffleId) return { error: "Rifa no válida." };
  const parsed = validatePrizeForm({ title: str(fd, "title"), description: str(fd, "description") });
  if (!parsed.ok) return { fieldErrors: parsed.errors };
  try {
    await svc.addPrize(getDb(), user.id, raffleId, parsed.values);
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/panel/rifas/${raffleId}`);
  return { ok: "Premio agregado." };
}

export async function updatePrizeAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const raffleId = id(fd, "raffleId");
  const prizeId = id(fd, "prizeId");
  if (!raffleId || !prizeId) return { error: "Premio no válido." };
  const parsed = validatePrizeForm({ title: str(fd, "title"), description: str(fd, "description") });
  if (!parsed.ok) return { fieldErrors: parsed.errors };
  try {
    await svc.updatePrize(getDb(), user.id, raffleId, prizeId, parsed.values);
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/panel/rifas/${raffleId}`);
  return { ok: "Premio actualizado." };
}

export async function deletePrizeAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const raffleId = id(fd, "raffleId");
  const prizeId = id(fd, "prizeId");
  if (!raffleId || !prizeId) return { error: "Premio no válido." };
  try {
    await svc.deletePrize(getDb(), user.id, raffleId, prizeId);
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/panel/rifas/${raffleId}`);
  return { ok: "Premio eliminado." };
}

export async function movePrizeAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const raffleId = id(fd, "raffleId");
  const prizeId = id(fd, "prizeId");
  const dir = str(fd, "direction");
  if (!raffleId || !prizeId || (dir !== "up" && dir !== "down")) return { error: "Solicitud no válida." };
  try {
    await svc.movePrize(getDb(), user.id, raffleId, prizeId, dir);
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/panel/rifas/${raffleId}`);
  return {};
}

export async function generateNumbersAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const raffleId = id(fd, "raffleId");
  if (!raffleId) return { error: "Rifa no válida." };
  try {
    const r = await svc.generateNumbers(getDb(), user.id, raffleId);
    revalidatePath(`/panel/rifas/${raffleId}`);
    return { ok: r.created > 0 ? `Se generaron ${r.created} números.` : "Los números ya estaban generados." };
  } catch (e) {
    return toState(e);
  }
}

export async function publishRaffleAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const raffleId = id(fd, "raffleId");
  if (!raffleId) return { error: "Rifa no válida." };
  try {
    await svc.publishRaffle(getDb(), user.id, raffleId);
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/panel/rifas/${raffleId}`);
  return { ok: "Rifa publicada. La ficha informativa ya es visible." };
}

const IMAGE_ERRORS = new Set(["empty", "too_large", "type", "corrupt", "dimensions"]);

function imageTarget(fd: FormData) {
  const raffleId = id(fd, "raffleId");
  if (!raffleId) return null;
  const prizeId = id(fd, "prizeId");
  if (str(fd, "kind") === "prize") return prizeId ? ({ kind: "prize", raffleId, prizeId } as const) : null;
  return { kind: "raffle", raffleId } as const;
}

export async function uploadImageAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const target = imageTarget(fd);
  const file = fd.get("image");
  if (!target) return { error: "Solicitud no válida." };
  if (!(file instanceof File) || file.size === 0) return { error: "Seleccione una imagen." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "La imagen supera el máximo de 3 MB." };
  try {
    await setImage(getDb(), user.id, target, Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof ImageError && IMAGE_ERRORS.has(e.code)) return { error: e.message };
    return toState(e);
  }
  revalidatePath(`/panel/rifas/${target.raffleId}`);
  return { ok: "Imagen guardada." };
}

export async function removeImageAction(_: RaffleFormState, fd: FormData): Promise<RaffleFormState> {
  const user = await requireUser();
  const target = imageTarget(fd);
  if (!target) return { error: "Solicitud no válida." };
  try {
    await removeImage(getDb(), user.id, target);
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/panel/rifas/${target.raffleId}`);
  return { ok: "Imagen eliminada." };
}
