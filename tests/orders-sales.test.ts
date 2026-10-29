import { describe, expect, it } from "vitest";
import { parseSalesFilters, SALE_STATE_LABEL } from "@/modules/orders/sales-service";

describe("Centro de ventas: filtros y estados", () => {
  it("limita paginación y normaliza búsqueda sin perder estados conocidos", () => {
    expect(parseSalesFilters({ page: "999999", folio: "0042", number: " t-0002 / n-01 ", state: "sold_demo" })).toMatchObject({
      page: 10_000,
      pageSize: 25,
      folio: 42,
      number: "T0002N01",
      state: "sold_demo",
    });
  });
  it("rechaza fechas imposibles, folios inválidos y estados desconocidos", () => {
    expect(parseSalesFilters({ from: "2026-02-30", to: "nunca", folio: "0", state: "confirmed_real" })).toMatchObject({
      from: "", to: "", folio: null, state: "all",
    });
  });
  it("usa etiquetas que separan DEMO de ventas reales y reservas", () => {
    expect(SALE_STATE_LABEL.reserved).toBe("Reservado");
    expect(SALE_STATE_LABEL.sold_demo).toBe("Vendido DEMO");
    expect(SALE_STATE_LABEL.sold_real).toBe("Vendido real");
  });
});
