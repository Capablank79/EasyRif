/*
 * Talonarios foliados (BUILD-008). Funciones puras, sin acceso a base de datos.
 *
 * Una participación se identifica por (rifa, folio, número interno). En `raffle_numbers.number` se
 * guarda una clave única por rifa con ceros fijos, p. ej. "T0007N14", que ordena correctamente y
 * cumple el formato existente (`^[A-Z0-9]{1,12}$`). Nunca se identifica solo por el número interno.
 */

export type NumberingMode = "individual" | "booklets";

export const MAX_FOLIO = 99_999;
export const MAX_NUMBERS_PER_BOOKLET = 9_999;
const MIN_FOLIO_WIDTH = 4;
const MIN_LOCAL_WIDTH = 2;

export interface BookletLimits {
  maxBooklets: number;
  maxPerBooklet: number;
}

/** Límites técnicos (no comerciales) configurables por entorno, con tope duro. */
export function getBookletLimits(env: Record<string, string | undefined> = process.env): BookletLimits {
  const read = (v: string | undefined, d: number, hard: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, hard) : d;
  };
  return {
    maxBooklets: read(env.RAFFLE_MAX_BOOKLETS, 500, 2_000),
    maxPerBooklet: read(env.RAFFLE_MAX_NUMBERS_PER_BOOKLET, 200, MAX_NUMBERS_PER_BOOKLET),
  };
}

export interface BookletConfig {
  bookletCount: number;
  numbersPerBooklet: number;
  firstFolio: number;
}

export type BookletConfigErrors = Partial<Record<keyof BookletConfig, string>>;

const asInt = (raw: string, max: number) => (/^\d{1,7}$/.test(raw.trim()) && Number(raw) <= max ? Number(raw) : NaN);

/** Valida la configuración (enteros positivos, límites y total máximo). El total se calcula, nunca se recibe. */
export function validateBookletConfig(
  raw: { bookletCount: string; numbersPerBooklet: string; firstFolio: string },
  maxTotal: number,
  limits: BookletLimits = getBookletLimits(),
): { ok: true; value: BookletConfig & { total: number } } | { ok: false; errors: BookletConfigErrors } {
  const errors: BookletConfigErrors = {};
  const bookletCount = asInt(raw.bookletCount, 10_000_000);
  const numbersPerBooklet = asInt(raw.numbersPerBooklet, 10_000_000);
  const firstFolio = asInt(raw.firstFolio === "" ? "1" : raw.firstFolio, 10_000_000);
  if (!Number.isInteger(bookletCount) || bookletCount < 1 || bookletCount > limits.maxBooklets)
    errors.bookletCount = `La cantidad de talonarios debe ser un entero entre 1 y ${limits.maxBooklets}.`;
  if (!Number.isInteger(numbersPerBooklet) || numbersPerBooklet < 1 || numbersPerBooklet > limits.maxPerBooklet)
    errors.numbersPerBooklet = `Los números por talonario deben ser un entero entre 1 y ${limits.maxPerBooklet}.`;
  if (!Number.isInteger(firstFolio) || firstFolio < 1) errors.firstFolio = "El folio inicial debe ser un entero desde 1.";
  else if (Number.isInteger(bookletCount) && firstFolio + bookletCount - 1 > MAX_FOLIO)
    errors.firstFolio = `El último folio no puede superar ${MAX_FOLIO}.`;
  if (Object.keys(errors).length === 0 && bookletCount * numbersPerBooklet > maxTotal)
    errors.numbersPerBooklet = `El total (${bookletCount * numbersPerBooklet}) supera el máximo de ${maxTotal} participaciones.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { bookletCount, numbersPerBooklet, firstFolio, total: bookletCount * numbersPerBooklet } };
}

/** Anchos de relleno de la clave, fijos para toda la rifa (así el orden alfabético es el numérico). */
export function keyWidths(cfg: BookletConfig) {
  const lastFolio = cfg.firstFolio + cfg.bookletCount - 1;
  return {
    folio: Math.max(MIN_FOLIO_WIDTH, String(lastFolio).length),
    local: Math.max(MIN_LOCAL_WIDTH, String(cfg.numbersPerBooklet).length),
  };
}

export function formatFolio(folio: number, width = MIN_FOLIO_WIDTH): string {
  return String(folio).padStart(width, "0");
}

/** Clave interna de una participación, p. ej. "T0007N14". */
export function participationKey(folio: number, local: number, widths: { folio: number; local: number }): string {
  return `T${formatFolio(folio, widths.folio)}N${String(local).padStart(widths.local, "0")}`;
}

const KEY_RE = /^T(\d{4,5})N(\d{2,4})$/;

export function parseParticipationKey(key: string): { folio: string; local: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { folio: m[1], local: m[2] } : null;
}

/** Referencia visible "T-0007 / N-14". En rifas individuales devuelve el número tal cual. */
export function participationLabel(key: string, isBooklet: boolean): string {
  if (!isBooklet) return key;
  const p = parseParticipationKey(key);
  return p ? `T-${p.folio} / N-${p.local}` : key;
}

/** Texto de la serie de un talonario, p. ej. "01–20". */
export function seriesLabel(perBooklet: number): string {
  const w = Math.max(MIN_LOCAL_WIDTH, String(perBooklet).length);
  return `${"1".padStart(w, "0")}–${String(perBooklet).padStart(w, "0")}`;
}
