import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Tipo común de base de datos (postgres-js en producción, PGlite en tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
