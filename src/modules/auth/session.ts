import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ensureDefaultOrganization,
  listUserOrganizations,
  type UserOrganization,
} from "@/modules/organizations/provision";
import { getAuth } from "@/platform/auth";
import { getDb } from "@/platform/db/client";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Sesión validada contra PostgreSQL, o null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? "",
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/iniciar-sesion");
  return user;
}

/**
 * Organización activa: se elige solo entre las membresías activas del usuario
 * (el parámetro `org` del cliente se valida, nunca se confía en él).
 */
export async function requireOrganizationContext(requestedOrgId?: string) {
  const user = await requireUser();
  const db = getDb();
  let orgs: UserOrganization[] = await listUserOrganizations(db, user.id);
  if (orgs.length === 0) {
    await ensureDefaultOrganization(db, user.id, user.name);
    orgs = await listUserOrganizations(db, user.id);
  }
  const active = orgs.find((o) => o.id === requestedOrgId) ?? orgs[0];
  if (!active) redirect("/iniciar-sesion");
  return { user, organizations: orgs, active };
}
