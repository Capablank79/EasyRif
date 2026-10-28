"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loginAction, registerAction, type FormState } from "./actions";
import { MIN_PASSWORD_LENGTH } from "./validation";

const input =
  "mt-1 block min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-navy-950 focus:border-navy-700 focus:outline-2 focus:outline-offset-2 focus:outline-navy-700";

function Field({
  label,
  name,
  type,
  autoComplete,
  error,
  hint,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  error?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="text-sm font-medium text-navy-900">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-err` : hint ? `${name}-hint` : undefined}
        className={input}
      />
      {hint && !error && (
        <p id={`${name}-hint`} className="mt-1 text-xs text-navy-700">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-err`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const [state, action, pending] = useActionState<FormState, FormData>(
    isRegister ? registerAction : loginAction,
    {},
  );
  return (
    <Card className="mx-auto w-full max-w-md">
      <h1 className="text-2xl font-bold text-navy-900">
        {isRegister ? "Crear cuenta" : "Iniciar sesión"}
      </h1>
      <form action={action} className="mt-5 space-y-4" noValidate>
        {state.error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {state.error}
          </p>
        )}
        {isRegister && (
          <Field label="Nombre" name="name" type="text" autoComplete="name" error={state.fieldErrors?.name} />
        )}
        <Field label="Correo electrónico" name="email" type="email" autoComplete="email" error={state.fieldErrors?.email} />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          error={state.fieldErrors?.password}
          hint={isRegister ? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres.` : undefined}
        />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Procesando…" : isRegister ? "Crear cuenta" : "Entrar"}
        </Button>
      </form>
      <p className="mt-4 text-sm text-navy-700">
        {isRegister ? "¿Ya tienes cuenta? " : "¿No tienes cuenta? "}
        <Link
          href={isRegister ? "/iniciar-sesion" : "/registro"}
          className="font-semibold text-navy-900 underline"
        >
          {isRegister ? "Inicia sesión" : "Regístrate"}
        </Link>
      </p>
      {!isRegister && (
        <p className="mt-2 text-xs text-navy-700">
          La recuperación de contraseña estará disponible cuando se configure un
          proveedor de correo.
        </p>
      )}
    </Card>
  );
}
