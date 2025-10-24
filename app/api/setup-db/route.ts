// app/api/setup-db/route.ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function GET() {
  try {
    const sql = getSql();

    // ---------------------------
    // shops
    // ---------------------------
    await sql/*sql*/`
      create table if not exists shops (
        id              serial primary key,
        shop_domain     text unique not null,
        access_token    text,
        created_at      timestamptz default now()
      );
    `;
    await sql/*sql*/`alter table shops alter column access_token drop not null;`;

    // ---------------------------
    // orders (create-if-missing)
    // ---------------------------
    await sql/*sql*/`
      create table if not exists orders (
        id              bigint primary key,
        shop_domain     text not null references shops(shop_domain) on delete cascade,
        created_at      timestamptz,
        total_price     numeric
      );
    `;
    // Ensure expected columns exist (no-ops if already there)
    await sql/*sql*/`alter table orders add column if not exists created_at timestamptz;`;
    await sql/*sql*/`alter table orders add column if not exists total_price numeric;`;
    await sql/*sql*/`alter table orders add column if not exists shop_domain text;`;

    // 🔧 Legacy heal: if a stale "order_id" column ever existed, migrate & drop it
    const legacy = await sql/*sql*/`
      select
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='orders' and column_name='order_id'
        ) as has_order_id,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='orders' and column_name='id'
        ) as has_id;
    ` as any;
    const hasOrderId = !!legacy?.[0]?.has_order_id;
    const hasId      = !!legacy?.[0]?.has_id;

    if (hasOrderId && !hasId) {
      await sql/*sql*/`alter table orders rename column order_id to id;`;
    } else if (hasOrderId && hasId) {
      await sql/*sql*/`update orders set id = order_id where id is null;`;
      await sql/*sql*/`alter table orders drop column if exists order_id;`;
    }

    // ✅ Ensure a UNIQUE index on orders(id) for ON CONFLICT to work even if PK was missing historically
    await sql/*sql*/`create unique index if not exists idx_orders_id_unique on orders(id);`;

    // ---------------------------
    // order_items
    // ---------------------------
    await sql/*sql*/`
      create table if not exists order_items (
        order_id        bigint references orders(id) on delete cascade,
        variant_id      bigint not null,
        quantity        integer not null,
        primary key (order_id, variant_id)
      );
    `;
    // ✅ Ensure a UNIQUE index backing ON CONFLICT (order_id, variant_id)
    await sql/*sql*/`
      create unique index if not exists idx_order_items_unique on order_items(order_id, variant_id);
    `;

    // ---------------------------
    // variant_snapshots
    // ---------------------------
    await sql/*sql*/`
      create table if not exists variant_snapshots (
        id                  bigserial primary key,
        shop_domain         text not null references shops(shop_domain) on delete cascade,
        variant_id          bigint not null,
        product_id          bigint not null,
        price               numeric,
        inventory_quantity  integer,
        captured_at         timestamptz default now()
      );
    `;

    // ---------------------------
    // rec_logs
    // ---------------------------
    await sql/*sql*/`
      create table if not exists rec_logs (
        id              bigserial primary key,
        shop_domain     text not null references shops(shop_domain) on delete cascade,
        variant_id      bigint not null,
        rec_type        text not null,
        current_price   numeric,
        suggested_price numeric,
        change_pct      numeric,
        rationale       text,
        window_days     integer,
        created_at      timestamptz default now()
      );
    `;

    // ---------------------------
    // Ensure your dev shop row exists (token intentionally null)
    // ---------------------------
    await sql/*sql*/`
      insert into shops (shop_domain, access_token)
      values (${process.env.SHOPIFY_TEST_SHOP!}, null)
      on conflict (shop_domain) do nothing;
    `;

    return NextResponse.json({ ok: true, message: "Schema ensured + indexes in place." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}