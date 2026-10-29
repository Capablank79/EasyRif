/**
 * Logica pura de guia de usuario (BUILD-010). No contiene reglas de negocio: solo decide que
 * paso del asistente mostrar y cual es la siguiente accion sugerida. El servidor sigue siendo
 * la unica autoridad de validacion.
 */

/** Pasos del asistente de creacion (los pasos 4 y 5 ocurren en la pantalla de la rifa ya creada). */
export const CREATE_STEPS = [
  { id: 1, title: "Datos básicos", hint: "Nombre, precio y descripción." },
  { id: 2, title: "Numeración y modalidad", hint: "Cómo se numeran las participaciones." },
  { id: 3, title: "Fechas y revisión", hint: "Fechas y resumen antes de crear el borrador." },
] as const;

export type CreateStepId = (typeof CREATE_STEPS)[number]["id"];

const FIELD_STEP: Record<string, CreateStepId> = {
  title: 1,
  description: 1,
  price: 1,
  currency: 1,
  numbering: 2,
  numberCount: 2,
  bookletCount: 2,
  numbersPerBooklet: 2,
  firstFolio: 2,
  drawDate: 3,
  salesClosesAt: 3,
  drawAt: 3,
};

/** Paso del asistente al que pertenece un campo (por defecto, el primero). */
export function stepForField(field: string): CreateStepId {
  return FIELD_STEP[field] ?? 1;
}

/** Paso mas temprano que contiene algun error, o null si no hay errores. */
export function firstStepWithError(fieldErrors: Record<string, string | undefined> | undefined): CreateStepId | null {
  if (!fieldErrors) return null;
  let min: CreateStepId | null = null;
  for (const [k, v] of Object.entries(fieldErrors)) {
    if (!v) continue;
    const s = stepForField(k);
    if (min === null || s < min) min = s;
  }
  return min;
}

/** Campos obligatorios vacios de un paso (solo ayuda previa; el servidor valida de verdad). */
export function missingRequiredInStep(
  step: CreateStepId,
  v: { title: string; price: string; numbering: "individual" | "booklets"; numberCount: string; bookletCount: string; numbersPerBooklet: string; salesClosesAt: string; drawAt: string },
): Record<string, string> {
  const out: Record<string, string> = {};
  const empty = (s: string) => s.trim() === "";
  if (step === 1) {
    if (empty(v.title)) out.title = "Escribe el nombre de la rifa. Ejemplo: «Rifa solidaria 2026».";
    if (empty(v.price)) out.price = "Indica cuánto cuesta cada número. Ejemplo: 1000.";
  }
  if (step === 2) {
    if (v.numbering === "individual" && empty(v.numberCount)) out.numberCount = "Indica cuántos números tendrá la rifa. Ejemplo: 100.";
    if (v.numbering === "booklets") {
      if (empty(v.bookletCount)) out.bookletCount = "Indica cuántos talonarios habrá. Ejemplo: 10.";
      if (empty(v.numbersPerBooklet)) out.numbersPerBooklet = "Indica cuántos números trae cada talonario. Ejemplo: 20.";
    }
  }
  if (step === 3 && v.numbering === "booklets") {
    if (empty(v.salesClosesAt)) out.salesClosesAt = "Elige cuándo se cierran las ventas.";
    if (empty(v.drawAt)) out.drawAt = "Elige la fecha del sorteo.";
  }
  return out;
}

export interface NextAction {
  /** Texto corto de la siguiente accion recomendada. */
  label: string;
  /** Seccion (ancla) de la pantalla de la rifa donde se realiza. */
  anchor: "premios" | "numeracion" | "publicacion" | "ficha";
  ready: boolean;
}

/** Siguiente accion para una rifa en borrador, en el mismo orden de los requisitos de publicacion. */
export function nextDraftAction(r: { prizeCount: number; numberTotal: number; numberCount: number }): NextAction {
  if (r.prizeCount < 1) return { label: "Agrega al menos un premio", anchor: "premios", ready: false };
  if (r.numberTotal !== r.numberCount) return { label: "Genera los números de la rifa", anchor: "numeracion", ready: false };
  return { label: "Revisa el resumen y publica la rifa", anchor: "publicacion", ready: true };
}
