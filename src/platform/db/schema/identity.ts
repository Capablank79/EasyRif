import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import {
  memberRole,
  memberStatus,
  organizationStatus,
  organizationType,
} from "./enums";

/**
 * Usuarios propios del sistema (UUID local, sin proveedor externo).
 * Las tablas de cuentas/sesiones/credenciales se añadirán cuando se elija la
 * biblioteca de autenticación; aquí NO se guardan contraseñas.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    // El email se guarda normalizado (minúsculas, sin espacios).
    check(
      "users_email_normalized",
      sql`${t.email} = lower(btrim(${t.email})) and ${t.email} ~ '^[^@\\s]+@[^@\\s]+$' and char_length(${t.email}) <= 254`,
    ),
    check(
      "users_display_name_len",
      sql`${t.displayName} is null or char_length(${t.displayName}) <= 120`,
    ),
  ],
);

/** Superadministradores internos: separados de los roles organizacionales. */
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: organizationType("type").notNull().default("individual"),
    status: organizationStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "organizations_name_len",
      sql`char_length(btrim(${t.name})) between 1 and 160`,
    ),
  ],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: memberRole("role").notNull(),
    status: memberStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "organization_members_org_fk",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "organization_members_user_fk",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),
    unique("organization_members_org_user_uq").on(t.organizationId, t.userId),
    index("organization_members_user_idx").on(t.userId, t.status),
  ],
);
