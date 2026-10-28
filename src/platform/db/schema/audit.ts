import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./columns";

/**
 * Registro de auditoría append-only (triggers de la migración 0001).
 * Sin claves foráneas: la evidencia debe sobrevivir al borrado de entidades.
 * Nunca registrar secretos ni datos bancarios en `metadata`.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id"),
    actorId: uuid("actor_id"),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_events_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
    check("audit_events_metadata_object", sql`jsonb_typeof(${t.metadata}) = 'object'`),
    check("audit_events_action_len", sql`char_length(${t.action}) between 1 and 100`),
  ],
);
