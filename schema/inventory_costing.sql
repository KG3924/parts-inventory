-- Phase 3: used/salvage qty, exchange-rate buy, price history, LIFO/FIFO cost layers
-- ADDITIVE ONLY — does not drop inventory or quote tables.
-- Safe to re-run. Run in Supabase SQL Editor after Phase 1 / Phase 2.
-- Production (In-Mar) has already run this. FX rates themselves are stored in app_settings, not here.

-- Used / salvage stock on the SAME part (not a second SKU).
-- inventory.qty remains NEW stock (valued). qty_used is tracked but $0 for tax/valuation.
alter table inventory add column if not exists qty_used integer default 0;
create index if not exists inventory_location_idx on inventory (location);

-- Snapshot whenever buy / sell / list price changes
create table if not exists inventory_price_history (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid,
  part_number text,
  name text,
  recorded_at timestamptz default now(),
  buy_price numeric,
  sell_price numeric,
  list_price numeric,
  list_currency text,
  qty integer,
  qty_used integer,
  note text,
  changed_by text
);

create index if not exists inventory_price_history_part_idx
  on inventory_price_history (part_number, recorded_at desc);
create index if not exists inventory_price_history_inv_idx
  on inventory_price_history (inventory_id, recorded_at desc);

-- Perpetual cost layers for FIFO / LIFO ending inventory (NEW stock only)
create table if not exists inventory_cost_layers (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid,
  part_number text,
  acquired_at timestamptz default now(),
  unit_cost numeric not null default 0,
  qty_original numeric not null default 0,
  qty_remaining numeric not null default 0,
  condition text not null default 'new',
  source text,
  changed_by text
);

create index if not exists inventory_cost_layers_inv_idx
  on inventory_cost_layers (inventory_id, condition, acquired_at);

alter table inventory_price_history enable row level security;
alter table inventory_cost_layers enable row level security;

do $$ begin
  create policy "Allow all inventory_price_history" on inventory_price_history for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all inventory_cost_layers" on inventory_cost_layers for all using (true) with check (true);
exception when duplicate_object then null;
end $$;

grant select, insert, update, delete on table inventory_price_history to anon, authenticated, service_role;
grant select, insert, update, delete on table inventory_cost_layers to anon, authenticated, service_role;

notify pgrst, 'reload schema';
