import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, F, id, seed, type TestClient } from "./harness";

let client: TestClient;
const q = (sql: string, params: unknown[] = []) => client.query(sql, params);

beforeAll(async () => {
  ({ client } = await createTestDb());
  await seed(client);
});
afterAll(async () => {
  await client.close();
});

describe("numeración única", () => {
  it("rechaza un número repetido en la misma campaña", async () => {
    await expect(
      q(
        `INSERT INTO raffle_numbers (raffle_id, organization_id, number) VALUES ($1,$2,'001')`,
        [F.raffleAPub, F.orgA],
      ),
    ).rejects.toThrow(/raffle_numbers_raffle_number_uq/);
  });

  it("permite el mismo número en otra campaña", async () => {
    await expect(
      q(
        `INSERT INTO raffle_numbers (raffle_id, organization_id, number) VALUES ($1,$2,'002')`,
        [F.raffleBPub, F.orgB],
      ),
    ).resolves.toBeDefined();
  });

  it("valida el formato (conserva ceros, solo A-Z0-9)", async () => {
    for (const bad of ["", "a b", "x-1", "1234567890123"]) {
      await expect(
        q(
          `INSERT INTO raffle_numbers (raffle_id, organization_id, number) VALUES ($1,$2,$3)`,
          [F.raffleAPub, F.orgA, bad],
        ),
      ).rejects.toThrow(/raffle_numbers_format/);
    }
    const r = await q(`SELECT number FROM raffle_numbers WHERE id = $1`, [F.numA1]);
    expect((r.rows[0] as { number: string }).number).toBe("001");
  });

  it("exige coherencia de la reserva con el estado", async () => {
    await expect(
      q(`UPDATE raffle_numbers SET status='reserved' WHERE id=$1`, [F.numA1]),
    ).rejects.toThrow(/reservation_consistent/);
    await expect(
      q(`UPDATE raffle_numbers SET reserved_until = now() WHERE id=$1`, [F.numA1]),
    ).rejects.toThrow(/reservation_consistent/);
    await expect(
      q(
        `UPDATE raffle_numbers SET status='reserved', reserved_until = now() + interval '10 minutes', reservation_id = $2 WHERE id=$1`,
        [F.numA1, id(9001)],
      ),
    ).resolves.toBeDefined();
    await q(
      `UPDATE raffle_numbers SET status='available', reserved_until=NULL, reservation_id=NULL WHERE id=$1`,
      [F.numA1],
    );
  });
});

describe("aislamiento por organización a nivel de claves foráneas", () => {
  it("un premio no puede apuntar a una campaña de otra organización", async () => {
    await expect(
      q(
        `INSERT INTO prizes (raffle_id, organization_id, title, position) VALUES ($1,$2,'x',5)`,
        [F.raffleBPub, F.orgA],
      ),
    ).rejects.toThrow(/prizes_raffle_org_fk/);
  });

  it("organization_id de una campaña es inmutable", async () => {
    await expect(
      q(`UPDATE raffles SET organization_id=$2 WHERE id=$1`, [F.raffleADraft, F.orgB]),
    ).rejects.toThrow(/inmutable/);
  });

  it("un pedido no puede usar vendedor o comprador de otra organización", async () => {
    await expect(
      q(
        `INSERT INTO orders (raffle_id, organization_id, buyer_contact_id) VALUES ($1,$2,$3)`,
        [F.raffleBPub, F.orgB, F.buyerA],
      ),
    ).rejects.toThrow(/orders_buyer_org_fk/);
    await expect(
      q(
        `INSERT INTO orders (raffle_id, organization_id, seller_id) VALUES ($1,$2,$3)`,
        [F.raffleBPub, F.orgB, F.sellerA],
      ),
    ).rejects.toThrow(/orders_seller_org_fk/);
  });
});

describe("producto digital ↔ número único", () => {
  it("vincula un producto con un número de la misma campaña", async () => {
    await expect(
      q(
        `INSERT INTO numbered_product_units (raffle_id, organization_id, digital_product_id, raffle_number_id)
         VALUES ($1,$2,$3,$4)`,
        [F.raffleAPub, F.orgA, F.productA, F.numA1],
      ),
    ).resolves.toBeDefined();
  });

  it("impide duplicar la unidad producto+número", async () => {
    await expect(
      q(
        `INSERT INTO numbered_product_units (raffle_id, organization_id, digital_product_id, raffle_number_id)
         VALUES ($1,$2,$3,$4)`,
        [F.raffleAPub, F.orgA, F.productA, F.numA1],
      ),
    ).rejects.toThrow(/numbered_units_product_number_uq/);
  });

  it("impide cruzar producto y número de campañas distintas", async () => {
    await expect(
      q(
        `INSERT INTO numbered_product_units (raffle_id, organization_id, digital_product_id, raffle_number_id)
         VALUES ($1,$2,$3,$4)`,
        [F.raffleAPub, F.orgA, F.productB, F.numA2],
      ),
    ).rejects.toThrow(/numbered_units_product_fk/);
    await expect(
      q(
        `INSERT INTO numbered_product_units (raffle_id, organization_id, digital_product_id, raffle_number_id)
         VALUES ($1,$2,$3,$4)`,
        [F.raffleAPub, F.orgA, F.productA, F.numB1],
      ),
    ).rejects.toThrow(/numbered_units_number_fk/);
  });

  it("el ítem de pedido solo acepta producto de su campaña", async () => {
    const o = await q(
      `INSERT INTO orders (raffle_id, organization_id) VALUES ($1,$2) RETURNING id`,
      [F.raffleAPub, F.orgA],
    );
    const orderId = (o.rows[0] as { id: string }).id;
    await expect(
      q(
        `INSERT INTO order_items (order_id, raffle_id, organization_id, raffle_number_id, digital_product_id, price_cents)
         VALUES ($1,$2,$3,$4,$5,1000)`,
        [orderId, F.raffleAPub, F.orgA, F.numA2, F.productB],
      ),
    ).rejects.toThrow(/order_items_product_fk/);
  });
});

describe("un número no puede estar retenido por dos pedidos activos", () => {
  async function newOrder(status: string) {
    const r = await q(
      `INSERT INTO orders (raffle_id, organization_id, status, is_demo) VALUES ($1,$2,$3,false) RETURNING id`,
      [F.raffleAPub, F.orgA, status],
    );
    return (r.rows[0] as { id: string }).id;
  }
  it("un pedido de demostración no puede quedar confirmado", async () => {
    await expect(
      q(`INSERT INTO orders (raffle_id, organization_id, status, is_demo) VALUES ($1,$2,'confirmed',true)`, [F.raffleAPub, F.orgA]),
    ).rejects.toThrow(/orders_demo_never_confirmed/);
  });
  const addItem = (orderId: string, numberId: string) =>
    q(
      `INSERT INTO order_items (order_id, raffle_id, organization_id, raffle_number_id, price_cents)
       VALUES ($1,$2,$3,$4,1000)`,
      [orderId, F.raffleAPub, F.orgA, numberId],
    );

  it("rechaza dos pedidos pending sobre el mismo número", async () => {
    const o1 = await newOrder("pending");
    const o2 = await newOrder("pending");
    await addItem(o1, F.numA2);
    await expect(addItem(o2, F.numA2)).rejects.toThrow(/order_items_number_held_uq/);
  });

  it("libera el número al cancelar y lo retiene de nuevo al confirmar", async () => {
    const held = await q(
      `SELECT order_id FROM order_items WHERE raffle_number_id=$1 AND holds_number`,
      [F.numA2],
    );
    const o1 = (held.rows[0] as { order_id: string }).order_id;
    await q(`UPDATE orders SET status='cancelled' WHERE id=$1`, [o1]);
    const o3 = await newOrder("pending");
    await addItem(o3, F.numA2);
    // reactivar el pedido cancelado choca con el pedido que ya retiene el número
    await expect(
      q(`UPDATE orders SET status='confirmed' WHERE id=$1`, [o1]),
    ).rejects.toThrow(/order_items_number_held_uq/);
  });

  it("un pedido en borrador no retiene el número", async () => {
    const draft = await newOrder("draft");
    const r = await addItem(draft, F.numA2);
    expect(r).toBeDefined();
    const row = await q(
      `SELECT holds_number FROM order_items WHERE order_id=$1`,
      [draft],
    );
    expect((row.rows[0] as { holds_number: boolean }).holds_number).toBe(false);
  });
});

describe("borrados controlados", () => {
  it("no permite borrar una campaña con pedidos", async () => {
    await expect(
      q(`DELETE FROM raffles WHERE id=$1`, [F.raffleAPub]),
    ).rejects.toThrow(/foreign key constraint/);
  });

  it("no permite borrar una organización con campañas", async () => {
    await expect(
      q(`DELETE FROM organizations WHERE id=$1`, [F.orgA]),
    ).rejects.toThrow(/foreign key constraint/);
  });

  it("al borrar una campaña en borrador se eliminan sus hijos", async () => {
    await q(
      `INSERT INTO prizes (raffle_id, organization_id, title, position) VALUES ($1,$2,'TEST',1)`,
      [F.raffleADraft, F.orgA],
    );
    await q(`DELETE FROM raffles WHERE id=$1`, [F.raffleADraft]);
    const r = await q(`SELECT count(*)::int AS n FROM prizes WHERE raffle_id=$1`, [F.raffleADraft]);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("restricciones de campaña", () => {
  const insert = (
    slug: string,
    over: { price_cents?: number; number_count?: number } = {},
  ) =>
    q(
      `INSERT INTO raffles (organization_id, slug, title, number_count, price_cents)
       VALUES ($1,$2,'TEST',$3,$4)`,
      [F.orgA, slug, over.number_count ?? 10, over.price_cents ?? 0],
    );

  it("slug único global y con formato válido", async () => {
    await expect(insert("test-a-publicada")).rejects.toThrow(/raffles_slug_uq/);
    for (const bad of ["AB", "Mayus-culas", "con espacio", "-x-", "a--b"]) {
      await expect(insert(bad)).rejects.toThrow(/raffles_slug_format/);
    }
  });

  it("precio no negativo, cantidad positiva y fechas coherentes", async () => {
    await expect(insert("test-precio", { price_cents: -1 })).rejects.toThrow(/price_nonneg/);
    await expect(insert("test-cant", { number_count: 0 })).rejects.toThrow(/number_count_pos/);
    await expect(
      q(
        `INSERT INTO raffles (organization_id, slug, title, number_count, starts_at, ends_at)
         VALUES ($1,'test-fechas','TEST',10, now(), now() - interval '1 day')`,
        [F.orgA],
      ),
    ).rejects.toThrow(/dates_order/);
  });
});

describe("propietarios, canje y auditoría", () => {
  it("la organización conserva al menos un propietario activo", async () => {
    await expect(
      q(`UPDATE organization_members SET role='admin' WHERE organization_id=$1 AND user_id=$2`, [F.orgB, F.ownerB]),
    ).rejects.toThrow(/al menos un propietario/);
    await expect(
      q(`DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2`, [F.orgB, F.ownerB]),
    ).rejects.toThrow(/al menos un propietario/);
    await expect(
      q(`UPDATE organization_members SET status='suspended' WHERE organization_id=$1 AND user_id=$2`, [F.orgB, F.ownerB]),
    ).rejects.toThrow(/al menos un propietario/);
  });

  it("permite quitar un propietario si queda otro", async () => {
    await q(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'owner')`,
      [F.orgB, F.outsider],
    );
    await expect(
      q(`UPDATE organization_members SET role='viewer' WHERE organization_id=$1 AND user_id=$2`, [F.orgB, F.outsider]),
    ).resolves.toBeDefined();
  });

  it("un premio canjeado no se puede revertir ni canjear otra vez", async () => {
    const d = await q(
      `INSERT INTO drawings (raffle_id, organization_id, status, performed_at) VALUES ($1,$2,'completed', now()) RETURNING id`,
      [F.raffleAPub, F.orgA],
    );
    const drawingId = (d.rows[0] as { id: string }).id;
    const item = await q(
      `SELECT oi.id FROM order_items oi WHERE oi.raffle_id=$1 LIMIT 1`,
      [F.raffleAPub],
    );
    const itemId = (item.rows[0] as { id: string }).id;
    const w = await q(
      `INSERT INTO winners (drawing_id, raffle_id, organization_id, order_item_id, prize_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [drawingId, F.raffleAPub, F.orgA, itemId, F.prizeA],
    );
    const winnerId = (w.rows[0] as { id: string }).id;
    await expect(
      q(`UPDATE winners SET redemption_status='redeemed' WHERE id=$1`, [winnerId]),
    ).rejects.toThrow(/winners_redemption_consistent/);
    await q(
      `UPDATE winners SET redemption_status='redeemed', redeemed_at=now() WHERE id=$1`,
      [winnerId],
    );
    await expect(
      q(`UPDATE winners SET redemption_status='pending', redeemed_at=NULL WHERE id=$1`, [winnerId]),
    ).rejects.toThrow(/definitivo/);
    await expect(
      q(`UPDATE winners SET redeemed_at = now() + interval '1 day' WHERE id=$1`, [winnerId]),
    ).rejects.toThrow(/definitivo/);
    await expect(
      q(
        `INSERT INTO winners (drawing_id, raffle_id, organization_id, order_item_id, prize_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [drawingId, F.raffleAPub, F.orgA, itemId, F.prizeA],
      ),
    ).rejects.toThrow(/winners_prize_item_uq/);
  });

  it("audit_events es de solo inserción", async () => {
    await q(
      `INSERT INTO audit_events (organization_id, entity_type, action) VALUES ($1,'raffle','TEST')`,
      [F.orgA],
    );
    await expect(q(`UPDATE audit_events SET action='x'`)).rejects.toThrow(/solo inserción/);
    await expect(q(`DELETE FROM audit_events`)).rejects.toThrow(/solo inserción/);
    await expect(q(`TRUNCATE audit_events`)).rejects.toThrow(/solo inserción/);
    await expect(
      q(`INSERT INTO audit_events (entity_type, action, metadata) VALUES ('x','y','[]'::jsonb)`),
    ).rejects.toThrow(/metadata_object/);
  });

  it("el token del vendedor solo se acepta como hash SHA-256 hex", async () => {
    await expect(
      q(
        `INSERT INTO sellers (organization_id, display_name, token_hash) VALUES ($1,'TEST','token-en-claro')`,
        [F.orgA],
      ),
    ).rejects.toThrow(/token_hash_format/);
  });

  it("el comprador requiere al menos un medio de contacto", async () => {
    await expect(
      q(`INSERT INTO buyer_contacts (organization_id, name) VALUES ($1,'TEST')`, [F.orgA]),
    ).rejects.toThrow(/has_contact/);
  });
});
