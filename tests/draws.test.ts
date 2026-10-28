import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RULES_VERSION,
  SimulationInputError,
  digest,
  resultDigest,
  runSimulation,
  secureRandomInt,
  snapshotOf,
  stableStringify,
  syntheticParticipant,
  type RandomInt,
  type SimBooklet,
  type SimPrize,
} from "@/modules/drawings/simulation";
import { evaluateRealDrawGate, validateSynthetic } from "@/modules/drawings/service";

/* BUILD-009: motor de simulación (dominio puro). El RNG determinista solo existe en estas pruebas. */
function seeded(seed: number): RandomInt {
  let a = seed >>> 0;
  return (max) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const f = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(f * max);
  };
}

const books = (n: number, per: number): SimBooklet[] => Array.from({ length: n }, (_, i) => ({ folio: i + 1, count: per }));
const prizes = (n: number): SimPrize[] => Array.from({ length: n }, (_, i) => ({ position: i + 1, title: `P${i + 1}` }));

describe("motor de simulación de sorteos", () => {
  it("escenario guiado: folio y número en dos etapas, exclusión solo de la combinación ganadora y mismo participante con dos premios", () => {
    const seq = [0, 0, 19, 0, 0, 0];
    let i = 0;
    const { draws } = runSimulation(books(10, 20), prizes(3), () => seq[i++]);
    expect(draws.map((d) => [d.folio, d.localNumber])).toEqual([[1, 1], [2, 1], [1, 2]]);
    expect(draws.map((d) => [d.eligibleBefore, d.folioWeight])).toEqual([[200, 20], [199, 20], [198, 19]]);
    expect(draws[1].weightsBefore["1"]).toBe(19);
    expect(draws[2].weightsBefore["1"]).toBe(19);
    expect(draws[2].weightsBefore["2"]).toBe(19);
    expect(syntheticParticipant(1)).toBe(syntheticParticipant(11));
    expect(syntheticParticipant(draws[0].localNumber)).toBe(syntheticParticipant(draws[1].localNumber));
    expect(new Set(draws.map((d) => `${d.folio}-${d.localNumber}`)).size).toBe(3);
  });

  it("10 talonarios × 20 y 3 premios: 3 participaciones distintas y metadatos coherentes", () => {
    for (let s = 1; s <= 200; s++) {
      const { draws, totalEligible } = runSimulation(books(10, 20), prizes(3), seeded(s));
      expect(totalEligible).toBe(200);
      expect(draws.map((d) => d.prizePosition)).toEqual([1, 2, 3]);
      expect(new Set(draws.map((d) => `${d.folio}-${d.localNumber}`)).size).toBe(3);
      expect(draws.map((d) => d.eligibleBefore)).toEqual([200, 199, 198]);
      for (const d of draws) {
        expect(d.folio).toBeGreaterThanOrEqual(1);
        expect(d.folio).toBeLessThanOrEqual(10);
        expect(d.localNumber).toBeGreaterThanOrEqual(1);
        expect(d.localNumber).toBeLessThanOrEqual(20);
      }
    }
  });

  it("el talonario ganador sigue jugando con peso reducido; solo se excluye la participación", () => {
    const { draws } = runSimulation(books(2, 3), prizes(3), seeded(7));
    const first = draws[0];
    expect(draws[1].weightsBefore[String(first.folio)]).toBe(2);
    expect(draws[1].eligibleBefore).toBe(5);
    expect(new Set(draws.map((d) => `${d.folio}-${d.localNumber}`)).size).toBe(3);
  });

  it("un mismo folio puede repetirse con números distintos; nunca el mismo par folio+número", () => {
    const { draws } = runSimulation(books(1, 5), prizes(5), seeded(3));
    expect(new Set(draws.map((d) => d.folio)).size).toBe(1);
    expect(draws.map((d) => d.localNumber).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("al agotar un folio deja de aparecer y la última participación se sortea con peso 1", () => {
    const { draws } = runSimulation([{ folio: 1, count: 1 }, { folio: 2, count: 3 }], prizes(4), seeded(11));
    expect(draws.map((d) => `${d.folio}-${d.localNumber}`).sort()).toEqual(["1-1", "2-1", "2-2", "2-3"]);
    const idx = draws.findIndex((d) => d.folio === 1);
    for (const d of draws.slice(idx + 1)) expect(d.weightsBefore["1"]).toBeUndefined();
    expect(draws[3].folioWeight).toBe(1);
    expect(draws[3].foliosInPlay).toBe(1);
  });

  it("equidad: cada participación elegible tiene probabilidad 1/total aun con talonarios desiguales", () => {
    // Folio 1 con 3 números y folio 2 con 1: elegir folios al 50 % sesgaría los números del folio 2.
    const b = [{ folio: 1, count: 3 }, { folio: 2, count: 1 }];
    const rng = seeded(2026);
    const N = 40_000;
    const hits = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const d = runSimulation(b, prizes(1), rng).draws[0];
      const k = `${d.folio}-${d.localNumber}`;
      hits.set(k, (hits.get(k) ?? 0) + 1);
    }
    expect([...hits.keys()].sort()).toEqual(["1-1", "1-2", "1-3", "2-1"]);
    for (const v of hits.values()) expect(Math.abs(v / N - 0.25)).toBeLessThan(0.015);
  });

  it("equidad en el segundo premio tras excluir al primer ganador (pesos recalculados)", () => {
    const b = [{ folio: 1, count: 3 }, { folio: 2, count: 1 }];
    const rng = seeded(99);
    const N = 40_000;
    let second = 0;
    let folio2Second = 0;
    for (let i = 0; i < N; i++) {
      const d = runSimulation(b, prizes(2), rng).draws;
      if (d[0].folio === 1) {
        second++;
        // Quedan 2 en folio 1 y 1 en folio 2: P(folio 2) = 1/3.
        if (d[1].folio === 2) folio2Second++;
      }
    }
    expect(Math.abs(folio2Second / second - 1 / 3)).toBeLessThan(0.02);
  });

  it("valida entradas: premios sin talonarios, exceso de premios, duplicados y rangos", () => {
    expect(() => runSimulation([], prizes(1))).toThrow(SimulationInputError);
    expect(() => runSimulation(books(1, 2), [])).toThrow(SimulationInputError);
    expect(() => runSimulation(books(1, 2), prizes(3))).toThrow(/más premios/);
    expect(() => runSimulation([{ folio: 1, count: 2 }, { folio: 1, count: 2 }], prizes(1))).toThrow(/duplicados/);
    expect(() => runSimulation([{ folio: 0, count: 2 }], prizes(1))).toThrow(SimulationInputError);
    expect(() => runSimulation([{ folio: 1, count: 1.5 }], prizes(1))).toThrow(SimulationInputError);
    expect(() => runSimulation(books(1, 5), [{ position: 1, title: "a" }, { position: 1, title: "b" }])).toThrow(SimulationInputError);
    expect(() => runSimulation(books(1, 20_000), prizes(1))).toThrow(SimulationInputError);
  });

  it("rechaza un RNG que devuelve valores fuera de rango y no muta la entrada", () => {
    const b = books(3, 4);
    const copy = JSON.stringify(b);
    expect(() => runSimulation(b, prizes(1), () => 999)).toThrow(/fuera de rango/);
    runSimulation(b, prizes(2), seeded(5));
    expect(JSON.stringify(b)).toBe(copy);
  });

  it("respeta el orden de premios por position aunque llegue desordenado", () => {
    const { draws } = runSimulation(books(2, 5), [
      { position: 3, title: "C" },
      { position: 1, title: "A" },
      { position: 2, title: "B" },
    ], seeded(1));
    expect(draws.map((d) => d.prizeTitle)).toEqual(["A", "B", "C"]);
  });

  it("el RNG seguro devuelve enteros en rango y el código no usa Math.random", () => {
    for (let i = 0; i < 1000; i++) {
      const v = secureRandomInt(7);
      expect(Number.isInteger(v) && v >= 0 && v < 7).toBe(true);
    }
    const src = readFileSync(path.resolve(import.meta.dirname, "..", "src", "modules", "drawings", "simulation.ts"), "utf8");
    expect(src).not.toMatch(/Math\.random/);
  });

  it("digests canónicos y estables", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    const s1 = snapshotOf(books(3, 2), prizes(2));
    const s2 = snapshotOf([...books(3, 2)].reverse(), [...prizes(2)].reverse());
    expect(digest(s1)).toBe(digest(s2));
    expect(digest(s1)).toMatch(/^[0-9a-f]{64}$/);
    const r = runSimulation(books(3, 2), prizes(2), seeded(4)).draws;
    expect(resultDigest(r)).toBe(resultDigest(JSON.parse(JSON.stringify(r))));
    expect(s1.rulesVersion).toBe(RULES_VERSION);
  });

  it("parámetros sintéticos: rangos y exceso de premios", () => {
    expect(validateSynthetic({ bookletCount: 10, numbersPerBooklet: 20, prizeCount: 3 })).toBeTruthy();
    for (const bad of [
      { bookletCount: 0, numbersPerBooklet: 20, prizeCount: 3 },
      { bookletCount: 10, numbersPerBooklet: NaN, prizeCount: 3 },
      { bookletCount: 1001, numbersPerBooklet: 20, prizeCount: 3 },
      { bookletCount: 1000, numbersPerBooklet: 1000, prizeCount: 3 },
      { bookletCount: 1, numbersPerBooklet: 2, prizeCount: 3 },
      { bookletCount: 10, numbersPerBooklet: 20, prizeCount: 51 },
    ]) {
      expect(() => validateSynthetic(bad)).toThrow();
    }
  });
});

describe("compuerta del sorteo real", () => {
  const past = new Date(Date.now() - 86_400_000);
  const futureDraw = new Date(Date.now() + 86_400_000);
  const gate = (c: { total: number; sold: number; reservedDemo: number }, dates: { salesClosesAt: Date | null; drawAt: Date | null } = { salesClosesAt: past, drawAt: past }, p = 3) =>
    evaluateRealDrawGate(dates, c, p);

  it("nunca está habilitado: 199/200, 200/200 antes de fechas, 200 reservas demo y 200/200 con fechas cumplidas", () => {
    const cases = [
      gate({ total: 200, sold: 199, reservedDemo: 0 }),
      gate({ total: 200, sold: 200, reservedDemo: 0 }, { salesClosesAt: past, drawAt: futureDraw }),
      gate({ total: 200, sold: 0, reservedDemo: 200 }),
      gate({ total: 200, sold: 200, reservedDemo: 0 }),
      gate({ total: 0, sold: 0, reservedDemo: 0 }, { salesClosesAt: null, drawAt: null }, 0),
    ];
    for (const g of cases) {
      expect(g.enabled).toBe(false);
      expect(g.campaign.drawEnabled).toBe(false);
      expect(g.blockers.length).toBeGreaterThan(0);
    }
    expect(cases[0].headline).toBe("Campaña incompleta — sorteo no habilitado");
    expect(cases[0].blockers.join(" ")).toMatch(/Faltan 1 participaciones/);
    expect(cases[1].blockers.join(" ")).toMatch(/fecha del sorteo/);
    expect(cases[2].blockers.join(" ")).toMatch(/reservas pendientes/);
    expect(cases[3].blockers.join(" ")).toMatch(/pagos confirmados/);
  });
});
