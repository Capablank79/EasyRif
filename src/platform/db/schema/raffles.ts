import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { numberStatus, numberingMode, raffleStatus, sellerStatus } from "./enums";
import { organizations, users } from "./identity";

export const raffles = pgTable(
  "raffles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    createdBy: uuid("created_by"),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: raffleStatus("status").notNull().default("draft"),
    priceCents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("CLP"),
    numberCount: integer("number_count").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Clave opaca (uuid) de la imagen principal en el almacenamiento. */
    imageKey: uuid("image_key"),
    /**
     * Configuración de talonarios (solo `booklets`). `number_count` sigue siendo el total de
     * participaciones (= talonarios × números por talonario), por lo que no hay otra fuente de verdad.
     */
    numberingMode: numberingMode("numbering_mode").notNull().default("individual"),
    bookletCount: integer("booklet_count"),
    numbersPerBooklet: integer("numbers_per_booklet"),
    firstFolio: integer("first_folio"),
    /**
     * Cierre de ventas y sorteo posterior (BUILD-008 V0.8.1). `ends_at` conserva su significado histórico
     * (fecha estimada de sorteo informativa) y no se reinterpreta.
     */
    salesClosesAt: timestamp("sales_closes_at", { withTimezone: true }),
    drawAt: timestamp("draw_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "raffles_org_fk",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "raffles_created_by_fk",
      columns: [t.createdBy],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    unique("raffles_slug_uq").on(t.slug),
    // Referenciada por las tablas hijas para forzar la misma organización.
    unique("raffles_id_org_uq").on(t.id, t.organizationId),
    index("raffles_org_status_idx").on(t.organizationId, t.status),
    check(
      "raffles_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) between 3 and 64`,
    ),
    check("raffles_title_len", sql`char_length(btrim(${t.title})) between 1 and 200`),
    check("raffles_price_nonneg", sql`${t.priceCents} >= 0`),
    check("raffles_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("raffles_number_count_pos", sql`${t.numberCount} > 0`),
    check(
      "raffles_numbering_config",
      sql`(${t.numberingMode} = 'individual'
            and ${t.bookletCount} is null and ${t.numbersPerBooklet} is null and ${t.firstFolio} is null)
        or (${t.numberingMode} = 'booklets'
            and ${t.bookletCount} > 0 and ${t.numbersPerBooklet} > 0 and ${t.firstFolio} >= 1
            and ${t.firstFolio} + ${t.bookletCount} - 1 <= 99999
            and ${t.numbersPerBooklet} <= 9999
            and ${t.numberCount} = ${t.bookletCount} * ${t.numbersPerBooklet})`,
    ),
    check(
      "raffles_dates_order",
      sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
    check(
      "raffles_sales_draw_order",
      sql`${t.salesClosesAt} is null or ${t.drawAt} is null or ${t.drawAt} > ${t.salesClosesAt}`,
    ),
  ],
);

export const prizes = pgTable(
  "prizes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    imageKey: uuid("image_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "prizes_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    unique("prizes_raffle_position_uq").on(t.raffleId, t.position),
    unique("prizes_id_raffle_uq").on(t.id, t.raffleId),
    check("prizes_position_pos", sql`${t.position} >= 1`),
    check("prizes_title_len", sql`char_length(btrim(${t.title})) between 1 and 200`),
  ],
);

/** Plantilla/contenido de producto de una campaña. No almacena PDF todavía. */
export const digitalProducts = pgTable(
  "digital_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    templateRef: text("template_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "digital_products_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    unique("digital_products_id_raffle_uq").on(t.id, t.raffleId),
    index("digital_products_raffle_idx").on(t.raffleId),
    check("digital_products_name_len", sql`char_length(btrim(${t.name})) between 1 and 200`),
  ],
);

/**
 * Talonario foliado (BUILD-008). El folio es un entero; el formato con ceros (0007) es solo presentación.
 * Cada talonario contiene la misma serie 1..N de números internos (`raffle_numbers.local_number`).
 */
export const booklets = pgTable(
  "booklets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    folio: integer("folio").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "booklets_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    unique("booklets_raffle_folio_uq").on(t.raffleId, t.folio),
    unique("booklets_id_raffle_uq").on(t.id, t.raffleId),
    check("booklets_folio_range", sql`${t.folio} between 1 and 99999`),
  ],
);

export const raffleNumbers = pgTable(
  "raffle_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    /**
     * Clave única por rifa. Individual: "001". Talonarios: "T0007N14" (folio + número interno con
     * ceros fijos); la clave se valida contra `booklet_id`/`local_number` en un trigger.
     */
    number: text("number").notNull(),
    bookletId: uuid("booklet_id"),
    localNumber: integer("local_number"),
    status: numberStatus("status").notNull().default("available"),
    reservationId: uuid("reservation_id"),
    reservedUntil: timestamp("reserved_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "raffle_numbers_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "raffle_numbers_booklet_fk",
      columns: [t.bookletId, t.raffleId],
      foreignColumns: [booklets.id, booklets.raffleId],
    }).onDelete("cascade"),
    unique("raffle_numbers_booklet_local_uq").on(t.bookletId, t.localNumber),
    index("raffle_numbers_booklet_status_idx").on(t.bookletId, t.status),
    check(
      "raffle_numbers_booklet_pair",
      sql`(${t.bookletId} is null and ${t.localNumber} is null)
        or (${t.bookletId} is not null and ${t.localNumber} between 1 and 9999)`,
    ),
    unique("raffle_numbers_raffle_number_uq").on(t.raffleId, t.number),
    unique("raffle_numbers_id_raffle_uq").on(t.id, t.raffleId),
    index("raffle_numbers_raffle_status_idx").on(t.raffleId, t.status),
    index("raffle_numbers_reserved_until_idx")
      .on(t.reservedUntil)
      .where(sql`${t.status} = 'reserved'`),
    check("raffle_numbers_format", sql`${t.number} ~ '^[A-Z0-9]{1,12}$'`),
    check(
      "raffle_numbers_reservation_consistent",
      sql`(${t.status} = 'reserved' and ${t.reservedUntil} is not null and ${t.reservationId} is not null)
        or (${t.status} <> 'reserved' and ${t.reservedUntil} is null and ${t.reservationId} is null)`,
    ),
  ],
);

/**
 * Unidad numerada de un producto digital: une un producto con un número único.
 * `document_ref` queda nulo hasta que exista el módulo de PDF.
 */
export const numberedProductUnits = pgTable(
  "numbered_product_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    digitalProductId: uuid("digital_product_id").notNull(),
    raffleNumberId: uuid("raffle_number_id").notNull(),
    documentRef: text("document_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "numbered_units_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "numbered_units_product_fk",
      columns: [t.digitalProductId, t.raffleId],
      foreignColumns: [digitalProducts.id, digitalProducts.raffleId],
    }).onDelete("cascade"),
    foreignKey({
      name: "numbered_units_number_fk",
      columns: [t.raffleNumberId, t.raffleId],
      foreignColumns: [raffleNumbers.id, raffleNumbers.raffleId],
    }).onDelete("cascade"),
    unique("numbered_units_product_number_uq").on(
      t.digitalProductId,
      t.raffleNumberId,
    ),
    index("numbered_units_number_idx").on(t.raffleNumberId),
  ],
);

/** El token público se guarda solo como hash SHA-256 (hex). */
export const sellers = pgTable(
  "sellers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    raffleId: uuid("raffle_id"),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    tokenHash: text("token_hash").notNull(),
    status: sellerStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "sellers_org_fk",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "sellers_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("restrict"),
    unique("sellers_token_hash_uq").on(t.tokenHash),
    unique("sellers_id_org_uq").on(t.id, t.organizationId),
    uniqueIndex("sellers_raffle_email_uq").on(t.raffleId, t.email).where(sql`${t.email} is not null`),
    index("sellers_org_idx").on(t.organizationId),
    check("sellers_token_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("sellers_name_len", sql`char_length(btrim(${t.displayName})) between 1 and 160`),
    check("sellers_email_format", sql`${t.email} is null or (${t.email} = lower(btrim(${t.email})) and char_length(${t.email}) <= 254 and ${t.email} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')`),
    check("sellers_phone_format", sql`${t.phone} is null or ${t.phone} ~ '^[0-9+()[:space:]-]{6,20}$'`),
  ],
);

/**
 * Historial de responsables por talonario (BUILD-008 V0.8.1). Las filas nunca se borran ni se reescriben:
 * reasignar cierra la fila vigente (`ended_at`) y abre otra. Un solo responsable vigente por talonario.
 */
export const bookletAssignments = pgTable(
  "booklet_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    bookletId: uuid("booklet_id").notNull(),
    sellerId: uuid("seller_id").notNull(),
    assignedBy: uuid("assigned_by"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by"),
  },
  (t) => [
    foreignKey({
      name: "booklet_assignments_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "booklet_assignments_booklet_fk",
      columns: [t.bookletId, t.raffleId],
      foreignColumns: [booklets.id, booklets.raffleId],
    }).onDelete("cascade"),
    foreignKey({
      name: "booklet_assignments_seller_org_fk",
      columns: [t.sellerId, t.organizationId],
      foreignColumns: [sellers.id, sellers.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("booklet_assignments_active_uq")
      .on(t.bookletId)
      .where(sql`${t.endedAt} is null`),
    index("booklet_assignments_seller_idx").on(t.sellerId),
    index("booklet_assignments_raffle_idx").on(t.raffleId),
    check("booklet_assignments_period", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.assignedAt}`),
  ],
);
