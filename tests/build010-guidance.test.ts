import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREATE_STEPS,
  firstStepWithError,
  missingRequiredInStep,
  nextDraftAction,
  stepForField,
} from "@/modules/raffles/guidance";

const src = (p: string) => readFileSync(path.resolve(import.meta.dirname, "..", p), "utf8");

describe("BUILD-010: guia del asistente de creacion", () => {
  it("tiene 3 pasos y cada campo del formulario pertenece a un paso", () => {
    expect(CREATE_STEPS.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(stepForField("title")).toBe(1);
    expect(stepForField("price")).toBe(1);
    expect(stepForField("numbering")).toBe(2);
    expect(stepForField("bookletCount")).toBe(2);
    expect(stepForField("drawDate")).toBe(3);
    expect(stepForField("desconocido")).toBe(1);
  });

  it("lleva al primer paso con error del servidor", () => {
    expect(firstStepWithError(undefined)).toBeNull();
    expect(firstStepWithError({})).toBeNull();
    expect(firstStepWithError({ title: undefined })).toBeNull();
    expect(firstStepWithError({ drawAt: "x", numberCount: "y" })).toBe(2);
    expect(firstStepWithError({ drawAt: "x", title: "y", bookletCount: "z" })).toBe(1);
  });

  const base = {
    title: "Rifa",
    price: "1000",
    numbering: "individual" as const,
    numberCount: "100",
    bookletCount: "10",
    numbersPerBooklet: "20",
    drawDate: "2030-01-01",
  };

  it("avisa de campos obligatorios vacios por paso sin bloquear datos validos", () => {
    expect(missingRequiredInStep(1, base)).toEqual({});
    expect(Object.keys(missingRequiredInStep(1, { ...base, title: "  ", price: "" })).sort()).toEqual(["price", "title"]);
    expect(missingRequiredInStep(2, base)).toEqual({});
    expect(Object.keys(missingRequiredInStep(2, { ...base, numberCount: "" }))).toEqual(["numberCount"]);
    expect(missingRequiredInStep(3, base)).toEqual({});
  });

  it("exige la fecha del sorteo en todos los modos", () => {
    const b = { ...base, numbering: "booklets" as const };
    expect(Object.keys(missingRequiredInStep(2, { ...b, bookletCount: "", numbersPerBooklet: "" })).sort()).toEqual([
      "bookletCount",
      "numbersPerBooklet",
    ]);
    expect(missingRequiredInStep(3, { ...b, drawDate: "" })).toEqual({ drawDate: "Elige la fecha del sorteo." });
    expect(missingRequiredInStep(3, b)).toEqual({});
  });

  it("sugiere la siguiente accion en el mismo orden que los requisitos de publicacion", () => {
    expect(nextDraftAction({ prizeCount: 0, numberTotal: 0, numberCount: 100 })).toMatchObject({ anchor: "premios", ready: false });
    expect(nextDraftAction({ prizeCount: 1, numberTotal: 50, numberCount: 100 })).toMatchObject({ anchor: "numeracion", ready: false });
    expect(nextDraftAction({ prizeCount: 1, numberTotal: 100, numberCount: 100 })).toMatchObject({ anchor: "publicacion", ready: true });
  });
});

describe("BUILD-010: regresiones de interfaz (verificacion estatica del codigo fuente)", () => {
  const form = src("src/modules/raffles/forms.tsx");
  const img = src("src/modules/raffles/image-control.tsx");

  it("el asistente conserva todos los campos montados al cambiar de paso (hidden, no desmontar)", () => {
    expect(form).toContain("hidden={!show(1)}");
    expect(form).toContain("hidden={!show(2)}");
    expect(form).toContain("hidden={!show(3)}");
  });

  it("el formulario solicita una sola fecha y fija automáticamente los horarios", () => {
    for (const name of ["title", "description", "price", "currency", "numberCount", "drawDate", "bookletCount", "numbersPerBooklet", "firstFolio"]) {
      expect(form).toContain(`name="${name}"`);
    }
    expect(form).toContain("22:00");
    expect(form).toContain("22:30");
    expect(form).not.toContain('name="salesClosesAt"');
    expect(form).not.toContain('name="drawAt"');
    expect(form).toContain('name={lockNumberCount ? undefined : "numbering"}');
  });

  it("bloquea el envio mientras se guarda y reutiliza las acciones del servidor existentes", () => {
    expect(form).toContain("disabled={pending}");
    expect(form).toContain("createRaffleAction");
    expect(form).toContain("updateRaffleAction");
  });

  it("la subida de imagenes sigue siendo automatica, sin boton de subir ni guardar", () => {
    expect(img).toContain("onChange={(e) => onFileChosen(e.currentTarget)}");
    expect(img).toContain("Reemplazar imagen");
    expect(img).toContain("Quitar imagen");
    expect(img).toContain("Subiendo imagen…");
    expect(img).not.toMatch(/Guardar imagen|Cargar imagen|type="submit"/);
  });
});
