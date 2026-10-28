import { describe, expect, it } from "vitest";
import {
  parsePrice,
  slugify,
  validatePrizeForm,
  validateRaffleForm,
  getMaxRaffleNumbers,
  minorToInput,
} from "@/modules/raffles/validation";

const base = { title: "Rifa", description: "", price: "1000", currency: "CLP", numberCount: "100", drawDate: "" };

describe("parsePrice", () => {
  it("CLP sin decimales", () => {
    expect(parsePrice("1500", "CLP")).toBe(1500);
    expect(parsePrice("15,5", "CLP")).toBeNull();
  });
  it("USD en unidad menor sin flotantes", () => {
    expect(parsePrice("12.5", "USD")).toBe(1250);
    expect(parsePrice("12,50", "USD")).toBe(1250);
    expect(parsePrice("0.29", "USD")).toBe(29);
    expect(parsePrice("1.005", "USD")).toBeNull();
  });
  it("rechaza entradas inválidas y valores enormes", () => {
    for (const v of ["", "-1", "abc", "1e3", "1.000.000", "1 000", "99999999999"]) {
      expect(parsePrice(v, "USD")).toBeNull();
    }
  });
  it("minorToInput es inverso", () => {
    expect(minorToInput(1250, "USD")).toBe("12.50");
    expect(minorToInput(1500, "CLP")).toBe("1500");
  });
});

describe("validateRaffleForm", () => {
  it("acepta datos válidos", () => {
    const r = validateRaffleForm({ ...base, drawDate: "2030-05-20" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.priceMinor).toBe(1000);
      expect(r.values.drawDate?.toISOString()).toBe("2030-05-20T23:59:59.000Z");
    }
  });
  it("valida título, cantidad, moneda y fecha", () => {
    const r = validateRaffleForm({ ...base, title: "  ", numberCount: "0", currency: "XXX", drawDate: "2030-02-31" }, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["currency", "drawDate", "numberCount", "title"]);
  });
  it("respeta el máximo configurable", () => {
    expect(validateRaffleForm({ ...base, numberCount: "101" }, 100).ok).toBe(false);
    expect(validateRaffleForm({ ...base, numberCount: "100" }, 100).ok).toBe(true);
    expect(validateRaffleForm({ ...base, numberCount: "10.5" }).ok).toBe(false);
  });
  it("máximo por entorno con tope absoluto", () => {
    expect(getMaxRaffleNumbers({})).toBe(10000);
    expect(getMaxRaffleNumbers({ RAFFLE_MAX_NUMBERS: "500" })).toBe(500);
    expect(getMaxRaffleNumbers({ RAFFLE_MAX_NUMBERS: "9999999" })).toBe(100000);
    expect(getMaxRaffleNumbers({ RAFFLE_MAX_NUMBERS: "x" })).toBe(10000);
  });
});

describe("validatePrizeForm y slugify", () => {
  it("premio", () => {
    expect(validatePrizeForm({ title: "", description: "" }).ok).toBe(false);
    expect(validatePrizeForm({ title: " TV ", description: "" })).toEqual({
      ok: true,
      values: { title: "TV", description: null },
    });
  });
  it("slug sin tildes ni símbolos, con mínimo", () => {
    expect(slugify("¡Gran Rifa Pro-Fondos 2026!")).toBe("gran-rifa-pro-fondos-2026");
    expect(slugify("Ñandú")).toBe("nandu");
    expect(slugify("!!")).toBe("rifa");
    expect(slugify("a".repeat(80)).length).toBeLessThanOrEqual(50);
  });
});
