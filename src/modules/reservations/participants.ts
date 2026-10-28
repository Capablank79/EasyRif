/** Datos de participantes por participación (BUILD-008 V0.8.1). Solo validación pura: sin E/S ni registros. */

export interface ParticipantInput {
  name: string;
  email: string;
  phone?: string;
}

export interface ParticipantValue {
  name: string;
  email: string;
  phone: string | null;
}

export type ParticipantErrors = Partial<Record<"name" | "email" | "phone", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Nombre y correo obligatorios; teléfono opcional. Normaliza espacios y pasa el correo a minúsculas. */
export function validateParticipant(
  raw: Partial<ParticipantInput> | null | undefined,
): { ok: true; value: ParticipantValue } | { ok: false; errors: ParticipantErrors } {
  const errors: ParticipantErrors = {};
  const name = String(raw?.name ?? "").replace(/\s+/g, " ").trim();
  const email = String(raw?.email ?? "").trim().toLowerCase();
  const phone = String(raw?.phone ?? "").trim();
  if (name.length < 2 || name.length > 100) errors.name = "Indique el nombre (2 a 100 caracteres).";
  if (!email) errors.email = "Indique el correo electrónico.";
  else if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = "El correo no es válido.";
  if (phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) errors.phone = "El teléfono no es válido.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, email, phone: phone || null } };
}

/** Tope de tarjetas por reserva: acota el tamaño del cuerpo y el trabajo del servidor. */
export const MAX_PARTICIPANTS_PAYLOAD = 50;

/** Interpreta el JSON del formulario: objeto { claveDeParticipación: {name,email,phone} }. null si es inválido. */
export function parseParticipantsPayload(raw: string): Record<string, Partial<ParticipantInput>> | null {
  if (raw.length > 64_000) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > MAX_PARTICIPANTS_PAYLOAD) return null;
    const out: Record<string, Partial<ParticipantInput>> = {};
    for (const [k, val] of entries) {
      if (!/^[A-Z0-9]{1,12}$/.test(k) || !val || typeof val !== "object" || Array.isArray(val)) return null;
      const o = val as Record<string, unknown>;
      out[k] = {
        name: typeof o.name === "string" ? o.name : "",
        email: typeof o.email === "string" ? o.email : "",
        phone: typeof o.phone === "string" ? o.phone : "",
      };
    }
    return out;
  } catch {
    return null;
  }
}
