-- Phase 1: Saved quotes + light customers
-- ADDITIVE ONLY — does not alter inventory columns or break the live inventory app.
-- Safe to run on the production Supabase project used by main/Pages.

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  status text not null default 'draft',
  quote_date date,
  valid_until date,
  prepared_by text,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists quotes_status_idx on quotes (status);
create index if not exists quotes_quote_date_idx on quotes (quote_date desc);

create table if not exists quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  line_no integer not null default 1,
  inventory_id uuid,
  part_number text,
  name text not null,
  qty numeric not null default 1,
  unit_price numeric not null default 0
);

create index if not exists quote_lines_quote_id_idx on quote_lines (quote_id);

create table if not exists document_counters (
  doc_type text not null,
  year integer not null,
  last_value integer not null default 0,
  primary key (doc_type, year)
);

alter table customers enable row level security;
alter table quotes enable row level security;
alter table quote_lines enable row level security;
alter table document_counters enable row level security;

-- Policies: trusted internal (same model as inventory). Ignore errors if policy already exists.
do $$ begin
  create policy "Allow all customers" on customers for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all quotes" on quotes for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all quote_lines" on quote_lines for all using (true) with check (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "Allow all document_counters" on document_counters for all using (true) with check (true);
exception when duplicate_object then null;
end $$;

-- Status values (app-enforced): draft | sent | accepted | expired | void
