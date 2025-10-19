import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function GET() {
  try {
    const sql = getSql();

    await sql/*sql*/`
      create table if not exists shops (
        id              serial primary key,
        shop_domain     text unique not null,
        created_at      timestamptz default now()
      );

      create table if not exists orders (
        id              bigint primary key,
        shop_domain     text not null references shops(shop_domain) on delete cascade,
        created_at      timestamptz not null,
        total_price     numeric
      );

      create table if not exists order_items (
        order_id        bigint references orders(id) on delete cascade,
        variant_id      bigint not null,
        quantity        integer not null,
        primary key (order_id, variant_id)
      );

      create table if not exists variant_snapshots (
        id                  bigserial primary key,
        shop_domain         text not null references shops(shop_domain) on delete cascade,
        variant_id          bigint not null,
        product_id          bigint not null,
        price               numeric,
        inventory_quantity  integer,
        captured_at         timestamptz default now()
      );

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

    await sql/*sql*/`
      insert into shops (shop_domain)
      values (${process.env.SHOPIFY_TEST_SHOP})
      on conflict (shop_domain) do nothing;
    `;

    return NextResponse.json({ ok: true, message: "Schema ensured." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
