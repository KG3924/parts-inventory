-- Phase 2: quote extras, packing lists, invoices, shared lookups/settings
-- ADDITIVE ONLY — does not drop inventory or Phase 1 quote tables.
-- Safe to re-run. Run in Supabase SQL Editor after Phase 1 (schema/quotes_phase1.sql).
--
-- Documents:
--   Quote        = offer to sell (prices, terms, lead time, 90-day validity, CC-fee notice)
--   Packing list = physical goods only (qty + description; no prices or payment terms)
--   Invoice      = request for payment (PO, ship-to, due date, fees, amount due)

-- Quote header extras
alter table quotes add column if not exists project text;
alter table quotes add column if not exists rfq_number text;
alter table quotes add column if not exists fob_point text;
alter table quotes add column if not exists payment_terms text;
alter table quotes add column if not exists lead_time text;

alter table customers add column if not exists payment_terms text;

create index if not exists quotes_customer_id_idx on quotes (customer_id);

-- App-wide settings (Wynn / FFS sell factors) and reusable dropdown values
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

create table if not exists app_lookups (
  kind text not null,
  value text not null,
  created_at timestamptz default now(),
  primary key (kind, value)
);

create table if not exists packing_lists (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  quote_id uuid references quotes(id) on delete set null,
  customer_name text,
  project text,
  pack_date date,
  prepared_by text,
  notes text,
  created_by text,
  created_at timestamptz default now()
);

create table if not exists packing_list_lines (
  id uuid primary key default gen_random_uuid(),
  packing_list_id uuid not null references packing_lists(id) on delete cascade,
  line_no integer not null default 1,
  inventory_id uuid,
  part_number text,
  name text not null,
  qty numeric not null default 1
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  quote_id uuid references quotes(id) on delete set null,
  customer_name text,
  project text,
  po_number text,
  ship_to text,
  invoice_date date,
  due_date date,
  fob_point text,
  payment_terms text,
  cc_used boolean default false,
  cc_fee_rate numeric default 0.035,
  cc_fee_amount numeric default 0,
  shipping_fee numeric default 0,
  duty numeric default 0,
  tariffs numeric default 0,
  subtotal numeric default 0,
  total numeric default 0,
  prepared_by text,
  notes text,
  status text not null default 'draft',
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  line_no integer not null default 1,
  inventory_id uuid,
  part_number text,
  name text not null,
  qty numeric not null default 1,
  unit_price numeric not null default 0
);

create index if not exists packing_lists_quote_id_idx on packing_lists (quote_id);
create index if not exists packing_list_lines_pl_id_idx on packing_list_lines (packing_list_id);
create index if not exists invoices_quote_id_idx on invoices (quote_id);
create index if not exists invoice_lines_invoice_id_idx on invoice_lines (invoice_id);

-- Seed starter FOB values (custom typed values are added by the app)
insert into app_lookups (kind, value) values
  ('fob', 'Origin'),
  ('fob', 'Destination')
on conflict do nothing;

insert into app_lookups (kind, value) values
  ('payment_terms', 'Due on receipt'),
  ('payment_terms', 'Net 15'),
  ('payment_terms', 'Net 30'),
  ('payment_terms', 'Net 45'),
  ('payment_terms', 'Net 60')
on conflict do nothing;

alter table app_settings enable row level security;
alter table app_lookups enable row level security;
alter table packing_lists enable row level security;
alter table packing_list_lines enable row level security;
alter table invoices enable row level security;
alter table invoice_lines enable row level security;

-- Trusted internal access (same model as inventory / Phase 1 quotes)
do $$ begin
  create policy "Allow all app_settings" on app_settings for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all app_lookups" on app_lookups for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all packing_lists" on packing_lists for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all packing_list_lines" on packing_list_lines for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all invoices" on invoices for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all invoice_lines" on invoice_lines for all using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- Explicit Data API grants (new public tables are no longer auto-exposed)
grant select, insert, update, delete on table app_settings to anon, authenticated, service_role;
grant select, insert, update, delete on table app_lookups to anon, authenticated, service_role;
grant select, insert, update, delete on table packing_lists to anon, authenticated, service_role;
grant select, insert, update, delete on table packing_list_lines to anon, authenticated, service_role;
grant select, insert, update, delete on table invoices to anon, authenticated, service_role;
grant select, insert, update, delete on table invoice_lines to anon, authenticated, service_role;

notify pgrst, 'reload schema';
