/** Indica si `DATABASE_URL` está definida (solo servidor). No prueba la conexión. */
export function isDatabaseConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.DATABASE_URL);
}
