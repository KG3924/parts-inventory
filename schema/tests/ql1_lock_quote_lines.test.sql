-- QL1 local tests. Throwaway Postgres only. No live Supabase.
--
-- Stubs are at the top and are safe to re-run.
-- auth.uid() reads request.jwt.claim.sub and returns null when that is unset.
-- auth.jwt() reads request.jwt.claim.email.
--
-- Load order for the passing run (psql -v ON_ERROR_STOP=1 -f each file):
--   1. this file once, with ql1_run_tests unset (stubs only; tests skipped)
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
--      (not named in README; check 6 calls the cutover tool)
--  19. schema/bl3a_find_by_part.sql
--  20. schema/ql1_lock_quote_lines.sql
--  21. schema/ql1_lock_quote_lines.sql again (re-run must be safe)
--  22. this file again with -v ql1_run_tests=1

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

\if :{?ql1_run_tests}
\else
\echo QL1 stubs applied. Tests skipped until ql1_run_tests is set.
\quit
\endif

\set ON_ERROR_STOP on

create or replace function pg_temp.ql1_lock_held(p_quote uuid)
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

do $ql1$
declare
  v_uid uuid := '11111111-1111-4111-8111-111111111111';
  v_part uuid;
  v_res jsonb;
  v_line jsonb;
  v_open uuid;
  v_open_num text;
  v_open_line uuid;
  v_draftq uuid;
  v_draft_num text;
  v_sold uuid;
  v_sold_num text;
  v_sold_inv uuid;
  v_sold_inum text;
  v_sold_line uuid;
  v_sold_sentence text;
  v_move uuid;
  v_move_line uuid;
  v_voidq uuid;
  v_void_num text;
  v_both uuid;
  v_both_num text;
  v_unlock uuid;
  v_unlock_num text;
  v_unlock_inv uuid;
  v_unlock_line uuid;
  v_blank uuid;
  v_blank_line uuid;
  v_status_only uuid;
  v_at_only uuid;
  v_dup uuid;
  v_dup_num text;
  v_dup_line uuid;
  v_wipeq uuid;
  v_wipe_line uuid;
  v_delq uuid;
  v_orphan_q uuid;
  v_orphan_line uuid;
  v_fk text;
  v_before jsonb;
  v_hdr_name text;
  v_hdr_notes text;
  v_msg text;
  v_def text;
  v_names text;
  v_kept bigint;
  v_sec boolean;
begin
  if to_regprocedure('public.quote_lines_guard_wlock_approved()') is null then
    raise exception 'FAIL guard function is missing';
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

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Open', 'status', 'draft'), v_line);
  v_open := (v_res ->> 'id')::uuid;
  v_open_num := v_res ->> 'number';
  select id into v_open_line from public.quote_lines where quote_id = v_open;

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Draft', 'status', 'draft'), v_line);
  v_draftq := (v_res ->> 'id')::uuid;
  v_draft_num := v_res ->> 'number';
  insert into public.invoices (quote_id, customer_name, status)
  values (v_draftq, 'ZZ Buyer', 'draft');

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Sold', 'status', 'draft'), v_line);
  v_sold := (v_res ->> 'id')::uuid;
  v_sold_num := v_res ->> 'number';
  select id into v_sold_line from public.quote_lines where quote_id = v_sold;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.line_no) into v_before
  from public.quote_lines l where l.quote_id = v_sold;
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
  if (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.line_no)
      from public.quote_lines l where l.quote_id = v_sold) is distinct from v_before then
    raise exception 'FAIL approve wrote quote_lines';
  end if;
  v_sold_sentence := format(
    '%s has approved invoice %s. Its lines can''t change. Void the invoice first to change them.',
    v_sold_num, v_sold_inum);
  raise notice 'PASS approve left quote_lines unchanged and returned %', v_sold_inum;

  -- Check 2. Insert, update, delete on the locked quote.
  begin
    insert into public.quote_lines (quote_id, line_no, part_number, name, qty, unit_price)
    values (v_sold, 2, 'ZZ-PART', 'ZZ widget', 1, 5);
    raise exception 'FAIL insert on a locked quote was allowed';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL insert sentence: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS insert refused: %', v_sold_sentence;

  begin
    update public.quote_lines set qty = 2 where id = v_sold_line;
    raise exception 'FAIL update on a locked quote was allowed';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL update sentence: %', sqlerrm;
    end if;
  end;
  if (select qty from public.quote_lines where id = v_sold_line) <> 1 then
    raise exception 'FAIL locked update changed the line';
  end if;
  raise notice 'PASS update refused: %', v_sold_sentence;

  begin
    delete from public.quote_lines where id = v_sold_line;
    raise exception 'FAIL delete on a locked quote was allowed';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL delete sentence: %', sqlerrm;
    end if;
  end;
  if not exists (select 1 from public.quote_lines where id = v_sold_line) then
    raise exception 'FAIL locked delete removed the line';
  end if;
  raise notice 'PASS delete refused: %', v_sold_sentence;

  -- Blank quote number reads "This quote".
  perform pg_catalog.set_config('inmar.co1_number', 'on', true);
  insert into public.quotes (number, status, customer_name)
  values ('', 'draft', 'ZZ Blank')
  returning id into v_blank;
  perform pg_catalog.set_config('inmar.co1_number', 'off', true);
  insert into public.quote_lines (quote_id, line_no, part_number, name, qty, unit_price)
  values (v_blank, 1, 'ZZ-PART', 'ZZ widget', 1, 5)
  returning id into v_blank_line;
  perform pg_catalog.set_config('inmar.co1_number', 'on', true);
  insert into public.invoices (number, quote_id, customer_name, status, approved_at)
  values ('I-L00999', v_blank, 'ZZ Buyer', 'approved', pg_catalog.now());
  perform pg_catalog.set_config('inmar.co1_number', 'off', true);
  begin
    update public.quote_lines set qty = 2 where id = v_blank_line;
    raise exception 'FAIL blank-number quote was editable';
  exception when others then
    v_msg := 'This quote has approved invoice I-L00999. Its lines can''t change. Void the invoice first to change them.';
    if sqlerrm is distinct from v_msg then
      raise exception 'FAIL blank sentence: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS blank quote number: %', v_msg;

  -- status = approved with approved_at null, and approved_at set with status draft.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ StatusOnly', 'status', 'draft'), v_line);
  v_status_only := (v_res ->> 'id')::uuid;
  perform pg_catalog.set_config('inmar.co1_number', 'on', true);
  insert into public.invoices (number, quote_id, customer_name, status)
  values ('I-L00998', v_status_only, 'ZZ Buyer', 'approved');
  perform pg_catalog.set_config('inmar.co1_number', 'off', true);
  begin
    update public.quote_lines set qty = 2 where quote_id = v_status_only;
    raise exception 'FAIL status-only approved quote was editable';
  exception when others then
    if sqlerrm not like (v_res ->> 'number') || ' has approved invoice I-L00998.%' then
      raise exception 'FAIL status-only sentence: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS status=approved locks without approved_at';

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ AtOnly', 'status', 'draft'), v_line);
  v_at_only := (v_res ->> 'id')::uuid;
  perform pg_catalog.set_config('inmar.co1_number', 'on', true);
  insert into public.invoices (number, quote_id, customer_name, status, approved_at)
  values ('I-L00997', v_at_only, 'ZZ Buyer', 'draft', pg_catalog.now());
  perform pg_catalog.set_config('inmar.co1_number', 'off', true);
  begin
    update public.quote_lines set qty = 2 where quote_id = v_at_only;
    raise exception 'FAIL approved_at-only quote was editable';
  exception when others then
    if sqlerrm not like (v_res ->> 'number') || ' has approved invoice I-L00997.%' then
      raise exception 'FAIL approved_at-only sentence: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS approved_at locks when status is still draft';

  -- Check 3. Move onto a locked quote, and off a locked quote.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Move', 'status', 'draft'), v_line);
  v_move := (v_res ->> 'id')::uuid;
  select id into v_move_line from public.quote_lines where quote_id = v_move;
  begin
    update public.quote_lines set quote_id = v_sold where id = v_move_line;
    raise exception 'FAIL move onto a locked quote was allowed';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL move-onto sentence: %', sqlerrm;
    end if;
  end;
  if (select quote_id from public.quote_lines where id = v_move_line) is distinct from v_move then
    raise exception 'FAIL move-onto changed quote_id';
  end if;
  raise notice 'PASS move onto locked quote refused';

  begin
    update public.quote_lines set quote_id = v_open where id = v_sold_line;
    raise exception 'FAIL move off a locked quote was allowed';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL move-off sentence: %', sqlerrm;
    end if;
  end;
  if (select quote_id from public.quote_lines where id = v_sold_line) is distinct from v_sold then
    raise exception 'FAIL move-off changed quote_id';
  end if;
  raise notice 'PASS move off locked quote refused';

  -- Check 4. Void the invoice, then the same line edit succeeds.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Unlock', 'status', 'draft'), v_line);
  v_unlock := (v_res ->> 'id')::uuid;
  v_unlock_num := v_res ->> 'number';
  select id into v_unlock_line from public.quote_lines where quote_id = v_unlock;
  insert into public.invoices (quote_id, customer_name, status)
  values (v_unlock, 'ZZ Buyer', 'draft')
  returning id into v_unlock_inv;
  insert into public.invoice_lines (invoice_id, line_no, inventory_id, part_number, name, qty, unit_price)
  values (v_unlock_inv, 1, v_part, 'ZZ-PART', 'ZZ widget', 1, 5);
  v_res := public.shop_approve_invoice(v_unlock_inv);
  if coalesce(v_res ->> 'ok', '') <> 'true' then
    raise exception 'FAIL unlock approve: %', v_res;
  end if;
  begin
    update public.quote_lines set qty = 2 where id = v_unlock_line;
    raise exception 'FAIL line was editable before void';
  exception when others then
    if sqlerrm not like v_unlock_num || ' has approved invoice ' || (v_res ->> 'number') || '.%' then
      raise exception 'FAIL pre-void sentence: %', sqlerrm;
    end if;
  end;
  v_res := public.shop_void_invoice(v_unlock_inv, 'ZZ void test');
  if coalesce(v_res ->> 'ok', '') <> 'true' or coalesce(v_res ->> 'status', '') <> 'void' then
    raise exception 'FAIL void: %', v_res;
  end if;
  if (select approved_at from public.invoices where id = v_unlock_inv) is not null
     or (select approved_at_was from public.invoices where id = v_unlock_inv) is null
     or (select status from public.invoices where id = v_unlock_inv) is distinct from 'void' then
    raise exception 'FAIL void did not clear approved_at';
  end if;
  update public.quote_lines set qty = 2 where id = v_unlock_line;
  if (select qty from public.quote_lines where id = v_unlock_line) <> 2 then
    raise exception 'FAIL line edit after void did not stick';
  end if;
  raise notice 'PASS after void, line edit succeeded on %', v_unlock_num;

  -- Check 5. Draft-only, no invoice, and void quotes.
  update public.quote_lines set qty = 4 where quote_id = v_open;
  update public.quotes set notes = 'ZZ open note' where id = v_open;
  if (select qty from public.quote_lines where quote_id = v_open) <> 4
     or (select notes from public.quotes where id = v_open) is distinct from 'ZZ open note' then
    raise exception 'FAIL no-invoice quote did not save';
  end if;
  delete from public.quote_lines where quote_id = v_draftq;
  insert into public.quote_lines (quote_id, line_no, inventory_id, part_number, name, qty, unit_price)
  values (v_draftq, 1, v_part, 'ZZ-PART', 'ZZ widget', 3, 5);
  update public.quotes set notes = 'ZZ draft save' where id = v_draftq;
  if (select qty from public.quote_lines where quote_id = v_draftq) <> 3
     or (select notes from public.quotes where id = v_draftq) is distinct from 'ZZ draft save' then
    raise exception 'FAIL draft-invoice quote save did not stick';
  end if;
  raise notice 'PASS no-invoice % and draft-only % still save', v_open_num, v_draft_num;

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Void', 'status', 'draft'), v_line);
  v_voidq := (v_res ->> 'id')::uuid;
  v_void_num := v_res ->> 'number';
  update public.quotes set status = 'void' where id = v_voidq;
  begin
    update public.quote_lines set qty = 2 where quote_id = v_voidq;
    raise exception 'FAIL void quote line was editable';
  exception when others then
    v_msg := v_void_num || ' is void. Start a new quote to bring this deal back.';
    if sqlerrm is distinct from v_msg then
      raise exception 'FAIL void sentence: %', sqlerrm;
    end if;
    if sqlerrm like '%has approved invoice%' then
      raise exception 'FAIL void quote got the new sentence';
    end if;
  end;
  raise notice 'PASS void quote sentence: %', v_msg;

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ VoidSold', 'status', 'draft'), v_line);
  v_both := (v_res ->> 'id')::uuid;
  v_both_num := v_res ->> 'number';
  insert into public.invoices (quote_id, customer_name, status)
  values (v_both, 'ZZ Buyer', 'draft')
  returning id into v_sold_inv;
  insert into public.invoice_lines (invoice_id, line_no, inventory_id, part_number, name, qty, unit_price)
  values (v_sold_inv, 1, v_part, 'ZZ-PART', 'ZZ widget', 1, 5);
  v_res := public.shop_approve_invoice(v_sold_inv);
  if coalesce(v_res ->> 'ok', '') <> 'true' then
    raise exception 'FAIL void+approved approve: %', v_res;
  end if;
  update public.quotes set status = 'void' where id = v_both;
  begin
    update public.quote_lines set qty = 2 where quote_id = v_both;
    raise exception 'FAIL void+approved line was editable';
  exception when others then
    v_msg := v_both_num || ' is void. Start a new quote to bring this deal back.';
    if sqlerrm is distinct from v_msg then
      raise exception 'FAIL void+approved sentence: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS void quote with an approved invoice still says: %', v_msg;

  -- Check 6. First save, quote delete, cutover.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ First', 'status', 'draft'), v_line);
  if coalesce(v_res ->> 'number', '') !~ '^Q-L[0-9]{5}$' then
    raise exception 'FAIL first save: %', v_res;
  end if;
  raise notice 'PASS shop_save_new_quote first save %', v_res ->> 'number';

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Keep', 'status', 'draft'), v_line);
  v_delq := (v_res ->> 'id')::uuid;
  begin
    delete from public.quotes where id = v_delq;
    raise exception 'FAIL quote delete was allowed';
  exception when others then
    if sqlerrm not like '%can''t be deleted%' then
      raise exception 'FAIL quote delete sentence: %', sqlerrm;
    end if;
  end;
  if not exists (select 1 from public.quotes where id = v_delq)
     or not exists (select 1 from public.quote_lines where quote_id = v_delq) then
    raise exception 'FAIL quote delete removed rows';
  end if;
  raise notice 'PASS quote delete still refused and rows remain';

  v_kept := (select count(*) from public.quotes);
  begin
    perform 1 from inmar_admin.co1_cutover_reset('count only');
    if (select count(*) from public.quotes) <> v_kept then
      raise exception 'FAIL count only changed quotes';
    end if;
  end;
  raise notice 'PASS cutover count only left % quotes', v_kept;

  begin
    perform 1 from inmar_admin.co1_cutover_reset('CLEAR PRACTICE DATA');
    if (select count(*) from public.quotes) <> 0 or (select count(*) from public.quote_lines) <> 0 then
      raise exception 'FAIL cutover did not clear quotes and lines';
    end if;
    raise exception 'QL1 rollback cutover probe';
  exception when others then
    if sqlerrm is distinct from 'QL1 rollback cutover probe' then
      raise;
    end if;
  end;
  if (select count(*) from public.quotes) <> v_kept then
    raise exception 'FAIL cutover probe was not rolled back';
  end if;
  if exists (select 1 from inmar_admin.cutover_log) then
    raise exception 'FAIL cutover log survived the probe';
  end if;
  raise notice 'PASS cutover clear removes rows and the probe rolls back';

  -- Check 7. Advisory lock, including both ids on a move.
  update public.quote_lines set qty = 4 where quote_id = v_open;
  if not pg_temp.ql1_lock_held(v_open) then
    raise exception 'FAIL advisory lock missing for %', v_open;
  end if;
  raise notice 'PASS advisory lock held for %', v_open_num;

  update public.quote_lines set quote_id = v_draftq where id = v_open_line;
  if not pg_temp.ql1_lock_held(v_open) or not pg_temp.ql1_lock_held(v_draftq) then
    raise exception 'FAIL move did not lock both quotes';
  end if;
  update public.quote_lines set quote_id = v_open where id = v_open_line;
  v_def := pg_catalog.pg_get_functiondef('public.quote_lines_guard_wlock_approved()'::regprocedure);
  if v_def not like '%old.quote_id < new.quote_id%' then
    raise exception 'FAIL lock order is not lower id first';
  end if;
  if v_def like '%approved_at_was%' then
    raise exception 'FAIL guard reads approved_at_was';
  end if;
  raise notice 'PASS both quote locks held on a move, lower id first';

  -- Check 8. security definer, search_path, execute revoked, no RLS policy from this guard.
  select p.prosecdef, p.proconfig[1] into v_sec, v_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'quote_lines_guard_wlock_approved';
  if v_sec is distinct from true or v_def is distinct from 'search_path=""' then
    raise exception 'FAIL security definer/search_path: prosecdef % proconfig %', v_sec, v_def;
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.quote_lines_guard_wlock_approved()', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.quote_lines_guard_wlock_approved()', 'execute')
     or pg_catalog.has_function_privilege('public', 'public.quote_lines_guard_wlock_approved()', 'execute') then
    raise exception 'FAIL execute was not revoked';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
    where c.relname = 'quote_lines' and pol.polname ilike '%wlock%'
  ) then
    raise exception 'FAIL a wlock RLS policy exists';
  end if;
  select string_agg(t.tgname, ',' order by t.tgname) into v_names
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  where c.relname = 'quote_lines' and not t.tgisinternal;
  if v_names <> 'quote_lines_void_final,quote_lines_wlock_approved' then
    raise exception 'FAIL trigger order: %', v_names;
  end if;
  raise notice 'PASS security definer, search_path empty, execute revoked, triggers: %', v_names;

  -- Check 11. Refused line delete leaves header and lines unchanged.
  select customer_name, notes into v_hdr_name, v_hdr_notes from public.quotes where id = v_sold;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.line_no) into v_before
  from public.quote_lines l where l.quote_id = v_sold;
  begin
    delete from public.quote_lines where quote_id = v_sold;
    raise exception 'FAIL stale line delete was allowed';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL stale sentence: %', sqlerrm;
    end if;
  end;
  if (select customer_name from public.quotes where id = v_sold) is distinct from v_hdr_name
     or (select notes from public.quotes where id = v_sold) is distinct from v_hdr_notes
     or (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.line_no)
         from public.quote_lines l where l.quote_id = v_sold) is distinct from v_before then
    raise exception 'FAIL stale save changed header or lines';
  end if;
  raise notice 'PASS refused line delete left header and lines unchanged';

  -- Check 14. Dup is a new quote. Original stays locked.
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'line_no', l.line_no, 'inventory_id', l.inventory_id, 'part_number', l.part_number,
    'name', l.name, 'qty', l.qty, 'unit_price', l.unit_price
  ) order by l.line_no) into v_line
  from public.quote_lines l where l.quote_id = v_sold;
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Copy', 'status', 'draft'), v_line);
  v_dup := (v_res ->> 'id')::uuid;
  v_dup_num := v_res ->> 'number';
  if v_dup = v_sold or v_dup_num = v_sold_num or v_dup_num !~ '^Q-L[0-9]{5}$' then
    raise exception 'FAIL dup did not make a new quote: %', v_res;
  end if;
  select id into v_dup_line from public.quote_lines where quote_id = v_dup;
  update public.quote_lines set qty = 9 where id = v_dup_line;
  delete from public.quote_lines where id = v_dup_line;
  if exists (select 1 from public.quote_lines where quote_id = v_dup) then
    raise exception 'FAIL dup line delete did not remove the line';
  end if;
  begin
    update public.quote_lines set qty = 2 where id = v_sold_line;
    raise exception 'FAIL original was editable after dup';
  exception when others then
    if sqlerrm is distinct from v_sold_sentence then
      raise exception 'FAIL original sentence after dup: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS dup saved % and its lines edit; % stays locked', v_dup_num, v_sold_num;

  -- a2_4b wipe flag, and a line whose quote row is already gone.
  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Wipe', 'status', 'draft'), v_line);
  v_wipeq := (v_res ->> 'id')::uuid;
  select id into v_wipe_line from public.quote_lines where quote_id = v_wipeq;
  perform pg_catalog.set_config('inmar.co1_number', 'on', true);
  insert into public.invoices (number, quote_id, customer_name, status, approved_at)
  values ('I-L00996', v_wipeq, 'ZZ Buyer', 'approved', pg_catalog.now());
  perform pg_catalog.set_config('inmar.co1_number', 'off', true);
  perform pg_catalog.set_config('inmar.wipe_' || pg_catalog.replace(v_wipeq::text, '-', ''), 'on', true);
  delete from public.quote_lines where id = v_wipe_line;
  if exists (select 1 from public.quote_lines where id = v_wipe_line) then
    raise exception 'FAIL wipe flag did not allow the line delete';
  end if;
  raise notice 'PASS wipe flag allows the line delete';

  v_res := public.shop_save_new_quote('L',
    pg_catalog.jsonb_build_object('customer_name', 'ZZ Orphan', 'status', 'draft'), v_line);
  v_orphan_q := (v_res ->> 'id')::uuid;
  select id into v_orphan_line from public.quote_lines where quote_id = v_orphan_q;
  select conname into v_fk
  from pg_catalog.pg_constraint
  where conrelid = 'public.quote_lines'::regclass and contype = 'f'
    and pg_catalog.pg_get_constraintdef(oid) like '%quotes%';
  execute format('alter table public.quote_lines drop constraint %I', v_fk);
  alter table public.quotes disable trigger quotes_co1_lock;
  alter table public.quotes disable trigger quotes_void_final;
  delete from public.quotes where id = v_orphan_q;
  alter table public.quotes enable trigger quotes_co1_lock;
  alter table public.quotes enable trigger quotes_void_final;
  delete from public.quote_lines where id = v_orphan_line;
  execute format(
    'alter table public.quote_lines add constraint %I foreign key (quote_id) references public.quotes (id) on delete cascade',
    v_fk);
  if exists (select 1 from public.quote_lines where id = v_orphan_line) then
    raise exception 'FAIL orphan line was not deleted';
  end if;
  raise notice 'PASS line delete allowed when the quote row is already gone';

  -- Approve's SQL does not mention quote_lines.
  if pg_catalog.pg_get_functiondef('public.shop_approve_invoice(uuid)'::regprocedure) ~* 'quote_lines'
     or pg_catalog.pg_get_functiondef('public.shop_approve_invoice_r1(uuid)'::regprocedure) ~* 'quote_lines' then
    raise exception 'FAIL shop_approve_invoice references quote_lines';
  end if;
  raise notice 'PASS shop_approve_invoice does not reference quote_lines';

  raise notice 'QL1 ALL CHECKS PASSED';
end
$ql1$;
