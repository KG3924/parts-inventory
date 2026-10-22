-- Customer list: one row per customer, picked on the quote.
-- Run once, only after this build is on live Pages and every phone has hard-refreshed. Safe to re-run.
-- Adds columns and rules. Deletes nothing. Does not touch approved invoices, Approve, the freeze or void locks.
-- No customer data in this file. The real list is loaded later, separately.

begin;

create extension if not exists pg_trgm with schema extensions;

-- Contact details, all optional (blank until filled in). notes already exists. No screen for these yet.
alter table public.customers add column if not exists billing_address text;
alter table public.customers add column if not exists contact_name text;
alter table public.customers add column if not exists ship_to_address text;
alter table public.customers add column if not exists tax_exempt_number text;
alter table public.customers add column if not exists qb_status text not null default 'new_not_in_qb';
alter table public.customers add column if not exists merged_into uuid references public.customers (id);
alter table public.customers drop constraint if exists customers_qb_status_known;
alter table public.customers add constraint customers_qb_status_known check (qb_status in ('new_not_in_qb', 'in_qb'));
alter table public.customers drop constraint if exists customers_not_merged_into_self;
alter table public.customers add constraint customers_not_merged_into_self check (merged_into <> id);

-- Invoices point at the customer too. No backfill: approved invoices keep their frozen name and are not written.
alter table public.invoices add column if not exists customer_id uuid references public.customers (id);
create index if not exists invoices_customer_id_idx on public.invoices (customer_id);

-- "Smith Marine", "smith marine " and "Smith  Marine" are one name.
create or replace function public.shop_customer_key(p_name text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '[[:space:]\u00a0]+', ' ', 'g'))) $$;

create unique index if not exists customers_name_key_unique on public.customers (public.shop_customer_key(name));

-- WHO MAY MARK A CUSTOMER "IN QUICKBOOKS". Today: anyone signed in.
-- To limit it to one login later, change only the select line, e.g.  select auth.email() = 'name@inmarsystems.com'
create or replace function public.shop_may_set_in_qb()
returns boolean language sql stable set search_path = ''
as $$ select auth.uid() is not null $$;

create or replace function public.customers_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.name := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.name, ''), '[[:space:]\u00a0]+', ' ', 'g'));
  if new.name = '' then
    raise exception 'Type the customer name first.';
  end if;
  if public.shop_customer_key(new.name) = 'cash sale' then
    raise exception 'Cash sale is not a customer. Tap Cash sale instead.';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.qb_status := 'new_not_in_qb';  -- added in the app = not in QuickBooks yet
  end if;
  if tg_op = 'UPDATE' and new.qb_status is distinct from old.qb_status
     and auth.uid() is not null and not public.shop_may_set_in_qb() then
    raise exception 'Not changed. This login can''t mark customers In QuickBooks.';
  end if;
  if tg_op = 'UPDATE' and new.merged_into is distinct from old.merged_into
     and coalesce(current_setting('inmar.customer_merge', true), '') <> 'on' then
    raise exception 'Merge customers only with shop_merge_customers.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists customers_guard on public.customers;
create trigger customers_guard before insert or update on public.customers
  for each row execute function public.customers_guard();

-- Add from the quote. The unique index is the referee, so two phones at once give one row.
create or replace function public.shop_add_customer(p_name text)
returns public.customers language plpgsql set search_path = ''
as $$
declare
  v_row public.customers;
  v_have text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  insert into public.customers (name) values (p_name) returning * into v_row;
  return v_row;
exception when unique_violation then
  select coalesce(w.name, c.name) into v_have
  from public.customers c left join public.customers w on w.id = c.merged_into
  where public.shop_customer_key(c.name) = public.shop_customer_key(p_name);
  raise exception 'Not added. % is already on the customer list. Pick it from the list.', coalesce(v_have, pg_catalog.btrim(p_name));
end;
$$;

-- Type-ahead and "Did you mean". Reads only. Merged rows are hidden.
create or replace function public.shop_customer_suggest(p_q text)
returns table (id uuid, name text, qb_status text, payment_terms text, exact boolean)
language sql stable set search_path = ''
as $$
  with k as (select public.shop_customer_key(p_q) as q),
  c as (
    select c.*, public.shop_customer_key(c.name) as ck from public.customers c where c.merged_into is null
  )
  select c.id, c.name, c.qb_status, c.payment_terms, c.ck = k.q
  from c, k
  where pg_catalog.length(k.q) >= 2
    and (pg_catalog.strpos(c.ck, k.q) > 0
         or extensions.similarity(k.q, c.ck) >= 0.3
         or extensions.word_similarity(k.q, c.ck) >= 0.6)
  order by c.ck = k.q desc, pg_catalog.strpos(c.ck, k.q) = 1 desc,
           extensions.similarity(k.q, c.ck) desc, c.name
  limit 8
$$;

-- Duplicate cleanup, SQL editor only: select public.shop_merge_customers('<from id>', '<into id>');
-- Points quotes (not void) and draft invoices at the kept customer. Void quotes and approved invoices keep their old link,
-- which still resolves through merged_into. Deletes nothing.
create or replace function public.shop_merge_customers(p_from uuid, p_into uuid)
returns text language plpgsql set search_path = ''
as $$
declare
  v_from public.customers;
  v_into public.customers;
  v_q integer;
  v_i integer;
begin
  if p_from is null or p_into is null or p_from = p_into then
    raise exception 'Pick two different customers.';
  end if;
  select * into v_from from public.customers where id = p_from for update;
  select * into v_into from public.customers where id = p_into for update;
  if v_from.id is null or v_into.id is null then
    raise exception 'Customer not found.';
  end if;
  if v_from.merged_into is not null then
    raise exception '% is already merged.', v_from.name;
  end if;
  if v_into.merged_into is not null then
    raise exception '% was merged into another customer. Merge into that one.', v_into.name;
  end if;
  perform pg_catalog.set_config('inmar.customer_merge', 'on', true);
  update public.customers set merged_into = p_into where id = p_from or merged_into = p_from;
  update public.quotes set customer_id = p_into where customer_id = p_from and status <> 'void';
  get diagnostics v_q = row_count;
  update public.invoices set customer_id = p_into
  where customer_id = p_from and status <> 'approved' and approved_at is null;
  get diagnostics v_i = row_count;
  perform pg_catalog.set_config('inmar.customer_merge', '', true);
  return pg_catalog.format('%s merged into %s. %s quotes and %s draft invoices moved.', v_from.name, v_into.name, v_q, v_i);
end;
$$;

-- Signed-in only, same as every shop table. Anon gets nothing.
alter table public.customers enable row level security;
revoke all on table public.customers from anon;
grant select, insert, update, delete on table public.customers to authenticated;
drop policy if exists "shop read customers" on public.customers;
drop policy if exists "shop insert customers" on public.customers;
drop policy if exists "shop update customers" on public.customers;
drop policy if exists "shop delete customers" on public.customers;
create policy "shop read customers" on public.customers for select to authenticated using (true);
create policy "shop insert customers" on public.customers for insert to authenticated with check (true);
create policy "shop update customers" on public.customers for update to authenticated using (true) with check (true);
create policy "shop delete customers" on public.customers for delete to authenticated using (true);

revoke all on function public.shop_customer_key(text) from public, anon;
revoke all on function public.shop_may_set_in_qb() from public, anon;
revoke all on function public.customers_guard() from public, anon, authenticated;
revoke all on function public.shop_add_customer(text) from public, anon;
revoke all on function public.shop_customer_suggest(text) from public, anon;
revoke all on function public.shop_merge_customers(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shop_customer_key(text) to authenticated;
grant execute on function public.shop_may_set_in_qb() to authenticated;
grant execute on function public.shop_add_customer(text) to authenticated;
grant execute on function public.shop_customer_suggest(text) to authenticated;

notify pgrst, 'reload schema';

commit;
