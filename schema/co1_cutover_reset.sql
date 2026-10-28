-- CO1 cutover: clear practice quotes and invoices, reset Q-L, I-L, Q-S, I-S to 00001.
-- NOT part of the build or deploy. Kyle runs it by hand in the Supabase SQL editor, on cutover day only.
-- Step 1: run this whole file. It only creates the tool. Step 2: select * from inmar_admin.co1_cutover_reset('count only');
-- Step 3, after the backup: select * from inmar_admin.co1_cutover_reset('CLEAR PRACTICE DATA');
-- Customers, parts, stock counts and stock history are not touched. Delete stays off for the app.
begin;
create schema if not exists inmar_admin;
revoke all on schema inmar_admin from public, anon, authenticated, service_role;
create table if not exists inmar_admin.cutover_log (
  ran_at timestamptz primary key default now(), ran_by text not null default current_user, cleared jsonb not null);
revoke all on table inmar_admin.cutover_log from public, anon, authenticated, service_role;

create or replace function inmar_admin.co1_cutover_reset(p_confirm text)
returns table (item text, how_many bigint)
language plpgsql set search_path = ''
as $$
declare
  v_go boolean := p_confirm = 'CLEAR PRACTICE DATA';
  v_ran timestamptz;
  v_counts jsonb;
  t text;
  v_tables text[] := array['invoice_lines', 'invoices', 'packing_list_lines', 'packing_lists', 'quote_lines', 'quotes'];
begin
  if current_user <> (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = 'public.quotes'::regclass)
     or session_user in ('anon', 'authenticated', 'authenticator', 'service_role') then
    raise exception 'Admin only. Run this in the Supabase SQL editor, not from the app.';
  end if;
  if p_confirm is null or p_confirm not in ('count only', 'CLEAR PRACTICE DATA') then
    raise exception 'Nothing changed. Type exactly: count only, or CLEAR PRACTICE DATA';
  end if;
  select l.ran_at into v_ran from inmar_admin.cutover_log l order by l.ran_at limit 1;
  if v_go and v_ran is not null then
    raise exception 'Nothing changed. The cutover reset already ran at % (Chicago time).',
      pg_catalog.to_char(v_ran at time zone 'America/Chicago', 'YYYY-MM-DD HH24:MI');
  end if;
  v_counts := '{}';
  foreach t in array v_tables loop
    execute format('select count(*) from public.%I', t) into how_many;
    v_counts := v_counts || pg_catalog.jsonb_build_object(t, how_many);
  end loop;
  if v_go then
    lock table public.quotes, public.quote_lines, public.invoices, public.invoice_lines,
      public.packing_lists, public.packing_list_lines, public.shop_counters in access exclusive mode;
    foreach t in array v_tables loop
      execute format('alter table public.%I disable trigger user', t);
      execute format('delete from public.%I', t);
      execute format('alter table public.%I enable trigger user', t);
    end loop;
    update public.shop_counters set last_value = 0;
    insert into inmar_admin.cutover_log (cleared) values (v_counts);
  end if;
  foreach t in array v_tables loop
    item := case when v_go then 'cleared ' else 'would clear ' end || t;
    how_many := (v_counts ->> t)::bigint;
    return next;
  end loop;
  for item, how_many in
    select 'next number ' || c.counter || pg_catalog.lpad((c.last_value + 1)::text, 5, '0'), null::bigint
    from public.shop_counters c order by c.counter loop
    return next;
  end loop;
  item := 'customers (not touched)'; select count(*) into how_many from public.customers; return next;
  item := 'parts (not touched)'; select count(*) into how_many from public.inventory; return next;
  item := 'total on hand (not touched)'; select coalesce(sum(i.qty), 0) into how_many from public.inventory i; return next;
end;
$$;
revoke all on function inmar_admin.co1_cutover_reset(text) from public, anon, authenticated, service_role;
commit;
