-- CO1: two companies, four gap-free counters, number on first save, delete lock.
-- Run once by hand in the Supabase SQL editor AFTER the CO1 build is live on Pages.
-- Safe to re-run: it never resets a counter and never touches row data.
begin;

-- 1. Company on the document (L = In-Mar Solutions, S = In-Mar Systems). Old practice rows stay blank.
alter table public.quotes   add column if not exists company text;
alter table public.invoices add column if not exists company text;
alter table public.invoices alter column number drop not null;  -- drafts have no number until Approve
alter table public.quotes   drop constraint if exists quotes_company_known;
alter table public.quotes   add  constraint quotes_company_known check (company in ('L', 'S'));
alter table public.invoices drop constraint if exists invoices_company_known;
alter table public.invoices add  constraint invoices_company_known check (company in ('L', 'S'));
-- The company letter is inside the number, so the two companies can never share a number.
-- An optional capital letter is left room for revisions (a later cut).
alter table public.quotes   drop constraint if exists quotes_number_matches_company;
alter table public.quotes   add  constraint quotes_number_matches_company
  check (company is null or number ~ ('^Q-' || company || '[0-9]{5}[A-Z]?$'));
alter table public.invoices drop constraint if exists invoices_number_matches_company;
alter table public.invoices add  constraint invoices_number_matches_company
  check (company is null or number is null or number ~ ('^I-' || company || '[0-9]{5}$'));
alter table public.invoices drop constraint if exists invoices_approved_has_number;
alter table public.invoices add  constraint invoices_approved_has_number
  check (number is not null or (approved_at is null and coalesce(status, '') <> 'approved'));

-- In QuickBooks per company: qb_status is In-Mar Solutions, qb_status_systems is In-Mar Systems.
alter table public.customers add column if not exists qb_status_systems text not null default 'new_not_in_qb';
alter table public.customers drop constraint if exists customers_qb_status_systems_known;
alter table public.customers add  constraint customers_qb_status_systems_known
  check (qb_status_systems in ('new_not_in_qb', 'in_qb'));
create or replace function public.customers_qb_systems_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.qb_status_systems := 'new_not_in_qb';  -- added in the app = not in QuickBooks yet
  elsif new.qb_status_systems is distinct from old.qb_status_systems and not public.shop_may_set_in_qb() then
    raise exception 'Not changed. This login can''t mark customers In QuickBooks.';
  end if;
  return new;
end;
$$;
revoke all on function public.customers_qb_systems_guard() from public, anon, authenticated;
drop trigger if exists customers_qb_systems_guard on public.customers;
create trigger customers_qb_systems_guard before insert or update on public.customers
  for each row execute function public.customers_qb_systems_guard();

-- 2. Four counters. A locked row, never a sequence: a failed save rolls the number back.
create table if not exists public.shop_counters (
  counter text primary key check (counter in ('Q-L', 'I-L', 'Q-S', 'I-S')),
  last_value integer not null default 0 check (last_value between 0 and 99999)
);
insert into public.shop_counters (counter) values ('Q-L'), ('I-L'), ('Q-S'), ('I-S')
  on conflict (counter) do nothing;
alter table public.shop_counters enable row level security;
revoke all on table public.shop_counters from public, anon, authenticated;

create or replace function public.shop_take_number(p_counter text)
returns text language plpgsql set search_path = ''
as $$
declare v integer;
begin
  update public.shop_counters set last_value = last_value + 1
    where counter = p_counter returning last_value into v;  -- row lock held until commit
  if v is null then raise exception 'Unknown counter %', p_counter; end if;
  return p_counter || pg_catalog.lpad(v::text, 5, '0');
end;
$$;
revoke all on function public.shop_take_number(text) from public, anon, authenticated;

-- 3. Save a new quote and take its number in one step. Any error undoes both.
create or replace function public.shop_save_new_quote(p_company text, p_quote jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_q public.quotes;
  v_status text := coalesce(nullif(pg_catalog.btrim(p_quote ->> 'status'), ''), 'draft');
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_company is null or p_company not in ('L', 'S') then
    raise exception 'Pick In-Mar Solutions or In-Mar Systems first. The quote was not saved.';
  end if;
  if p_lines is null or pg_catalog.jsonb_typeof(p_lines) <> 'array' or pg_catalog.jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line before saving';
  end if;
  if exists (select 1 from pg_catalog.jsonb_populate_recordset(null::public.quote_lines, p_lines) l
             where l.inventory_id is not null
               and not exists (select 1 from public.inventory i where i.id = l.inventory_id)) then
    raise exception 'A line points at a part that is no longer on the shelf list. The quote was not saved and no number was used.';
  end if;
  v_q := pg_catalog.jsonb_populate_record(null::public.quotes, p_quote);
  v_q.id := gen_random_uuid();
  v_q.company := p_company;
  v_q.number := public.shop_take_number('Q-' || p_company);
  v_q.status := case when v_status = 'void' then 'draft' else v_status end;
  v_q.created_at := now();
  v_q.updated_at := now();
  perform pg_catalog.set_config('inmar.co1_number', 'on', true);
  insert into public.quotes select v_q.*;
  perform pg_catalog.set_config('inmar.co1_number', 'off', true);
  insert into public.quote_lines (quote_id, line_no, inventory_id, part_number, name, qty, unit_price)
    select v_q.id, coalesce(l.line_no, 1), l.inventory_id, l.part_number, coalesce(l.name, 'Item'),
           coalesce(l.qty, 1), coalesce(l.unit_price, 0)
    from pg_catalog.jsonb_populate_recordset(null::public.quote_lines, p_lines) l;
  if v_status = 'void' then
    update public.quotes set status = 'void' where id = v_q.id;
  end if;
  return pg_catalog.jsonb_build_object('id', v_q.id, 'number', v_q.number, 'company', p_company);
end;
$$;
revoke all on function public.shop_save_new_quote(text, jsonb, jsonb) from public, anon;
grant execute on function public.shop_save_new_quote(text, jsonb, jsonb) to authenticated;

-- 4. Quote lock: no insert except shop_save_new_quote, number and company never change, no delete.
create or replace function public.quotes_co1_lock()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('inmar.co1_number', true), '') <> 'on' then
      raise exception 'Quotes get their number only from Save in the app. Hard refresh the app and save again.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception '% can''t be deleted. A saved quote keeps its number. Cancel it instead.',
      coalesce(nullif(pg_catalog.btrim(old.number), ''), 'This quote');
  end if;
  if new.number is distinct from old.number then
    raise exception '% keeps its number.', old.number;
  end if;
  if new.company is distinct from old.company then
    raise exception 'The company is locked once a quote has its number.';
  end if;
  return new;
end;
$$;
revoke all on function public.quotes_co1_lock() from public, anon, authenticated;
drop trigger if exists quotes_co1_lock on public.quotes;
create trigger quotes_co1_lock before insert or update or delete on public.quotes
  for each row execute function public.quotes_co1_lock();

-- 5. Invoice lock: company comes from the quote, the number only from Approve, numbered invoices stay.
create or replace function public.invoices_co1_lock()
returns trigger language plpgsql set search_path = ''
as $$
declare v_numbering boolean := coalesce(current_setting('inmar.co1_number', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.number is not null then
      raise exception '% can''t be deleted. Invoices with a number stay on the books.', old.number;
    end if;
    return old;
  end if;
  if new.quote_id is not null then
    select q.company into new.company from public.quotes q where q.id = new.quote_id;
  end if;
  if tg_op = 'INSERT' then
    if new.number is not null and not v_numbering then
      raise exception 'Invoice numbers are given only at Approve. Hard refresh the app and try again.';
    end if;
    return new;
  end if;
  if new.number is distinct from old.number and (old.number is not null or not v_numbering) then
    raise exception 'Invoice numbers are given only at Approve.';
  end if;
  if old.number is not null and new.company is distinct from old.company then
    raise exception 'The company is locked once an invoice has its number.';
  end if;
  return new;
end;
$$;
revoke all on function public.invoices_co1_lock() from public, anon, authenticated;
drop trigger if exists invoices_co1_lock on public.invoices;
create trigger invoices_co1_lock before insert or update or delete on public.invoices
  for each row execute function public.invoices_co1_lock();

-- 6. Approve takes I-L or I-S from the company stored on the invoice, inside the same step.
--    The Round 1 approve is kept word for word under a new name and called after the number is set,
--    so every refusal in it still rolls the number back.
do $$
begin
  if to_regprocedure('public.shop_approve_invoice_r1(uuid)') is null then
    alter function public.shop_approve_invoice(uuid) rename to shop_approve_invoice_r1;
  end if;
  if to_regprocedure('public.shop_next_doc_number_a1(text)') is null then
    alter function public.shop_next_doc_number(text) rename to shop_next_doc_number_a1;
  end if;
end $$;
revoke all on function public.shop_approve_invoice_r1(uuid) from public, anon, authenticated;
revoke all on function public.shop_next_doc_number_a1(text) from public, anon, authenticated;

create or replace function public.shop_approve_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_inv public.invoices;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if found and coalesce(v_inv.status, '') <> 'approved' and v_inv.approved_at is null then
    if v_inv.company is null then
      raise exception 'This invoice has no company. Start a new quote for In-Mar Solutions or In-Mar Systems. This invoice stayed a draft.';
    end if;
    if v_inv.number is null then
      perform pg_catalog.set_config('inmar.co1_number', 'on', true);
      update public.invoices set number = public.shop_take_number('I-' || v_inv.company) where id = p_invoice_id;
      perform pg_catalog.set_config('inmar.co1_number', 'off', true);
    end if;
  end if;
  return public.shop_approve_invoice_r1(p_invoice_id);
end;
$$;
revoke all on function public.shop_approve_invoice(uuid) from public, anon;
grant execute on function public.shop_approve_invoice(uuid) to authenticated;

-- Old callers can no longer hand out old-style quote or invoice numbers. Packing lists and orders unchanged.
create or replace function public.shop_next_doc_number(doc_type text)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  if lower(btrim($1)) in ('quote', 'invoice') then
    raise exception 'Quote and invoice numbers now come only from Save and Approve. Hard refresh the app.';
  end if;
  return public.shop_next_doc_number_a1($1);
end;
$$;
revoke all on function public.shop_next_doc_number(text) from public, anon;
grant execute on function public.shop_next_doc_number(text) to authenticated;

-- 7. Grants. The triggers above are the real lock; these close the doors too.
revoke insert, delete on table public.quotes from anon, authenticated;
drop policy if exists "shop insert quotes" on public.quotes;
drop policy if exists "shop delete quotes" on public.quotes;
revoke truncate on table public.quotes, public.quote_lines, public.invoices, public.invoice_lines,
  public.packing_lists, public.packing_list_lines, public.document_counters, public.customers
  from anon, authenticated;

notify pgrst, 'reload schema';
commit;
