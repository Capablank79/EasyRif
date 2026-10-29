"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/modules/auth/session";
import { AuthorizationError } from "@/modules/organizations/permissions";
import { getAppTimeZone, parseFolioList, validateCampaignDates } from "@/modules/raffles/campaign";
import { UUID_RE } from "@/modules/raffles/validation";
import { getDb } from "@/platform/db/client";
import { CampaignError, assignBooklets, createSeller, extendSalesClose, revokeSeller, unassignBooklets } from "./service";
import { importSellerRows, parseSellerWorkbook, previewSellerImport } from "./seller-import";

export interface CampaignFormState {
  error?: string;
  ok?: string;
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const uuid = (fd: FormData, k: string) => (UUID_RE.test(str(fd, k)) ? str(fd, k) : null);

function toState(e: unknown): CampaignFormState {
  if (e instanceof CampaignError) return { error: e.message };
  if (e instanceof AuthorizationError) return { error: "Tu rol no permite realizar esta acción." };
  throw e;
}

async function run(fd: FormData, fn: (userId: string, raffleId: string) => Promise<string>): Promise<CampaignFormState> {
  const user = await requireUser();
  const raffleId = uuid(fd, "raffleId");
  if (!raffleId) return { error: "Rifa no válida." };
  try {
    const ok = await fn(user.id, raffleId);
    revalidatePath(`/panel/rifas/${raffleId}/responsables`);
    revalidatePath(`/panel/rifas/${raffleId}`);
    return { ok };
  } catch (e) {
    return toState(e);
  }
}

export async function createSellerAction(_: CampaignFormState, fd: FormData) {
  return run(fd, async (u, r) => {
    await createSeller(getDb(), u, r, str(fd, "displayName"));
    return "Responsable creado.";
  });
}

function importFormValues(fd: FormData) {
  const raffleId = uuid(fd, "raffleId");
  const file = fd.get("file");
  if (!raffleId) throw new CampaignError("invalid", "Rifa no válida.");
  if (!(file instanceof File)) throw new CampaignError("invalid", "Selecciona un archivo .xlsx.");
  return { raffleId, file };
}

function importError(e: unknown) {
  if (e instanceof CampaignError) return e.message;
  if (e instanceof AuthorizationError) return "Tu rol no permite importar responsables.";
  throw e;
}

export async function previewSellerImportAction(fd: FormData) {
  const user = await requireUser();
  try {
    const { raffleId, file } = importFormValues(fd);
    const rows = await parseSellerWorkbook(file.name, Buffer.from(await file.arrayBuffer()));
    return { preview: await previewSellerImport(getDb(), user.id, raffleId, rows) };
  } catch (e) {
    return { error: importError(e) };
  }
}

export async function importSellerWorkbookAction(fd: FormData) {
  const user = await requireUser();
  try {
    const { raffleId, file } = importFormValues(fd);
    const rows = await parseSellerWorkbook(file.name, Buffer.from(await file.arrayBuffer()));
    const result = await importSellerRows(getDb(), user.id, raffleId, rows);
    revalidatePath(`/panel/rifas/${raffleId}/responsables`);
    revalidatePath(`/panel/rifas/${raffleId}`);
    return { result };
  } catch (e) {
    return { error: importError(e) };
  }
}

export async function assignBookletsAction(_: CampaignFormState, fd: FormData) {
  return run(fd, async (u, r) => {
    const sellerId = uuid(fd, "sellerId");
    if (!sellerId) throw new CampaignError("invalid", "Seleccione un responsable.");
    const folios = parseFolioList(str(fd, "folios"));
    if (!folios || folios.length === 0) throw new CampaignError("invalid", "Folios no válidos. Ejemplo: 1-5, 8.");
    const res = await assignBooklets(getDb(), u, r, sellerId, folios, {
      allowReassign: str(fd, "allowReassign") === "on",
    });
    return `Asignados: ${res.assigned.length}, reasignados: ${res.reassigned.length}, sin cambios: ${res.unchanged.length}.`;
  });
}

export async function unassignBookletsAction(_: CampaignFormState, fd: FormData) {
  return run(fd, async (u, r) => {
    const folios = parseFolioList(str(fd, "folios"));
    if (!folios || folios.length === 0) throw new CampaignError("invalid", "Folios no válidos. Ejemplo: 1-5, 8.");
    const done = await unassignBooklets(getDb(), u, r, folios);
    return `Talonarios sin responsable: ${done.length}.`;
  });
}

export async function revokeSellerAction(_: CampaignFormState, fd: FormData) {
  return run(fd, async (u, r) => {
    const sellerId = uuid(fd, "sellerId");
    if (!sellerId) throw new CampaignError("invalid", "Responsable no válido.");
    await revokeSeller(getDb(), u, r, sellerId);
    return "Responsable revocado.";
  });
}

export async function extendSalesAction(_: CampaignFormState, fd: FormData) {
  return run(fd, async (u, r) => {
    const v = validateCampaignDates(
      { salesClosesAt: str(fd, "salesClosesAt"), drawAt: str(fd, "drawAt") },
      getAppTimeZone(),
    );
    if (!v.ok) throw new CampaignError("invalid", Object.values(v.errors).join(" "));
    await extendSalesClose(getDb(), u, r, { ...v.value, reason: str(fd, "reason") });
    return "Plazo extendido y registrado en auditoría.";
  });
}
