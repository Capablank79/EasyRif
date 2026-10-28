export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function validateRegistration(input: {
  name: string;
  email: string;
  password: string;
}): { ok: true; values: { name: string; email: string; password: string } } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (name.length < 2 || name.length > 120) {
    errors.name = "Escribe tu nombre (entre 2 y 120 caracteres).";
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    errors.email = "Escribe un correo electrónico válido.";
  }
  if (
    input.password.length < MIN_PASSWORD_LENGTH ||
    input.password.length > MAX_PASSWORD_LENGTH
  ) {
    errors.password = `La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { name, email, password: input.password } };
}

export function validateLogin(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email) || !input.password || input.password.length > MAX_PASSWORD_LENGTH) {
    return null;
  }
  return { email, password: input.password };
}
