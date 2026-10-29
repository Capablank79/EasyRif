/** Fechas de campaña (cierre de ventas y sorteo posterior), estado calculado y lista de folios. Funciones puras. */

export const DEFAULT_TIME_ZONE = "America/Santiago";

/** La programación comercial de rifas se interpreta siempre en horario de Santiago. */
export function getAppTimeZone(_env: Record<string, string | undefined> = process.env): string {
  void _env;
  return DEFAULT_TIME_ZONE;
}

function partsIn(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return p;
}

/** Desfase (ms) de la zona respecto de UTC en un instante dado. */
function offsetMs(ms: number, tz: string): number {
  const p = partsIn(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** "2026-12-31T18:00" interpretado en la zona del proyecto → instante UTC. null si es inválido. */
export function zonedLocalToUtc(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  let guess = naive - offsetMs(naive, tz);
  guess = naive - offsetMs(guess, tz);
  const out = new Date(guess);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** Genera el calendario comercial fijo para una fecha local de Santiago. */
export function campaignScheduleForDate(date: string, tz = DEFAULT_TIME_ZONE): { salesClosesAt: Date; drawAt: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const salesClosesAt = zonedLocalToUtc(`${date}T22:00`, tz);
  const drawAt = zonedLocalToUtc(`${date}T22:30`, tz);
  return salesClosesAt && drawAt ? { salesClosesAt, drawAt } : null;
}

/** Fecha de calendario local para un instante UTC. */
export function utcToZonedDateInput(date: Date | null, tz: string): string {
  return utcToZonedInput(date, tz).slice(0, 10);
}

/** Instante UTC → valor para `<input type="datetime-local">` en la zona del proyecto. */
export function utcToZonedInput(date: Date | null, tz: string): string {
  if (!date) return "";
  const p = partsIn(date.getTime(), tz);
  const z = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${z(p.year, 4)}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}

/** Fecha y hora legibles con la zona explícita, p. ej. "31-12-2026 18:00 (America/Santiago, GMT-3)". */
export function formatZoned(date: Date, tz: string): string {
  const p = partsIn(date.getTime(), tz);
  const z = (n: number) => String(n).padStart(2, "0");
  const off = Math.round(offsetMs(date.getTime(), tz) / 60000);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const gmt = `GMT${sign}${Math.floor(abs / 60)}${abs % 60 ? ":" + z(abs % 60) : ""}`;
  return `${z(p.day)}-${z(p.month)}-${p.year} ${z(p.hour)}:${z(p.minute)} (${tz}, ${gmt})`;
}

export type DateField = "salesClosesAt" | "drawAt";
export type DateErrors = Partial<Record<DateField, string>>;

export interface CampaignDatesRaw {
  salesClosesAt: string;
  drawAt: string;
}

/** Ambas fechas son obligatorias en talonarios; el cierre debe ser futuro y el sorteo, posterior al cierre. */
export function validateCampaignDates(
  raw: CampaignDatesRaw,
  tz: string,
  now: Date = new Date(),
  opts: { requireFutureClose?: boolean } = {},
): { ok: true; value: { salesClosesAt: Date; drawAt: Date } } | { ok: false; errors: DateErrors } {
  const errors: DateErrors = {};
  const close = zonedLocalToUtc(raw.salesClosesAt ?? "", tz);
  const draw = zonedLocalToUtc(raw.drawAt ?? "", tz);
  if (!close) errors.salesClosesAt = "Indica la fecha y hora de cierre de ventas.";
  else if ((opts.requireFutureClose ?? true) && close.getTime() <= now.getTime())
    errors.salesClosesAt = "El cierre de ventas debe estar en el futuro.";
  if (!draw) errors.drawAt = "Indica la fecha y hora del sorteo.";
  else if (close && draw.getTime() <= close.getTime())
    errors.drawAt = "El sorteo debe ser posterior al cierre de ventas.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { salesClosesAt: close!, drawAt: draw! } };
}

export interface CampaignCounts {
  total: number;
  available: number;
  reservedDemo: number;
  sold: number;
}

export type CampaignPhase = "sin_fechas" | "ventas_abiertas" | "cerrada_incompleta" | "cerrada_completa";

export interface CampaignState {
  phase: CampaignPhase;
  salesOpen: boolean;
  /** Siempre false en BUILD-008: el sorteo real no existe todavía. */
  drawEnabled: false;
  /** Motivos por los que el sorteo futuro seguiría bloqueado (informativo). */
  drawBlockers: string[];
}

/**
 * Estado calculado desde los contadores reales (nunca persistido). El sorteo permanece bloqueado:
 * esta fase no lo implementa y una reserva de demostración nunca equivale a una venta.
 */
/** Evaluado fuera del render de React (regla de pureza). */
export function isSalesClosed(salesClosesAt: Date | null, now: Date = new Date()): boolean {
  return salesClosesAt !== null && salesClosesAt.getTime() <= now.getTime();
}

export function computeCampaignState(
  c: { salesClosesAt: Date | null; drawAt: Date | null },
  counts: CampaignCounts,
  now: Date = new Date(),
): CampaignState {
  const blockers = ["El sorteo real no está disponible en esta fase."];
  if (!c.salesClosesAt || !c.drawAt) {
    return { phase: "sin_fechas", salesOpen: true, drawEnabled: false, drawBlockers: [...blockers, "Faltan las fechas de la campaña."] };
  }
  const closed = now.getTime() >= c.salesClosesAt.getTime();
  const complete = counts.total > 0 && counts.sold === counts.total;
  if (!closed) blockers.push("Las ventas siguen abiertas.");
  if (now.getTime() < c.drawAt.getTime()) blockers.push("Aún no llega la fecha del sorteo.");
  if (!complete) blockers.push(`Faltan ${counts.total - counts.sold} participaciones por estar vendidas.`);
  return {
    phase: !closed ? "ventas_abiertas" : complete ? "cerrada_completa" : "cerrada_incompleta",
    salesOpen: !closed,
    drawEnabled: false,
    drawBlockers: blockers,
  };
}

export const PHASE_LABEL: Record<CampaignPhase, string> = {
  sin_fechas: "Sin fechas definidas",
  ventas_abiertas: "Ventas abiertas",
  cerrada_incompleta: "Campaña incompleta",
  cerrada_completa: "Ventas cerradas",
};

/** "1-5, 8, 10-12" → [1,2,3,4,5,8,10,11,12] (sin duplicados, ordenado, tope de elementos). */
export function parseFolioList(raw: string, max = 2000): number[] | null {
  const out = new Set<number>();
  for (const part of raw.split(/[,\s;]+/).filter(Boolean)) {
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < a || b - a >= max) return null;
    for (let i = a; i <= b; i++) {
      out.add(i);
      if (out.size > max) return null;
    }
  }
  return out.size > 0 ? [...out].sort((x, y) => x - y) : null;
}
