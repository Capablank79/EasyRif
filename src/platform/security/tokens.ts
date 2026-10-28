import { createHash, randomBytes } from "node:crypto";

/** Token público de vendedor: aleatorio, sin información sensible. */
export function generateSellerToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** SHA-256 en hex (64 caracteres), el formato exigido por `sellers.token_hash`. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
