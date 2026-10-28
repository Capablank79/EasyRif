export class PublicUrlError extends Error {}

const LOCAL_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|\[?::1?\]?|\[::ffff:.*\])$/i;

/**
 * URL publica base para el QR. Sale solo de la configuracion (nunca de cabeceras HTTP).
 * En produccion exige https y un host publico; fuera de produccion admite localhost.
 */
export function resolvePublicBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const production = env.NODE_ENV === "production";
  const raw = (env.NEXT_PUBLIC_APP_URL ?? "").trim() || (production ? "" : (env.BETTER_AUTH_URL ?? "").trim() || "http://localhost:3000");
  if (!raw) throw new PublicUrlError("NEXT_PUBLIC_APP_URL no esta configurada");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new PublicUrlError("NEXT_PUBLIC_APP_URL no es una URL valida");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new PublicUrlError("NEXT_PUBLIC_APP_URL debe ser http(s)");
  if (u.username || u.password) throw new PublicUrlError("NEXT_PUBLIC_APP_URL no admite credenciales");
  if (production) {
    if (u.protocol !== "https:") throw new PublicUrlError("En produccion NEXT_PUBLIC_APP_URL debe usar https");
    if (LOCAL_HOST.test(u.hostname) || !u.hostname.includes(".")) throw new PublicUrlError("En produccion NEXT_PUBLIC_APP_URL no puede ser local");
  }
  return u.origin;
}
