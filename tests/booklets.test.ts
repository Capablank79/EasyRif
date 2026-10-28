import { describe, expect, it } from "vitest";
import {
  formatFolio,
  keyWidths,
  participationKey,
  participationLabel,
  parseParticipationKey,
  seriesLabel,
  validateBookletConfig,
} from "@/modules/raffles/booklets";
import { validateRaffleForm } from "@/modules/raffles/validation";

const limits = { maxBooklets: 500, maxPerBooklet: 200 };
const raw = { title: "Rifa", description: "", price: "1000", currency: "CLP", numberCount: "", drawDate: "" };

describe("talonarios foliados: utilidades puras", () => {
  it("valida la configuracion y calcula el total", () => {
    const v = validateBookletConfig({ bookletCount: "10", numbersPerBooklet: "20", firstFolio: "1" }, 10000, limits);
    expect(v).toEqual({ ok: true, value: { bookletCount: 10, numbersPerBooklet: 20, firstFolio: 1, total: 200 } });
  });
  it("rechaza ceros, negativos, decimales, texto y excesos", () => {
    for (const [c, p, f] of [["0", "20", "1"], ["-1", "20", "1"], ["1.5", "20", "1"], ["a", "20", "1"], ["501", "20", "1"], ["10", "201", "1"], ["10", "20", "0"], ["10", "20", "99995"]]) {
      expect(validateBookletConfig({ bookletCount: c, numbersPerBooklet: p, firstFolio: f }, 10000, limits).ok).toBe(false);
    }
    expect(validateBookletConfig({ bookletCount: "500", numbersPerBooklet: "200", firstFolio: "1" }, 1000, limits).ok).toBe(false);
  });
  it("genera claves con relleno fijo, ordenables y reversibles", () => {
    const w = keyWidths({ bookletCount: 10, numbersPerBooklet: 20, firstFolio: 1 });
    expect(w).toEqual({ folio: 4, local: 2 });
    expect(participationKey(7, 14, w)).toBe("T0007N14");
    expect(participationLabel("T0007N14", true)).toBe("T-0007 / N-14");
    expect(participationLabel("045", false)).toBe("045");
    expect(parseParticipationKey("T0007N14")).toEqual({ folio: "0007", local: "14" });
    expect(parseParticipationKey("X")).toBeNull();
    expect(formatFolio(12)).toBe("0012");
    expect(seriesLabel(20)).toBe("01–20");
    expect(keyWidths({ bookletCount: 100, numbersPerBooklet: 1000, firstFolio: 99_000 })).toEqual({ folio: 5, local: 4 });
  });
  it("el formulario calcula el total en servidor e ignora numberCount", () => {
    const r = validateRaffleForm(
      {
        ...raw, numberCount: "5", numbering: "booklets", bookletCount: "10", numbersPerBooklet: "20", firstFolio: "",
        salesClosesAt: "2030-05-01T18:00", drawAt: "2030-05-10T20:00",
      },
      10000,
      limits,
      "America/Santiago",
    );
    expect(r.ok && r.values).toMatchObject({ numberCount: 200, numbering: "booklets", bookletCount: 10, numbersPerBooklet: 20, firstFolio: 1 });
  });
  it("sin numbering el formulario conserva el comportamiento individual", () => {
    const r = validateRaffleForm({ ...raw, numberCount: "100" }, 10000, limits);
    expect(r.ok && r.values).toMatchObject({ numberCount: 100, numbering: "individual", bookletCount: null });
    expect(validateRaffleForm({ ...raw, numberCount: "100", numbering: "otro" }, 10000, limits).ok).toBe(false);
  });
});
