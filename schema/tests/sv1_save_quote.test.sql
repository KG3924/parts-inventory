-- SV1 local tests. Throwaway Postgres only. No live Supabase. ZZ names only.
--
-- Stubs are the same as schema/tests/ql1_lock_quote_lines.test.sql and are safe to re-run.
-- auth.uid() reads request.jwt.claim.sub and returns null when that is unset.
-- auth.jwt() reads request.jwt.claim.email.
--
-- Load order for the passing run (psql -v ON_ERROR_STOP=1 -f each file):
--   1. this file once, with sv1_run_tests unset (stubs only; tests skipped)
--   2. schema/quotes_phase1.sql
--   3. schema/quotes_phase2.sql
--   4. schema/inventory_costing.sql
--   5. schema/auth_lock_after_merge.sql
--   6. schema/archive_v1.sql
--   7. schema/a1_stock_doc_referee.sql
--   8. schema/a2_approve_invoice.sql
--   9. schema/a2_4_void_quote_approve_lock.sql
--  10. schema/a2_4b_void_quote_final.sql
--  11. schema/a2_6_freeze_approved_invoice.sql
--  12. schema/r1_round1_guards.sql
--  13. schema/b038_part_delete_guard.sql
--  14. schema/c1_customer_list.sql
--  15. schema/co1_company_numbering.sql
--      (not named in README; Approve's body has to be renamed to
--       shop_approve_invoice_r1 before VD1 and CL2 wrap it)
--  16. schema/vd1_void_invoice.sql
--      (not named in README; check 4 calls shop_void_invoice)
--  17. schema/cl2_customer_carry.sql
--  18. schema/co1_cutover_reset.sql
--      (not named in README; loaded because QL1's order loads it)
--  19. schema/bl3a_find_by_part.sql
--  20. schema/ql1_lock_quote_lines.sql
--  21. schema/sv1_save_quote.sql
--  22. schema/sv1_save_quote.sql again (re-run must be safe)
--  23. this file again with -v sv1_run_tests=1

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator') then
    create role authenticator nologin;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select case
    when coalesce(pg_catalog.current_setting('request.jwt.claim.email', true), '') = '' then null::jsonb
    else pg_catalog.jsonb_build_object('email', pg_catalog.current_setting('request.jwt.claim.email', true))
  end
$$;

-- The repo's schema files alter inventory. They do not create it.
-- sell_price is required by schema/r1_round1_guards.sql's check.
-- location is required by schema/inventory_costing.sql's index.
create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  part_number text,
  name text,
  qty integer default 0,
  qty_used integer default 0,
  buy_price numeric,
  sell_price numeric,
  source text,
  location text,
  updated_by text,
  updated_at timestamptz default now()
);

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid,
  part_number text,
  name text,
  action text not null,
  qty_before integer,
  qty_after integer,
  changed_by text,
  details text,
  created_at timestamptz default now()
);

\if :{?sv1_run_tests}
\else
\echo SV1 stubs applied. Tests skipped until sv1_run_tests is set.
\quit
\endif

\set ON_ERROR_STOP on

create or replace function pg_temp.sv1_lock_held(p_quote uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from pg_catalog.pg_locks l
    where l.locktype = 'advisory'
      and l.granted
      and l.pid = pg_catalog.pg_backend_pid()
      and l.objsubid = 1
      and l.classid = (
        (pg_catalog.hashtext('inmar-quote-sale:' || p_quote::text)::bigint >> 32) & 4294967295
      )::oid
      and l.objid = (
        pg_catalog.hashtext('inmar-quote-sale:' || p_quote::text)::bigint & 4294967295
      )::oid
  )
$$;

create or replace function pg_temp.sv1_state(p_id uuid)
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'quote', (select pg_catalog.to_jsonb(q) from public.quotes q where q.id = p_id),
    'lines', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.line_no, l.id)
      from public.quote_lines l
      where l.quote_id = p_id
    ), '[]'::jsonb)
  )
$$;

do $sv1$
declare
  v_uid uuid := '11111111-1111-4111-8111-111111111111';
  v_fake uuid := '22222222-2222-4222-8222-222222222222';
  v_missing uuid := '99999999-9999-4999-8999-999999999999';
  v_part uuid;
  v_gone uuid := '33333333-3333-4333-8333-333333333333';
  v_line jsonb;
  v_two jsonb;
  v_res jsonb;
  v_both uuid;
  v_both_num text;
  v_other uuid;
  v_acc uuid;
  v_acc_num text;
  v_price uuid;
  v_frac uuid;
  v_date uuid;
  v_partmiss uuid;
  v_sold uuid;
  v_sold_num text;
  v_sold_inv uuid;
  v_sold_inum text;
  v_sold_sentence text;
  v_seal uuid;
  v_seal_num text;
  v_frozen uuid;
  v_frozen_num text;
  v_copy uuid;
  v_copy_num text;
  v_before jsonb;
  v_msg text;
  v_def text;
  v_sec boolean;
  v_created timestamptz;
  v_id uuid;
  v_number text;
  v_company text;
begin
  if to_regprocedure('public.shop_save_quote(uuid,jsonb,jsonb)') is null then
    raise exception 'FAIL shop_save_quote is missing';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_uid::text, true);
  perform pg_catalog.set_config('request.jwt.claim.email', 'zz-staff@example.test', true);
  insert into auth.users (id, email) values (v_uid, 'zz-staff@example.test');
  insert into public.profiles (id, full_name, email)
  values (v_uid, 'ZZ Staff', 'zz-staff@example.test');
  insert into public.inventory (part_number, name, qty, buy_price, sell_price)
  values ('ZZ-PART', 'ZZ widget', 100, 1, 5)
  returning id into v_part;

  v_line := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'line_no', 1, 'inventory_id', v_part, 'part_number', 'ZZ-PART',
    'name', 'ZZ widget', 'qty', 1, 'unit_price', 5));
  v_two := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'line_no', 1, 'inventory_id', v_part, 'part_number', 'ZZ-PART',
      'name', 'ZZ widget', 'qty', 1, 'unit_price', 5),
    pg_catalog.jsonb_build_object(
      'line_no', 2, 'inventory_id', v_part, 'part_number', 'ZZ-PART',
      'name', 'ZZ second', 'qty', 2, 'unit_price', 7));

  -- Check 2. Changed header and changed lines both stick. A client quote_id is ignored.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Other', 'status', 'draft'), v_line);
  v_other := (v_res ->> 'id')::uuid;
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Both', 'status', 'draft', 'notes', 'ZZ old'), v_line);
  v_both := (v_res ->> 'id')::uuid;
  v_both_num := v_res ->> 'number';
  v_res := public.shop_save_quote(v_both,
    pg_catalog.jsonb_build_object('notes', 'ZZ both saved', 'status', 'sent', 'customer_name', 'ZZ Both'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'quote_id', v_other, 'line_no', 1, 'inventory_id', v_part, 'part_number', 'ZZ-PART',
      'name', 'ZZ both line', 'qty', 4, 'unit_price', 5)));
  if v_res ->> 'id' is distinct from v_both::text
     or v_res ->> 'number' is distinct from v_both_num
     or v_res ->> 'status' is distinct from 'sent'
     or (select count(*) from pg_catalog.jsonb_object_keys(v_res)) <> 3 then
    raise exception 'FAIL return: %', v_res;
  end if;
  if (select notes from public.quotes where id = v_both) is distinct from 'ZZ both saved'
     or (select status from public.quotes where id = v_both) is distinct from 'sent'
     or (select qty from public.quote_lines where quote_id = v_both) <> 4
     or (select name from public.quote_lines where quote_id = v_both) is distinct from 'ZZ both line'
     or (select quote_id from public.quote_lines where quote_id = v_both) is distinct from v_both
     or (select count(*) from public.quote_lines where quote_id = v_other) <> 1 then
    raise exception 'FAIL header and lines did not both stick on %', v_both_num;
  end if;
  if not pg_temp.sv1_lock_held(v_both) then
    raise exception 'FAIL advisory lock missing for %', v_both_num;
  end if;
  raise notice 'PASS header and lines both saved on %; lock held; client quote_id ignored', v_both_num;

  -- Keys the payload does not send keep their value, including when the payload is empty.
  v_res := public.shop_save_quote(v_both, '{}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'inventory_id', v_part, 'part_number', 'ZZ-PART', 'qty', 6)));
  if (select notes from public.quotes where id = v_both) is distinct from 'ZZ both saved'
     or (select status from public.quotes where id = v_both) is distinct from 'sent'
     or (select qty from public.quote_lines where quote_id = v_both) <> 6
     or (select name from public.quote_lines where quote_id = v_both) is distinct from 'Item'
     or (select unit_price from public.quote_lines where quote_id = v_both) <> 0
     or (select line_no from public.quote_lines where quote_id = v_both) <> 1 then
    raise exception 'FAIL empty payload did not keep the header or coalesce the line';
  end if;
  raise notice 'PASS unsent header keys kept; missing line name/price/line_no coalesced';

  -- Accepted quote saved with status draft ends draft.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Accepted', 'status', 'accepted'), v_line);
  v_acc := (v_res ->> 'id')::uuid;
  v_acc_num := v_res ->> 'number';
  if (select status from public.quotes where id = v_acc) is distinct from 'accepted' then
    raise exception 'FAIL accepted quote did not start accepted';
  end if;
  v_res := public.shop_save_quote(v_acc,
    pg_catalog.jsonb_build_object('status', 'draft', 'notes', 'ZZ reopen'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget', 'qty', 2, 'unit_price', 5)));
  if v_res ->> 'status' is distinct from 'draft'
     or (select status from public.quotes where id = v_acc) is distinct from 'draft'
     or (select notes from public.quotes where id = v_acc) is distinct from 'ZZ reopen'
     or (select qty from public.quote_lines where quote_id = v_acc) <> 2 then
    raise exception 'FAIL accepted quote did not return to draft: %', v_res;
  end if;
  raise notice 'PASS accepted % saved with status draft is draft', v_acc_num;

  -- Check 3. Insert the database refuses, after the delete would have run. Old lines remain.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Price', 'status', 'draft', 'notes', 'ZZ price header'), v_two);
  v_price := (v_res ->> 'id')::uuid;
  v_before := pg_temp.sv1_state(v_price);
  begin
    perform public.shop_save_quote(v_price,
      pg_catalog.jsonb_build_object('notes', 'ZZ should not stick', 'status', 'sent'),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget',
        'qty', 1, 'unit_price', -1)));
    raise exception 'FAIL negative price was saved';
  exception when others then
    if sqlerrm is distinct from 'FAIL negative price was saved'
       and sqlerrm not like '%quote_lines_unit_price_not_negative%' then
      raise exception 'FAIL negative price sentence: %', sqlerrm;
    end if;
    if sqlerrm = 'FAIL negative price was saved' then
      raise exception 'FAIL negative price was saved';
    end if;
  end;
  if pg_temp.sv1_state(v_price) is distinct from v_before then
    raise exception 'FAIL negative price changed the quote';
  end if;
  raise notice 'PASS negative price refused after insert; both old lines and the header remain';

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Qty', 'status', 'draft', 'notes', 'ZZ qty header'), v_two);
  v_frac := (v_res ->> 'id')::uuid;
  v_before := pg_temp.sv1_state(v_frac);
  begin
    perform public.shop_save_quote(v_frac,
      pg_catalog.jsonb_build_object('notes', 'ZZ should not stick'),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget',
        'qty', 1.5, 'unit_price', 5)));
    raise exception 'FAIL fractional qty was saved';
  exception when others then
    if sqlerrm not like '%quote_lines_qty_whole_positive%' then
      raise exception 'FAIL fractional qty sentence: %', sqlerrm;
    end if;
  end;
  if pg_temp.sv1_state(v_frac) is distinct from v_before then
    raise exception 'FAIL fractional qty changed the quote';
  end if;
  raise notice 'PASS fractional qty refused; old lines and the header remain';

  -- Header write fails after the lines would have been replaced.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object(
      'customer_name', 'ZZ Date', 'status', 'draft', 'notes', 'ZZ date header',
      'quote_date', '2026-01-01', 'valid_until', '2026-03-01'), v_two);
  v_date := (v_res ->> 'id')::uuid;
  v_before := pg_temp.sv1_state(v_date);
  begin
    perform public.shop_save_quote(v_date,
      pg_catalog.jsonb_build_object('quote_date', '2026-12-01', 'notes', 'ZZ should not stick', 'status', 'sent'),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget',
        'qty', 9, 'unit_price', 5)));
    raise exception 'FAIL bad quote_date was saved';
  exception when others then
    if sqlerrm not like '%quotes_valid_until_not_before_date%' then
      raise exception 'FAIL bad quote_date sentence: %', sqlerrm;
    end if;
  end;
  if pg_temp.sv1_state(v_date) is distinct from v_before then
    raise exception 'FAIL bad quote_date changed lines or header';
  end if;
  raise notice 'PASS header check failure left both lines and the header unchanged';

  -- Missing part raises before the delete. It is not the mid-save trap.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Part', 'status', 'draft', 'notes', 'ZZ part header'), v_line);
  v_partmiss := (v_res ->> 'id')::uuid;
  v_before := pg_temp.sv1_state(v_partmiss);
  begin
    perform public.shop_save_quote(v_partmiss,
      pg_catalog.jsonb_build_object('notes', 'ZZ should not stick'),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'inventory_id', v_gone, 'part_number', 'ZZ-GONE', 'name', 'ZZ gone', 'qty', 1, 'unit_price', 5)));
    raise exception 'FAIL missing part was saved';
  exception when others then
    v_msg := 'A line points at a part that is no longer on the shelf list. The quote was not saved.';
    if sqlerrm is distinct from v_msg then
      raise exception 'FAIL missing part sentence: %', sqlerrm;
    end if;
  end;
  if pg_temp.sv1_state(v_partmiss) is distinct from v_before then
    raise exception 'FAIL missing part changed the quote';
  end if;
  raise notice 'PASS missing part: %', v_msg;

  -- Check 4. Approved invoice: QL1's sentence, nothing changes. After void, the same save works.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Sold', 'status', 'draft', 'notes', 'ZZ sold header'), v_line);
  v_sold := (v_res ->> 'id')::uuid;
  v_sold_num := v_res ->> 'number';
  insert into public.invoices (quote_id, customer_name, status)
  values (v_sold, 'ZZ Buyer', 'draft')
  returning id into v_sold_inv;
  insert into public.invoice_lines (invoice_id, line_no, inventory_id, part_number, name, qty, unit_price)
  values (v_sold_inv, 1, v_part, 'ZZ-PART', 'ZZ widget', 1, 5);
  v_res := public.shop_approve_invoice(v_sold_inv);
  if coalesce(v_res ->> 'ok', '') <> 'true' or coalesce(v_res ->> 'already_approved', '') = 'true' then
    raise exception 'FAIL approve did not succeed: %', v_res;
  end if;
  v_sold_inum := v_res ->> 'number';
  v_sold_sentence := format(
    '%s has approved invoice %s. Its lines can''t change. Void the invoice first to change them.',
    v_sold_num, v_sold_inum);
  v_before := pg_temp.sv1_state(v_sold);
  begin
    perform public.shop_save_quote(v_sold,
      pg_catalog.jsonb_build_object('notes', 'ZZ locked edit', 'status', 'accepted'),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget', 'qty', 3, 'unit_price', 5)));
    raise exception 'FAIL locked save was allowed';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL locked sentence: %', sqlerrm;
    end if;
  end;
  if pg_temp.sv1_state(v_sold) is distinct from v_before then
    raise exception 'FAIL locked save changed the quote';
  end if;
  raise notice 'PASS locked save refused: %', v_sold_sentence;

  -- Check 9. Dup of the locked quote still saves as a new quote. The copy can be saved. The original stays refused.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Copy', 'status', 'draft'),
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'line_no', l.line_no, 'inventory_id', l.inventory_id, 'part_number', l.part_number,
        'name', l.name, 'qty', l.qty, 'unit_price', l.unit_price
      ) order by l.line_no)
     from public.quote_lines l where l.quote_id = v_sold));
  v_copy := (v_res ->> 'id')::uuid;
  v_copy_num := v_res ->> 'number';
  if v_copy = v_sold or v_copy_num = v_sold_num or v_copy_num !~ '^Q-L[0-9]{5}$' then
    raise exception 'FAIL dup did not make a new quote: %', v_res;
  end if;
  v_res := public.shop_save_quote(v_copy,
    pg_catalog.jsonb_build_object('notes', 'ZZ copy note', 'status', 'draft'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget', 'qty', 4, 'unit_price', 5)));
  if (select notes from public.quotes where id = v_copy) is distinct from 'ZZ copy note'
     or (select qty from public.quote_lines where quote_id = v_copy) <> 4 then
    raise exception 'FAIL save on the copy did not stick';
  end if;
  begin
    perform public.shop_save_quote(v_sold,
      pg_catalog.jsonb_build_object('notes', 'ZZ locked edit', 'status', 'accepted'),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget', 'qty', 3, 'unit_price', 5)));
    raise exception 'FAIL original was editable after dup';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL original sentence after dup: %', sqlerrm;
    end if;
  end;
  if pg_temp.sv1_state(v_sold) is distinct from v_before then
    raise exception 'FAIL dup changed the original';
  end if;
  raise notice 'PASS dup % saved and shop_save_quote on the copy worked; % stays refused', v_copy_num, v_sold_num;

  v_res := public.shop_void_invoice(v_sold_inv, 'ZZ void test');
  if coalesce(v_res ->> 'ok', '') <> 'true' or coalesce(v_res ->> 'status', '') <> 'void' then
    raise exception 'FAIL void: %', v_res;
  end if;
  v_res := public.shop_save_quote(v_sold,
    pg_catalog.jsonb_build_object('notes', 'ZZ locked edit', 'status', 'accepted'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget', 'qty', 3, 'unit_price', 5)));
  if v_res ->> 'status' is distinct from 'accepted'
     or (select notes from public.quotes where id = v_sold) is distinct from 'ZZ locked edit'
     or (select qty from public.quote_lines where quote_id = v_sold) <> 3 then
    raise exception 'FAIL save after void did not stick: %', v_res;
  end if;
  raise notice 'PASS after void, the same save succeeded on %', v_sold_num;

  -- Check 5. Seal void (lines, then status). A later save raises a2_4b and changes nothing.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Seal', 'status', 'draft', 'notes', 'ZZ open'), v_line);
  v_seal := (v_res ->> 'id')::uuid;
  v_seal_num := v_res ->> 'number';
  v_res := public.shop_save_quote(v_seal,
    pg_catalog.jsonb_build_object('status', 'void', 'notes', 'ZZ sealed'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ sealed line', 'qty', 8, 'unit_price', 5)));
  if v_res ->> 'status' is distinct from 'void'
     or (select status from public.quotes where id = v_seal) is distinct from 'void'
     or (select notes from public.quotes where id = v_seal) is distinct from 'ZZ sealed'
     or (select qty from public.quote_lines where quote_id = v_seal) <> 8
     or (select name from public.quote_lines where quote_id = v_seal) is distinct from 'ZZ sealed line' then
    raise exception 'FAIL seal did not save lines then void: %', v_res;
  end if;
  raise notice 'PASS sealing % saved the lines and then status void', v_seal_num;
  v_before := pg_temp.sv1_state(v_seal);
  begin
    perform public.shop_save_quote(v_seal,
      pg_catalog.jsonb_build_object('status', 'draft', 'notes', 'ZZ unvoid'),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget', 'qty', 1, 'unit_price', 5)));
    raise exception 'FAIL void quote was editable';
  exception when others then
    v_msg := v_seal_num || ' is void. Start a new quote to bring this deal back.';
    if sqlerrm is distinct from v_msg then
      raise exception 'FAIL void sentence: %', sqlerrm;
    end if;
  end;
  if pg_temp.sv1_state(v_seal) is distinct from v_before then
    raise exception 'FAIL void save changed the quote';
  end if;
  raise notice 'PASS already void %: %', v_seal_num, v_msg;

  -- Check 6. id, number, company, created_at cannot change. Unknown keys are ignored.
  -- A CL2 column that is not sent keeps its stored value.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Frozen', 'status', 'draft'), v_line);
  v_frozen := (v_res ->> 'id')::uuid;
  v_frozen_num := v_res ->> 'number';
  v_res := public.shop_save_quote(v_frozen,
    pg_catalog.jsonb_build_object('customer_notes', 'ZZ snap', 'notes', 'ZZ header', 'status', 'draft'),
    v_line);
  select id, number, company, created_at into v_id, v_number, v_company, v_created
  from public.quotes where id = v_frozen;
  v_res := public.shop_save_quote(v_frozen,
    pg_catalog.jsonb_build_object(
      'id', v_fake, 'number', 'Q-L99999', 'company', 'S',
      'created_at', '2000-01-01T00:00:00Z',
      'notes', 'ZZ renamed', 'status', 'sent', 'not_a_column', 'ZZ junk'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'inventory_id', v_part, 'part_number', 'ZZ-PART', 'name', 'ZZ widget', 'qty', 3, 'unit_price', 5)));
  if (select id from public.quotes where id = v_frozen) is distinct from v_id
     or (select number from public.quotes where id = v_frozen) is distinct from v_number
     or (select company from public.quotes where id = v_frozen) is distinct from v_company
     or (select created_at from public.quotes where id = v_frozen) is distinct from v_created
     or (select customer_notes from public.quotes where id = v_frozen) is distinct from 'ZZ snap'
     or (select customer_name from public.quotes where id = v_frozen) is distinct from 'ZZ Frozen'
     or (select notes from public.quotes where id = v_frozen) is distinct from 'ZZ renamed'
     or (select status from public.quotes where id = v_frozen) is distinct from 'sent'
     or (select qty from public.quote_lines where quote_id = v_frozen) <> 3
     or exists (select 1 from public.quotes where id = v_fake) then
    raise exception 'FAIL frozen columns changed on %', v_frozen_num;
  end if;
  raise notice 'PASS id, number, company, created_at unchanged; junk key ignored; customer_notes kept on %', v_frozen_num;

  -- Check 7. Sign-in, empty lines, unknown id.
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
    perform public.shop_save_quote(v_both, '{"notes":"ZZ"}'::jsonb, v_line);
    raise exception 'FAIL unsigned save was allowed';
  exception when others then
    if sqlerrm is distinct from 'Sign in required' then
      raise exception 'FAIL sign-in sentence: %', sqlerrm;
    end if;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_uid::text, true);
  if auth.uid() is distinct from v_uid then
    raise exception 'FAIL auth.uid was not restored';
  end if;
  raise notice 'PASS sign in required';

  foreach v_msg in array array['[]', 'null', '{}', '"nope"'] loop
    begin
      perform public.shop_save_quote(v_both, '{"notes":"ZZ"}'::jsonb, v_msg::jsonb);
      raise exception 'FAIL bad lines were allowed: %', v_msg;
    exception when others then
      if sqlerrm is distinct from 'Add at least one line before saving' then
        raise exception 'FAIL bad lines (%) sentence: %', v_msg, sqlerrm;
      end if;
    end;
  end loop;
  begin
    perform public.shop_save_quote(v_both, '{"notes":"ZZ"}'::jsonb, null);
    raise exception 'FAIL null lines were allowed';
  exception when others then
    if sqlerrm is distinct from 'Add at least one line before saving' then
      raise exception 'FAIL null lines sentence: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS empty, null, and non-array lines refused';

  begin
    perform public.shop_save_quote(v_missing, '{"notes":"ZZ"}'::jsonb, v_line);
    raise exception 'FAIL missing quote was allowed';
  exception when others then
    v_msg := 'This quote is missing. It was not saved.';
    if sqlerrm is distinct from v_msg then
      raise exception 'FAIL missing quote sentence: %', sqlerrm;
    end if;
  end;
  if exists (select 1 from public.quotes where id = v_missing) then
    raise exception 'FAIL missing id inserted a quote';
  end if;
  raise notice 'PASS unknown quote id: %', v_msg;

  -- Check 8. security definer, search_path, grants, lock expression, lines then header.
  select p.prosecdef, p.proconfig[1] into v_sec, v_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'shop_save_quote';
  if v_sec is distinct from true or v_def is distinct from 'search_path=""' then
    raise exception 'FAIL security definer/search_path: prosecdef % proconfig %', v_sec, v_def;
  end if;
  if not pg_catalog.has_function_privilege('authenticated', 'public.shop_save_quote(uuid,jsonb,jsonb)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.shop_save_quote(uuid,jsonb,jsonb)', 'execute')
     or pg_catalog.has_function_privilege('public', 'public.shop_save_quote(uuid,jsonb,jsonb)', 'execute')
     or pg_catalog.has_function_privilege('service_role', 'public.shop_save_quote(uuid,jsonb,jsonb)', 'execute') then
    raise exception 'FAIL execute grants';
  end if;
  v_def := pg_catalog.pg_get_functiondef('public.shop_save_quote(uuid,jsonb,jsonb)'::regprocedure);
  if v_def not like '%pg_advisory_xact_lock%'
     or v_def not like '%inmar-quote-sale:%'
     or pg_catalog.strpos(v_def, 'inmar-quote-sale:') > pg_catalog.strpos(v_def, 'delete from public.quote_lines')
     or pg_catalog.strpos(v_def, 'delete from public.quote_lines') = 0
     or pg_catalog.strpos(v_def, 'delete from public.quote_lines')
        > pg_catalog.strpos(v_def, 'update public.quotes') then
    raise exception 'FAIL lock or lines-then-header order';
  end if;
  if v_def ~* 'exception when' or v_def like '%contact_name%' then
    raise exception 'FAIL function catches errors or hard-codes a column';
  end if;
  if pg_catalog.pg_get_functiondef('public.shop_save_new_quote(text,jsonb,jsonb)'::regprocedure)
       not like '%no number was used%'
     or pg_catalog.pg_get_functiondef('public.shop_save_new_quote(text,jsonb,jsonb)'::regprocedure) like '%shop_save_quote%'
     or pg_catalog.pg_get_functiondef('public.shop_approve_invoice(uuid)'::regprocedure) like '%shop_save_quote%'
     or pg_catalog.pg_get_functiondef('public.shop_void_invoice(uuid,text)'::regprocedure) like '%shop_save_quote%'
     or pg_catalog.pg_get_functiondef('public.quote_lines_guard_wlock_approved()'::regprocedure) like '%shop_save_quote%' then
    raise exception 'FAIL a left-alone function was changed';
  end if;
  if not pg_temp.sv1_lock_held(v_both) then
    raise exception 'FAIL inmar-quote-sale lock was not held';
  end if;
  raise notice 'PASS security definer, search_path empty, execute only for authenticated, lines then header, lock held';

  raise notice 'SV1 ALL CHECKS PASSED';
end
$sv1$;
