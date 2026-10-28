import { defineConfig } from "drizzle-kit";

// `generate` no necesita conexión. `migrate` usa el rol de migraciones (DDL).
// DATABASE_URL_MIGRATOR nunca lo usa la aplicación en ejecución.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/platform/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
