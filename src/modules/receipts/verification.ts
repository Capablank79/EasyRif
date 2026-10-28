import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const VERIFICATION_CODE_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Codigo publico de verificacion: HMAC del id interno con el secreto del servidor y un dominio
 * propio. Es determinista (descargas repetidas producen el mismo QR), no es derivable del token
 * de acceso/liberacion y no revela el id del pedido.
 */
export function deriveVerificationCode(orderId: string, secret = process.env.BETTER_AUTH_SECRET): string {
  if (!secret) throw new Error("BETTER_AUTH_SECRET no esta configurado");
  return createHmac("sha256", secret).update(`verificar:${orderId}`).digest("base64url");
}

export const hashVerificationCode = (code: string) => createHash("sha256").update(code).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Referencia publica corta (no sensible) mostrada en el PDF y la verificacion. */
export const publicReference = (orderId: string) => orderId.slice(0, 8).toUpperCase();
