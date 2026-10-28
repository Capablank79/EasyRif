import { createHash, randomInt } from "node:crypto";

/**
 * Motor de simulación de sorteos (BUILD-009). Dominio puro: sin base de datos ni interfaz.
 *
 * Reglas (una extracción independiente por premio, en el orden de `position`):
 *  1. Etapa folio: cada folio pesa lo mismo que sus participaciones elegibles restantes.
 *  2. Etapa número: dentro del folio, uniforme entre sus números elegibles.
 *  3. Solo la participación ganadora (folio + número) se excluye; el folio y su "dueño" siguen jugando.
 * Resultado: cada participación elegible tiene exactamente la misma probabilidad 1/total en cada premio.
 */
export const RULES_VERSION = "9.0-weighted-two-stage";
export const MAX_PRIZES = 50;
export const MAX_BOOKLETS = 1000;
export const MAX_PER_BOOKLET = 9999;
export const MAX_ELIGIBLE = 1_000_000;

/** Devuelve un entero uniforme en [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number;

/** `crypto.randomInt` aplica muestreo por rechazo: sin sesgo de módulo. */
export const secureRandomInt: RandomInt = (max) => randomInt(0, max);

export interface SimBooklet {
  folio: number;
  /** Participaciones del talonario: números internos 1..count. */
  count: number;
}
export interface SimPrize {
  position: number;
  title: string;
}
export interface SimDraw {
  prizePosition: number;
  prizeTitle: string;
  folio: number;
  localNumber: number;
  eligibleBefore: number;
  folioWeight: number;
  foliosInPlay: number;
  weightsBefore: Record<string, number>;
}

export class SimulationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationInputError";
  }
}

const isPosInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1;

export function validateSimulationInput(booklets: SimBooklet[], prizes: SimPrize[]): number {
  if (booklets.length === 0) throw new SimulationInputError("No hay talonarios para simular.");
  if (booklets.length > MAX_BOOKLETS) throw new SimulationInputError("Demasiados talonarios para simular.");
  if (prizes.length === 0) throw new SimulationInputError("La simulación requiere al menos un premio.");
  if (prizes.length > MAX_PRIZES) throw new SimulationInputError("Demasiados premios para simular.");
  const folios = new Set<number>();
  let total = 0;
  for (const b of booklets) {
    if (!isPosInt(b.folio) || !isPosInt(b.count) || b.count > MAX_PER_BOOKLET) {
      throw new SimulationInputError("Talonarios inconsistentes.");
    }
    if (folios.has(b.folio)) throw new SimulationInputError("Folios duplicados.");
    folios.add(b.folio);
    total += b.count;
  }
  if (total > MAX_ELIGIBLE) throw new SimulationInputError("Demasiadas participaciones para simular.");
  const positions = new Set<number>();
  for (const p of prizes) {
    if (!isPosInt(p.position) || positions.has(p.position)) throw new SimulationInputError("Premios inconsistentes.");
    positions.add(p.position);
  }
  if (prizes.length > total) {
    throw new SimulationInputError("Hay más premios que participaciones elegibles.");
  }
  return total;
}

function draw(rng: RandomInt, max: number): number {
  const v = rng(max);
  if (!Number.isInteger(v) || v < 0 || v >= max) throw new Error("El generador aleatorio devolvió un valor fuera de rango.");
  return v;
}

/** Ejecuta todas las extracciones sobre una instantánea; no muta la entrada. */
export function runSimulation(
  booklets: SimBooklet[],
  prizes: SimPrize[],
  rng: RandomInt = secureRandomInt,
): { draws: SimDraw[]; totalEligible: number } {
  const totalEligible = validateSimulationInput(booklets, prizes);
  const ordered = [...booklets].sort((a, b) => a.folio - b.folio);
  const won = new Map<number, Set<number>>(ordered.map((b) => [b.folio, new Set<number>()]));
  const remaining = new Map<number, number>(ordered.map((b) => [b.folio, b.count]));
  const draws: SimDraw[] = [];
  let left = totalEligible;

  for (const prize of [...prizes].sort((a, b) => a.position - b.position)) {
    const weightsBefore: Record<string, number> = {};
    for (const b of ordered) {
      const r = remaining.get(b.folio)!;
      if (r > 0) weightsBefore[String(b.folio)] = r;
    }
    // Etapa 1: folio con probabilidad restantes(folio) / totalRestantes.
    let pick = draw(rng, left);
    let folio = -1;
    for (const b of ordered) {
      const r = remaining.get(b.folio)!;
      if (pick < r) {
        folio = b.folio;
        break;
      }
      pick -= r;
    }
    const weight = remaining.get(folio)!;
    // Etapa 2: número uniforme entre los elegibles del folio.
    let k = draw(rng, weight);
    const book = ordered.find((b) => b.folio === folio)!;
    const taken = won.get(folio)!;
    let local = -1;
    for (let n = 1; n <= book.count; n++) {
      if (taken.has(n)) continue;
      if (k === 0) {
        local = n;
        break;
      }
      k--;
    }
    taken.add(local);
    remaining.set(folio, weight - 1);
    draws.push({
      prizePosition: prize.position,
      prizeTitle: prize.title,
      folio,
      localNumber: local,
      eligibleBefore: left,
      folioWeight: weight,
      foliosInPlay: Object.keys(weightsBefore).length,
      weightsBefore,
    });
    left--;
  }
  return { draws, totalEligible };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Digest SHA-256 hexadecimal de una estructura (canónica). Detecta alteraciones; no prueba aleatoriedad. */
export const digest = (value: unknown) => createHash("sha256").update(stableStringify(value)).digest("hex");

export function snapshotOf(booklets: SimBooklet[], prizes: SimPrize[]) {
  return {
    rulesVersion: RULES_VERSION,
    booklets: [...booklets].sort((a, b) => a.folio - b.folio).map((b) => ({ folio: b.folio, count: b.count })),
    prizes: [...prizes].sort((a, b) => a.position - b.position).map((p) => ({ position: p.position, title: p.title })),
  };
}

export const SYNTHETIC_PARTICIPANTS = 10;

/** Participante ficticio de una participación: el mismo número interno pertenece a la misma persona en todos los folios. */
export const syntheticParticipant = (localNumber: number) =>
  `Participante sintético ${String(((localNumber - 1) % SYNTHETIC_PARTICIPANTS) + 1).padStart(2, "0")}`;

export const resultDigest = (draws: SimDraw[]) =>
  digest(draws.map((d) => [d.prizePosition, d.folio, d.localNumber, d.eligibleBefore, d.folioWeight]));
