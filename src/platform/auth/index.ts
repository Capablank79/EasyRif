import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/modules/auth/validation";
import { ensureDefaultOrganization } from "@/modules/organizations/provision";
import { getDb } from "@/platform/db/client";
import {
  authAccounts,
  authSessions,
  authVerifications,
  users,
} from "@/platform/db/schema";

/** Argon2id (algoritmo 2) con parámetros OWASP: 19 MiB, 2 iteraciones, 1 hilo. */
const ARGON2 = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

function create() {
  const db = getDb();
  const isProd = process.env.NODE_ENV === "production";
  return betterAuth({
    appName: "EasyRif",
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    user: { fields: { name: "displayName" } },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: isProd },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // Sin proveedor de correo no hay verificación ni recuperación de contraseña (ver docs).
      requireEmailVerification: false,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensureDefaultOrganization(db, user.id, user.name ?? "");
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

let cached: ReturnType<typeof create> | undefined;

/** Instancia perezosa: requiere DATABASE_URL y BETTER_AUTH_SECRET. */
export function getAuth() {
  cached ??= create();
  return cached;
}
