import { and, eq } from "drizzle-orm";
import type { Database } from "@/platform/db/types";
import { organizationMembers, organizations, platformAdmins } from "@/platform/db/schema";
import { assertCan, type OrgAction, type OrgRole } from "./permissions";

/**
 * Rol activo del usuario en la organización, o null. La membresía y la
 * organización deben estar activas. Estar autenticado
 * no implica pertenecer a una organización.
 */
export async function getActiveRole(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<OrgRole | null> {
  const rows = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId),
    )
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "active"),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

/** Verifica en servidor que el usuario puede ejecutar `action`; lanza si no. */
export async function requireOrgPermission(
  db: Database,
  userId: string,
  organizationId: string,
  action: OrgAction,
): Promise<OrgRole> {
  const role = await getActiveRole(db, userId, organizationId);
  assertCan(role, action);
  return role;
}

export async function isPlatformAdmin(
  db: Database,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return rows.length > 0;
}
