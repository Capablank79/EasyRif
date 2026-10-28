import { describe, expect, it } from "vitest";
import { validateLogin, validateRegistration } from "@/modules/auth/validation";

describe("validación de autenticación", () => {
  it("normaliza el correo y acepta datos válidos", () => {
    const r = validateRegistration({ name: " Ana ", email: " ANA@Example.COM ", password: "una-clave-larga-1" });
    expect(r.ok && r.values).toEqual({ name: "Ana", email: "ana@example.com", password: "una-clave-larga-1" });
  });
  it("rechaza nombre, correo y contraseña inválidos", () => {
    const r = validateRegistration({ name: "A", email: "x", password: "corta" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["email", "name", "password"]);
  });
  it("rechaza contraseñas excesivamente largas", () => {
    const r = validateRegistration({ name: "Ana", email: "a@b.co", password: "x".repeat(129) });
    expect(r.ok).toBe(false);
  });
  it("login: entrada vacía o malformada devuelve null", () => {
    expect(validateLogin({ email: "", password: "x" })).toBeNull();
    expect(validateLogin({ email: "a@b.co", password: "" })).toBeNull();
    expect(validateLogin({ email: "A@B.co", password: "x" })).toEqual({ email: "a@b.co", password: "x" });
  });
});
