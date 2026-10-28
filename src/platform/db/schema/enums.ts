import { pgEnum } from "drizzle-orm/pg-core";

export const organizationType = pgEnum("organization_type", [
  "individual",
  "school",
]);
export const organizationStatus = pgEnum("organization_status", [
  "active",
  "suspended",
  "archived",
]);
export const memberRole = pgEnum("member_role", [
  "owner",
  "admin",
  "editor",
  "viewer",
]);
export const memberStatus = pgEnum("member_status", [
  "invited",
  "active",
  "suspended",
  "removed",
]);
export const raffleStatus = pgEnum("raffle_status", [
  "draft",
  "published",
  "closed",
  "drawn",
]);
/** BUILD-008: `individual` (numeración clásica) o `booklets` (talonarios foliados). */
export const numberingMode = pgEnum("numbering_mode", ["individual", "booklets"]);
export const numberStatus = pgEnum("number_status", [
  "available",
  "reserved",
  "sold",
]);
export const sellerStatus = pgEnum("seller_status", ["active", "revoked"]);
export const orderStatus = pgEnum("order_status", [
  "draft",
  "pending",
  "confirmed",
  "cancelled",
  "expired",
]);
export const drawingStatus = pgEnum("drawing_status", [
  "pending",
  "completed",
  "voided",
]);
export const redemptionStatus = pgEnum("redemption_status", [
  "pending",
  "redeemed",
]);
