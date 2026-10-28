import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "DATABASE_URL no está configurada. No hay conexión a base de datos en este entorno.",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

let cached: ReturnType<typeof create> | undefined;

function create(url: string) {
  return drizzle(postgres(url), { schema });
}

/**
 * Cliente de servidor con el rol SQL definido en DATABASE_URL (sin RLS en esta fase).
 * Nunca importar desde componentes de cliente; las autorizaciones se
 * verifican antes en el servidor (ver `modules/organizations/permissions`).
 */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  cached ??= create(url);
  return cached;
}
