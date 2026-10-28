"use server";

import { APIError } from "better-auth/api";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/platform/auth";
import { validateLogin, validateRegistration, type FieldErrors } from "./validation";

export interface FormState {
  error?: string;
  fieldErrors?: FieldErrors;
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = validateRegistration({
    name: str(fd, "name"),
    email: str(fd, "email"),
    password: str(fd, "password"),
  });
  if (!parsed.ok) return { fieldErrors: parsed.errors };
  try {
    await getAuth().api.signUpEmail({ body: parsed.values });
  } catch (e) {
    if (e instanceof APIError) {
      // Mensaje genérico: no revela si el correo ya está registrado.
      return {
        error:
          "No se pudo crear la cuenta. Si ya tienes una, inicia sesión; de lo contrario revisa los datos.",
      };
    }
    throw e;
  }
  redirect("/panel");
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  const parsed = validateLogin({ email: str(fd, "email"), password: str(fd, "password") });
  const generic = { error: "Correo o contraseña incorrectos." };
  if (!parsed) return generic;
  try {
    await getAuth().api.signInEmail({ body: parsed });
  } catch (e) {
    if (e instanceof APIError) return generic;
    throw e;
  }
  redirect("/panel");
}

export async function logoutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/iniciar-sesion");
}
