// Ejecuta un archivo SQL con el rol de migraciones (DATABASE_URL_MIGRATOR). No imprime credenciales.
// Uso: node --env-file-if-exists=.env.local scripts/db/run-sql.mjs scripts/db/02-permisos-app.sql
import { readFileSync } from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
const url = process.env.DATABASE_URL_MIGRATOR;
if (!file || !url) {
  console.error("Uso: run-sql.mjs <archivo.sql>; requiere DATABASE_URL_MIGRATOR.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql.unsafe(readFileSync(file, "utf8"));
  console.log(`OK: ${file}`);
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
