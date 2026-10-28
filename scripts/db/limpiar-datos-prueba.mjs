import postgres from "postgres";

// Limpieza de usuarios de prueba (@example.invalid) y organizaciones asociadas, con el rol migrador.
const sql = postgres(process.env.DATABASE_URL_MIGRATOR, { onnotice: () => {} });
const before = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE '%@example.invalid'`;
const orgs = await sql`SELECT DISTINCT m.organization_id AS id FROM organization_members m JOIN users u ON u.id = m.user_id WHERE u.email LIKE '%@example.invalid'`;
for (const o of orgs) {
  await sql`DELETE FROM orders WHERE organization_id = ${o.id}`;
  await sql`DELETE FROM buyer_contacts WHERE organization_id = ${o.id}`;
  // El historial de asignaciones es append-only: solo la limpieza de pruebas lo desactiva, con el rol migrador.
  await sql`ALTER TABLE booklet_assignments DISABLE TRIGGER booklet_assignments_guard`;
  await sql`DELETE FROM booklet_assignments WHERE organization_id = ${o.id}`;
  await sql`ALTER TABLE booklet_assignments ENABLE TRIGGER booklet_assignments_guard`;
  await sql`DELETE FROM sellers WHERE organization_id = ${o.id}`;
  await sql`DELETE FROM raffles WHERE organization_id = ${o.id}`;
  await sql`DELETE FROM organizations WHERE id = ${o.id}`;
}
await sql`DELETE FROM users WHERE email LIKE '%@example.invalid'`;
const after = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE '%@example.invalid'`;
console.log(JSON.stringify({ antes: before[0].n, despues: after[0].n, orgs: orgs.length }));
await sql.end();
