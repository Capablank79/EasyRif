import { and, asc, eq, sql } from "drizzle-orm";
import { recordAuditEvent } from "@/platform/audit";
import { organizationMembers, organizations } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";

/**
 * Garantiza que el usuario tenga una organización. Si no tiene ninguna
 * membresía crea, en una sola transacción, la organización individual y su
 * membresía de propietario. Es idempotente y nunca usa ids aportados por el cliente.
 */
export async function ensureDefaultOrganization(
  db: Database,
  userId: string,
  displayName: string,
): Promise<{ organizationId: string; created: boolean }> {
  return db.transaction(async (tx) => {
    // Serializa el aprovisionamiento concurrente del mismo usuario.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const existing = await tx
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId))
      .orderBy(asc(organizationMembers.createdAt))
      .limit(1);
    if (existing[0]) {
      return { organizationId: existing[0].organizationId, created: false };
    }
    const name = displayName.trim().slice(0, 150) || "Mi organización";
    const [org] = await tx
      .insert(organizations)
      .values({ name, type: "individual" })
      .returning({ id: organizations.id });
    await tx.insert(organizationMembers).values({
      organizationId: org.id,
      userId,
      role: "owner",
      status: "active",
    });
    await recordAuditEvent(tx as unknown as Database, {
      organizationId: org.id,
      actorId: userId,
      entityType: "organization",
      entityId: org.id,
      action: "organization.created",
      metadata: { source: "registro" },
    });
    return { organizationId: org.id, created: true };
  });
}

export interface UserOrganization {
  id: string;
  name: string;
  type: "individual" | "school";
  role: "owner" | "admin" | "editor" | "viewer";
}

/** Organizaciones activas del usuario (solo aquellas donde es miembro activo). */
export async function listUserOrganizations(
  db: Database,
  userId: string,
): Promise<UserOrganization[]> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      type: organizations.type,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId),
    )
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "active"),
        eq(organizations.status, "active"),
      ),
    )
    .orderBy(asc(organizationMembers.createdAt));
  return rows as UserOrganization[];
}
