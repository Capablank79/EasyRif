import { sql } from "drizzle-orm";
import { auditEvents } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";

export interface AuditEventInput {
  organizationId: string | null;
  actorId: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  /** Contexto seguro. Se sanea antes de guardar. */
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|card|cvv|iban|account[-_]?number|bank|service[-_]?role/i;
const MAX_DEPTH = 5;

/** Reemplaza valores de claves sensibles; nunca se deben auditar secretos ni datos bancarios. */
export function sanitizeAuditMetadata(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeAuditMetadata(v, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? "[REDACTED]" : sanitizeAuditMetadata(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** Registra un evento administrativo (solo servidor; la tabla es append-only). */
export async function recordAuditEvent(
  db: Database,
  input: AuditEventInput,
): Promise<void> {
  const metadata = sanitizeAuditMetadata(input.metadata ?? {}) as Record<
    string,
    unknown
  >;
  await db.insert(auditEvents).values({
    organizationId: input.organizationId,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    metadata: sql`${JSON.stringify(metadata)}::jsonb`,
  });
}
