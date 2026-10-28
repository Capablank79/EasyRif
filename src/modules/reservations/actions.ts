"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/platform/db/client";
import { rateLimit } from "./rate-limit";
import { parseParticipantsPayload } from "./participants";
import { releaseReservation, reserveNumbers, ReservationError } from "./service";

export interface ReserveState {
  error?: string;
  unavailable?: string[];
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

async function clientId() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0, 64);
}

export async function reserveAction(_prev: ReserveState, fd: FormData): Promise<ReserveState> {
  if (!rateLimit(`reserve:${await clientId()}`, 15, 60_000))
    return { error: "Demasiados intentos. Espere un minuto e intente de nuevo." };
  const slug = str(fd, "slug").slice(0, 120);
  const participantsRaw = str(fd, "participants");
  const participants = participantsRaw ? parseParticipantsPayload(participantsRaw) : undefined;
  if (participants === null) return { error: "Los datos de los participantes no son validos." };
  let token: string;
  try {
    const res = await reserveNumbers(getDb(), {
      slug,
      numbers: str(fd, "numbers").split(",").filter(Boolean).slice(0, 200),
      requestKey: str(fd, "requestKey"),
      buyer: { name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone") },
      participants,
      consent: str(fd, "consent") === "on",
      sellerToken: str(fd, "sellerToken") || undefined,
    });
    token = res.token;
  } catch (e) {
    if (e instanceof ReservationError) return { error: e.message, unavailable: e.unavailable };
    console.error("reserveAction", e instanceof Error ? e.message : "error");
    return { error: "No se pudo completar la reserva de demostracion. Intente de nuevo." };
  }
  redirect(`/r/${encodeURIComponent(slug)}/reserva/${token}`);
}

export async function releaseAction(fd: FormData): Promise<void> {
  const token = str(fd, "token");
  const slug = str(fd, "slug").slice(0, 120);
  if (rateLimit(`release:${await clientId()}`, 30, 60_000)) await releaseReservation(getDb(), token);
  redirect(`/r/${encodeURIComponent(slug)}/reserva/${token}`);
}
