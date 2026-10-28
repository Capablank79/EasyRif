import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";
import { isDatabaseConfigured } from "@/lib/env";
import { MODULES } from "@/modules/registry";

describe("cn", () => {
  it("omite valores falsos", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("isDatabaseConfigured", () => {
  it("es falso sin DATABASE_URL", () => {
    expect(isDatabaseConfigured({})).toBe(false);
  });
  it("es verdadero con DATABASE_URL", () => {
    expect(isDatabaseConfigured({ DATABASE_URL: "postgres://x" })).toBe(true);
  });
});

describe("registro de módulos", () => {
  it("incluye los siete módulos requeridos", () => {
    expect(MODULES.map((m) => m.slug).sort()).toEqual(
      [
        "auth",
        "drawings",
        "numbered-products",
        "orders",
        "organizations",
        "raffles",
        "schools",
      ].sort(),
    );
  });
});
