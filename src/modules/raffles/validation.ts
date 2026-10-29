import {
  validateBookletConfig,
  type BookletConfig,
  type BookletLimits,
  type NumberingMode,
} from "./booklets";
import { campaignScheduleForDate, getAppTimeZone } from "./campaign";
/** Límites técnicos configurables (no son límites comerciales). */
const HARD_CAP = 100_000;
const DEFAULT_MAX = 10_000;

export function getMaxRaffleNumbers(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.RAFFLE_MAX_NUMBERS);
  if (Number.isInteger(n) && n >= 1) return Math.min(n, HARD_CAP);
  return DEFAULT_MAX;
}

/** Decimales de la unidad menor por moneda. El dinero se guarda siempre como entero. */
export const CURRENCIES = {
  CLP: 0,
  USD: 2,
  EUR: 2,
  ARS: 2,
  PEN: 2,
  COP: 2,
  MXN: 2,
} as const;
export type CurrencyCode = keyof typeof CURRENCIES;
export const DEFAULT_CURRENCY: CurrencyCode = "CLP";
const MAX_MINOR = 2_000_000_000;

export function isCurrency(v: string): v is CurrencyCode {
  return Object.hasOwn(CURRENCIES, v);
}

/** Convierte "1500" o "12,50" a unidad menor sin usar flotantes. null si es inválido. */
export function parsePrice(raw: string, currency: CurrencyCode): number | null {
  const m = /^(\d{1,10})(?:[.,](\d+))?$/.exec(raw.trim());
  if (!m) return null;
  const exp = CURRENCIES[currency];
  const frac = m[2] ?? "";
  if (frac.length > exp) return null;
  const minor = Number(m[1] + frac.padEnd(exp, "0"));
  return Number.isSafeInteger(minor) && minor <= MAX_MINOR ? minor : null;
}

export function formatMoney(minor: number, currency: string): string {
  const exp = isCurrency(currency) ? CURRENCIES[currency] : 2;
  try {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(minor / 10 ** exp);
  } catch {
    return `${(minor / 10 ** exp).toFixed(exp)} ${currency}`;
  }
}

export function minorToInput(minor: number, currency: string): string {
  const exp = isCurrency(currency) ? CURRENCIES[currency] : 2;
  return exp === 0 ? String(minor) : (minor / 10 ** exp).toFixed(exp);
}

export interface RaffleInput {
  title: string;
  description: string | null;
  priceMinor: number;
  currency: CurrencyCode;
  /** Total de participaciones. En talonarios se calcula: talonarios × números por talonario. */
  numberCount: number;
  drawDate: Date | null;
  /** Ausente = "individual" (comportamiento anterior a BUILD-008). */
  numbering?: NumberingMode;
  bookletCount?: number | null;
  numbersPerBooklet?: number | null;
  firstFolio?: number | null;
  /** Solo talonarios: cierre de ventas y sorteo posterior (instantes UTC). */
  salesClosesAt?: Date | null;
  drawAt?: Date | null;
}
export type RaffleField =
  | "title"
  | "description"
  | "price"
  | "currency"
  | "numberCount"
  | "drawDate"
  | "numbering"
  | "bookletCount"
  | "numbersPerBooklet"
  | "firstFolio"
  | "salesClosesAt"
  | "drawAt";
export type RaffleFieldErrors = Partial<Record<RaffleField, string>>;

export interface RaffleFormRaw {
  title: string;
  description: string;
  price: string;
  currency: string;
  numberCount: string;
  drawDate: string;
  numbering?: string;
  bookletCount?: string;
  numbersPerBooklet?: string;
  firstFolio?: string;
  salesClosesAt?: string;
  drawAt?: string;
}

export function validateRaffleForm(
  raw: RaffleFormRaw,
  maxNumbers = getMaxRaffleNumbers(),
  bookletLimits?: BookletLimits,
  timeZone: string = getAppTimeZone(),
  opts: { requireFutureClose?: boolean; now?: Date } = {},
): { ok: true; values: RaffleInput } | { ok: false; errors: RaffleFieldErrors } {
  const errors: RaffleFieldErrors = {};
  const title = raw.title.trim();
  const description = raw.description.trim();
  if (title.length < 1 || title.length > 200) errors.title = "Escribe un nombre de hasta 200 caracteres.";
  if (description.length > 2000) errors.description = "La descripción admite hasta 2000 caracteres.";

  const currency = raw.currency.trim().toUpperCase();
  let cur: CurrencyCode = DEFAULT_CURRENCY;
  if (isCurrency(currency)) cur = currency;
  else errors.currency = "Moneda no admitida.";

  const priceMinor = parsePrice(raw.price, cur);
  if (priceMinor === null) {
    errors.price =
      CURRENCIES[cur] === 0
        ? "Escribe un precio entero, sin decimales ni separadores de miles."
        : "Escribe un precio válido (hasta 2 decimales, sin separadores de miles).";
  }

  const numbering = (raw.numbering ?? "individual").trim();
  if (numbering !== "individual" && numbering !== "booklets") errors.numbering = "Tipo de numeración no válido.";
  let booklets: (BookletConfig & { total: number }) | null = null;
  let numberCount = NaN;
  if (numbering === "booklets") {
    const v = validateBookletConfig(
      {
        bookletCount: raw.bookletCount ?? "",
        numbersPerBooklet: raw.numbersPerBooklet ?? "",
        firstFolio: raw.firstFolio ?? "1",
      },
      maxNumbers,
      bookletLimits,
    );
    if (v.ok) {
      booklets = v.value;
      numberCount = v.value.total;
    } else Object.assign(errors, v.errors);
  } else {
    const countStr = raw.numberCount.trim();
    numberCount = /^\d{1,7}$/.test(countStr) ? Number(countStr) : NaN;
    if (!Number.isInteger(numberCount) || numberCount < 1 || numberCount > maxNumbers) {
      errors.numberCount = `La cantidad de números debe ser un entero entre 1 y ${maxNumbers}.`;
    }
  }

  let drawDate: Date | null = null;
  let dates: { salesClosesAt: Date; drawAt: Date } | null = null;
  const d = raw.drawDate.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const date = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !date || date.getUTCFullYear() !== +m[1] || date.getUTCMonth() !== +m[2] - 1 || date.getUTCDate() !== +m[3]) {
    errors.drawDate = "Selecciona la fecha del sorteo.";
  } else {
    dates = campaignScheduleForDate(d, timeZone);
    if (!dates) errors.drawDate = "Fecha no válida para la zona horaria de Santiago.";
    else if ((opts.requireFutureClose ?? true) && dates.salesClosesAt.getTime() <= (opts.now ?? new Date()).getTime()) {
      errors.drawDate = "El cierre de ventas (22:00, hora de Santiago) debe estar en el futuro.";
    } else drawDate = dates.drawAt;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      title,
      description: description || null,
      priceMinor: priceMinor!,
      currency: cur,
      numberCount,
      drawDate,
      numbering: numbering as NumberingMode,
      bookletCount: booklets?.bookletCount ?? null,
      numbersPerBooklet: booklets?.numbersPerBooklet ?? null,
      firstFolio: booklets?.firstFolio ?? null,
      salesClosesAt: dates?.salesClosesAt ?? null,
      drawAt: dates?.drawAt ?? null,
    },
  };
}

export type PrizeField = "title" | "description";
export type PrizeFieldErrors = Partial<Record<PrizeField, string>>;

export function validatePrizeForm(raw: { title: string; description: string }):
  | { ok: true; values: { title: string; description: string | null } }
  | { ok: false; errors: PrizeFieldErrors } {
  const errors: PrizeFieldErrors = {};
  const title = raw.title.trim();
  const description = raw.description.trim();
  if (title.length < 1 || title.length > 200) errors.title = "Escribe el nombre del premio (hasta 200 caracteres).";
  if (description.length > 1000) errors.description = "La descripción admite hasta 1000 caracteres.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { title, description: description || null } };
}

/** Slug base legible: minúsculas, sin tildes, 3–50 caracteres. */
export function slugify(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : "rifa";
}

export const STATUS_LABEL = {
  draft: "Borrador",
  published: "Publicada",
  closed: "Cerrada",
  drawn: "Sorteada",
} as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
