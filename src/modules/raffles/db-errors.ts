/** Traduce errores de PostgreSQL a mensajes seguros: nunca incluye SQL, parámetros ni nombres internos. */

interface PgLike {
  code?: string;
  constraint_name?: string;
  message?: string;
}

/** drizzle envuelve el error de postgres-js en `cause`. */
function findPgError(e: unknown): PgLike | null {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 4; depth++) {
    const c = cur as PgLike & { cause?: unknown };
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return c;
    cur = c.cause;
  }
  return null;
}

/** Datos técnicos para el registro del servidor (SQLSTATE y restricción), sin la consulta. */
export function pgErrorInfo(e: unknown) {
  const pg = findPgError(e);
  return pg ? { sqlstate: pg.code, constraint: pg.constraint_name, detail: pg.message } : null;
}

/** Mensajes de las excepciones de triggers (P0001) que sí son accionables para el usuario. */
const TRIGGER_MESSAGES: [RegExp, string][] = [
  [/cierre de ventas solo puede extenderse/i, "Con la rifa publicada, el cierre de ventas solo puede extenderse."],
  [/cierre de ventas debe estar en el futuro/i, "El cierre de ventas debe estar en el futuro."],
  [/requiere cierre de ventas y fecha de sorteo/i, "Define las fechas de cierre de ventas y sorteo antes de publicar."],
  [/ventas de esta campana estan cerradas/i, "Las ventas de esta campaña están cerradas."],
  [/numeracion|numeros ya fueron generados/i, "Los números ya fueron generados: no se puede cambiar la numeración."],
];

export function databaseErrorMessage(e: unknown): string | null {
  const pg = findPgError(e);
  if (!pg) return null;
  switch (pg.code) {
    case "P0001":
      for (const [re, msg] of TRIGGER_MESSAGES) if (re.test(pg.message ?? "")) return msg;
      return "No se pudo guardar: la operación no cumple las reglas de la campaña. Revisa los datos e inténtalo de nuevo.";
    case "23505":
      return "Ya existe un registro con esos datos. Revisa el valor e inténtalo de nuevo.";
    case "23514":
    case "23502":
    case "23503":
      return "Algunos datos no son válidos para guardar la rifa. Revísalos e inténtalo de nuevo.";
    case "40001":
    case "40P01":
      return "Otra persona está modificando esta rifa. Inténtalo de nuevo en unos segundos.";
    default:
      return "No se pudo guardar los cambios por un problema temporal. Inténtalo de nuevo.";
  }
}
