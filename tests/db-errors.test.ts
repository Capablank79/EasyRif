import { describe, expect, it } from "vitest";
import { databaseErrorMessage, pgErrorInfo } from "@/modules/raffles/db-errors";

const pg = (code: string, message: string) => Object.assign(new Error("Failed query: update raffles set ..."), { cause: { code, message } });

describe("errores de PostgreSQL comprensibles", () => {
  it("traduce el trigger de cierre sin exponer SQL", () => {
    const msg = databaseErrorMessage(pg("P0001", "el cierre de ventas solo puede extenderse una vez publicada la rifa"));
    expect(msg).toContain("cierre de ventas");
    expect(msg).not.toMatch(/update|select|raffles/i);
  });
  it("mensajes genéricos para restricciones y fallos desconocidos", () => {
    expect(databaseErrorMessage(pg("23514", "x"))).toMatch(/no son válidos/);
    expect(databaseErrorMessage(pg("XX000", "x"))).not.toMatch(/Failed query/);
  });
  it("ignora errores que no son de base de datos y expone SQLSTATE solo para logs", () => {
    expect(databaseErrorMessage(new Error("boom"))).toBeNull();
    expect(pgErrorInfo(pg("P0001", "m"))).toMatchObject({ sqlstate: "P0001" });
  });
});
