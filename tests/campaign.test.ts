import { describe, expect, it } from "vitest";
import {
  computeCampaignState,
  formatZoned,
  getAppTimeZone,
  isSalesClosed,
  parseFolioList,
  utcToZonedInput,
  validateCampaignDates,
  zonedLocalToUtc,
} from "@/modules/raffles/campaign";
import { parseParticipantsPayload, validateParticipant } from "@/modules/reservations/participants";

const TZ = "America/Santiago";
const now = new Date("2030-01-01T12:00:00Z");

describe("fechas de campaña y zona horaria", () => {
  it("convierte hora local a UTC y de vuelta (verano e invierno)", () => {
    const summer = zonedLocalToUtc("2030-01-15T18:00", TZ)!;
    const winter = zonedLocalToUtc("2030-07-15T18:00", TZ)!;
    expect(summer.toISOString()).toBe("2030-01-15T21:00:00.000Z");
    expect(winter.toISOString()).toBe("2030-07-15T22:00:00.000Z");
    expect(utcToZonedInput(summer, TZ)).toBe("2030-01-15T18:00");
    expect(utcToZonedInput(winter, TZ)).toBe("2030-07-15T18:00");
  });
  it("rechaza formatos y fechas inexistentes", () => {
    expect(zonedLocalToUtc("2030-02-31T10:00", TZ)).toBeNull();
    expect(zonedLocalToUtc("mañana", TZ)).toBeNull();
    expect(zonedLocalToUtc("2030-01-01T25:00", TZ)).toBeNull();
  });
  it("formatea indicando la zona horaria", () => {
    expect(formatZoned(new Date("2030-01-15T21:00:00Z"), TZ)).toContain("GMT-3");
  });
  it("valida orden: el sorteo es posterior al cierre y el cierre debe ser futuro", () => {
    expect(validateCampaignDates({ salesClosesAt: "2030-02-01T10:00", drawAt: "2030-02-10T10:00" }, TZ, now).ok).toBe(true);
    expect(validateCampaignDates({ salesClosesAt: "2030-02-10T10:00", drawAt: "2030-02-01T10:00" }, TZ, now).ok).toBe(false);
    expect(validateCampaignDates({ salesClosesAt: "2030-02-01T10:00", drawAt: "2030-02-01T10:00" }, TZ, now).ok).toBe(false);
    expect(validateCampaignDates({ salesClosesAt: "", drawAt: "" }, TZ, now).ok).toBe(false);
    expect(
      validateCampaignDates({ salesClosesAt: "2029-12-01T10:00", drawAt: "2030-02-10T10:00" }, TZ, now, { requireFutureClose: true }).ok,
    ).toBe(false);
  });
  it("APP_TIMEZONE inválida cae al valor por defecto", () => {
    expect(getAppTimeZone({ APP_TIMEZONE: "No/Existe" })).toBe(TZ);
    expect(getAppTimeZone({ APP_TIMEZONE: "America/Bogota" })).toBe("America/Bogota");
  });
  it("estado de campaña y cierre de ventas", () => {
    expect(isSalesClosed(null, now)).toBe(false);
    expect(isSalesClosed(new Date("2029-01-01T00:00:00Z"), now)).toBe(true);
    const open = computeCampaignState(
      { salesClosesAt: new Date("2030-02-01T00:00:00Z"), drawAt: new Date("2030-02-10T00:00:00Z") },
      { total: 200, available: 200, reservedDemo: 0, sold: 0 },
      now,
    );
    expect(open.phase).toBe("ventas_abiertas");
    const closed = computeCampaignState(
      { salesClosesAt: new Date("2029-02-01T00:00:00Z"), drawAt: new Date("2029-02-10T00:00:00Z") },
      { total: 200, available: 190, reservedDemo: 10, sold: 0 },
      now,
    );
    expect(closed.phase).toBe("cerrada_incompleta");
    expect(computeCampaignState({ salesClosesAt: null, drawAt: null }, { total: 1, available: 1, reservedDemo: 0, sold: 0 }, now).phase).toBe("sin_fechas");
  });
});

describe("lista de folios", () => {
  it("acepta números y rangos, y rechaza basura", () => {
    expect(parseFolioList("1, 3-5 8")).toEqual([1, 3, 4, 5, 8]);
    expect(parseFolioList("a")).toBeNull();
    expect(parseFolioList("5-3")).toBeNull();
  });
});

describe("participantes", () => {
  it("nombre y correo obligatorios, teléfono opcional", () => {
    expect(validateParticipant({ name: " Ana  Pérez ", email: "ANA@Example.com" })).toEqual({
      ok: true,
      value: { name: "Ana Pérez", email: "ana@example.com", phone: null },
    });
    expect(validateParticipant({ name: "A", email: "x" }).ok).toBe(false);
    expect(validateParticipant({ name: "Ana", email: "a@b.cl", phone: "abc" }).ok).toBe(false);
    expect(validateParticipant(null).ok).toBe(false);
  });
  it("interpreta el JSON del formulario y rechaza estructuras inválidas", () => {
    expect(parseParticipantsPayload('{"T0001N01":{"name":"A","email":"b"}}')).toEqual({
      T0001N01: { name: "A", email: "b", phone: "" },
    });
    expect(parseParticipantsPayload("[]")).toBeNull();
    expect(parseParticipantsPayload("no json")).toBeNull();
    expect(parseParticipantsPayload('{"t-1":{}}')).toBeNull();
    expect(parseParticipantsPayload("x".repeat(70_000))).toBeNull();
  });
});
