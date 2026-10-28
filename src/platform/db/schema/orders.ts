import { sql } from "drizzle-orm";
import {
  boolean,
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
import { orderStatus } from "./enums";
import { organizations } from "./identity";
import { digitalProducts, raffleNumbers, raffles, sellers } from "./raffles";

/** Contacto mínimo de un comprador invitado (sin cuenta). */
export const buyerContacts = pgTable(
  "buyer_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "buyer_contacts_org_fk",
      columns: [t.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("restrict"),
    unique("buyer_contacts_id_org_uq").on(t.id, t.organizationId),
    check("buyer_contacts_name_len", sql`char_length(btrim(${t.name})) between 1 and 160`),
    check(
      "buyer_contacts_has_contact",
      sql`${t.email} is not null or ${t.phone} is not null`,
    ),
  ],
);

/**
 * Pedido. No existe estado de pago aquí: el pago será una entidad
 * independiente en una fase posterior. `is_demo` marca pedidos de demostración.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    buyerContactId: uuid("buyer_contact_id"),
    sellerId: uuid("seller_id"),
    status: orderStatus("status").notNull().default("draft"),
    totalCents: integer("total_cents").notNull().default(0),
    currency: text("currency").notNull().default("CLP"),
    isDemo: boolean("is_demo").notNull().default(true),
    /** SHA-256 del token opaco de acceso del invitado (el token nunca se guarda). */
    accessTokenHash: text("access_token_hash"),
    /** SHA-256 de la clave de idempotencia enviada por el cliente. */
    requestKeyHash: text("request_key_hash"),
    /** Vencimiento de la reserva temporal (fijado por el servidor). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** SHA-256 del codigo publico de verificacion del comprobante (distinto del token de acceso). */
    verificationHash: text("verification_hash"),
    /** Primera emision del comprobante; las descargas posteriores reutilizan este instante. */
    receiptIssuedAt: timestamp("receipt_issued_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "orders_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_buyer_org_fk",
      columns: [t.buyerContactId, t.organizationId],
      foreignColumns: [buyerContacts.id, buyerContacts.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "orders_seller_org_fk",
      columns: [t.sellerId, t.organizationId],
      foreignColumns: [sellers.id, sellers.organizationId],
    }).onDelete("restrict"),
    unique("orders_id_raffle_uq").on(t.id, t.raffleId),
    index("orders_raffle_status_idx").on(t.raffleId, t.status),
    uniqueIndex("orders_access_token_uq").on(t.accessTokenHash),
    uniqueIndex("orders_verification_uq").on(t.verificationHash),
    uniqueIndex("orders_request_key_uq").on(t.raffleId, t.requestKeyHash),
    // Un pedido de demostración nunca puede figurar como confirmado.
    check("orders_demo_never_confirmed", sql`not ${t.isDemo} or ${t.status} <> 'confirmed'`),
    check(
      "orders_demo_has_expiry",
      sql`${t.accessTokenHash} is null or ${t.status} <> 'pending' or ${t.expiresAt} is not null`,
    ),
    check("orders_total_nonneg", sql`${t.totalCents} >= 0`),
    check("orders_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    raffleNumberId: uuid("raffle_number_id").notNull(),
    digitalProductId: uuid("digital_product_id"),
    priceCents: integer("price_cents").notNull(),
    /** Mantenido por trigger: true mientras el pedido es `pending` o `confirmed`. */
    holdsNumber: boolean("holds_number").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "order_items_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_items_order_fk",
      columns: [t.orderId, t.raffleId],
      foreignColumns: [orders.id, orders.raffleId],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_items_number_fk",
      columns: [t.raffleNumberId, t.raffleId],
      foreignColumns: [raffleNumbers.id, raffleNumbers.raffleId],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_items_product_fk",
      columns: [t.digitalProductId, t.raffleId],
      foreignColumns: [digitalProducts.id, digitalProducts.raffleId],
    }).onDelete("restrict"),
    unique("order_items_order_number_uq").on(t.orderId, t.raffleNumberId),
    unique("order_items_id_raffle_uq").on(t.id, t.raffleId),
    // Un número no puede estar retenido por dos pedidos activos a la vez.
    uniqueIndex("order_items_number_held_uq")
      .on(t.raffleNumberId)
      .where(sql`${t.holdsNumber}`),
    index("order_items_order_idx").on(t.orderId),
    check("order_items_price_nonneg", sql`${t.priceCents} >= 0`),
  ],
);

/**
 * Participante asociado a UNA participación concreta (`order_item`), distinto del comprador (BUILD-008 V0.8.1).
 * Datos personales de terceros: nunca se exponen en URLs, QR, verificación pública ni registros.
 */
export const orderItemParticipants = pgTable(
  "order_item_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderItemId: uuid("order_item_id").notNull(),
    orderId: uuid("order_id").notNull(),
    raffleId: uuid("raffle_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "participants_raffle_org_fk",
      columns: [t.raffleId, t.organizationId],
      foreignColumns: [raffles.id, raffles.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "participants_item_fk",
      columns: [t.orderItemId, t.raffleId],
      foreignColumns: [orderItems.id, orderItems.raffleId],
    }).onDelete("cascade"),
    unique("participants_item_uq").on(t.orderItemId),
    index("participants_order_idx").on(t.orderId),
    check("participants_name_len", sql`char_length(btrim(${t.name})) between 2 and 100`),
    check("participants_email_format", sql`${t.email} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' and char_length(${t.email}) <= 254`),
    check("participants_phone_format", sql`${t.phone} is null or ${t.phone} ~ '^[0-9+()[:space:]-]{6,20}$'`),
  ],
);
