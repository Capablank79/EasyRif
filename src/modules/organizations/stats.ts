import { count, eq } from "drizzle-orm";
import { raffleNumbers, raffles, sellers } from "@/platform/db/schema";
import type { Database } from "@/platform/db/types";

export interface OrganizationStats {
  raffles: number;
  numbers: number;
  sellers: number;
}

/** Conteos reales de la organización. El llamador debe haber validado la pertenencia. */
export async function getOrganizationStats(
  db: Database,
  organizationId: string,
): Promise<OrganizationStats> {
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [r, n, s] = await Promise.all([
    one(db.select({ n: count() }).from(raffles).where(eq(raffles.organizationId, organizationId))),
    one(db.select({ n: count() }).from(raffleNumbers).where(eq(raffleNumbers.organizationId, organizationId))),
    one(db.select({ n: count() }).from(sellers).where(eq(sellers.organizationId, organizationId))),
  ]);
  return { raffles: r, numbers: n, sellers: s };
}
