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
    // orders
    // ---------------------------
    await sql/*sql*/`
      create table if not exists orders (
        id              bigint primary key,
        shop_domain     text not null references shops(shop_domain) on delete cascade,
        created_at      timestamptz,
        total_price     numeric
      );
    `;
    await sql/*sql*/`alter table orders add column if not exists created_at timestamptz;`;
    await sql/*sql*/`alter table orders add column if not exists total_price numeric;`;
    await sql/*sql*/`alter table orders add column if not exists shop_domain text;`;

    // legacy heal: orders.order_id -> orders.id
    const legacyOrders = await sql/*sql*/`
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

    const hasOrderId = !!legacyOrders?.[0]?.has_order_id;
    const hasId      = !!legacyOrders?.[0]?.has_id;

    if (hasOrderId && !hasId) {
      await sql/*sql*/`alter table orders rename column order_id to id;`;
    } else if (hasOrderId && hasId) {
      await sql/*sql*/`update orders set id = order_id where id is null;`;
      await sql/*sql*/`alter table orders drop column if exists order_id;`;
    }

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
    await sql/*sql*/`
      create unique index if not exists idx_order_items_unique on order_items(order_id, variant_id);
    `;

    // legacy heal for order_items
    const legacyItemsCols = await sql/*sql*/`
      select
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='order_items' and column_name='line_id'
        ) as has_line_id,
        exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='order_items' and column_name='shop_domain'
        ) as has_shop_domain
    ` as any;

    const hasLineId = !!legacyItemsCols?.[0]?.has_line_id;
    const hasShopDomainInItems = !!legacyItemsCols?.[0]?.has_shop_domain;

    if (hasLineId) {
      await sql/*sql*/`alter table order_items drop column if exists line_id;`;
    }

    if (hasShopDomainInItems) {
      await sql/*sql*/`alter table order_items alter column shop_domain drop not null;`;
      await sql/*sql*/`
        update order_items oi
        set shop_domain = o.shop_domain
        from orders o
        where oi.order_id = o.id
          and (oi.shop_domain is null or oi.shop_domain = '');
      `;
    }

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

    // ✅ ADD THESE (this is the missing piece)
    await sql/*sql*/`alter table variant_snapshots add column if not exists product_title text;`;
    await sql/*sql*/`alter table variant_snapshots add column if not exists variant_title text;`;

    // optional but helpful for lookup speed
    await sql/*sql*/`create index if not exists idx_variant_snapshots_variant_id on variant_snapshots(variant_id);`;
    await sql/*sql*/`create index if not exists idx_variant_snapshots_product_id on variant_snapshots(product_id);`;

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

    // seed dev shop row (token intentionally null)
    await sql/*sql*/`
      insert into shops (shop_domain, access_token)
      values (${process.env.SHOPIFY_TEST_SHOP!}, null)
      on conflict (shop_domain) do nothing;
    `;

    return NextResponse.json({
      ok: true,
      message: "Schema ensured + legacy healed (orders, order_items) + added titles to variant_snapshots.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}