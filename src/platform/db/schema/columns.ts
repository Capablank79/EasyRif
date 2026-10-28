import { timestamp } from "drizzle-orm/pg-core";

/** Timestamps UTC. `updated_at` se mantiene con un trigger (migración 0001). */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
