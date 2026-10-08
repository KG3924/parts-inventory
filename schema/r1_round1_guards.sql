-- =============================================================================
-- Round 1 — bug-fix guards (BUG-007, 010, 012, 013, 014, 015, 022 and the
-- no-customer Approve block).
--
-- DO NOT RUN until this app build is on live Pages and every phone has
-- hard-refreshed. Order:
--   1. Merge, and wait until GitHub Pages is serving this build.
--   2. Hard-refresh every phone.
--   3. Then run this file once in the Supabase SQL editor.
--   4. Smoke. A grey button alone is not the lock. Pass is the database
--      refusing with the sentences below.
-- Safe to re-run.
--
-- Every CHECK below is added NOT VALID. Postgres does not scan old rows, so
-- approved (frozen) invoices and old practice rows are never touched. Only
-- rows inserted or updated after this runs are checked.
-- NEVER run ALTER TABLE ... VALIDATE CONSTRAINT on these: old practice rows
-- (including approved invoices) would fail it.
--
-- Does not loosen anything. Does not change RLS, invoices_guard_approve, the
-- A2.6 freeze triggers, the void-quote triggers, shop_next_doc_number, or when
-- quote numbers are issued. The A2.4 void-quote refuse inside
-- shop_approve_invoice is kept word for word.
--
-- This file replaces shop_commit_qty and shop_approve_invoice. Re-running
-- schema/a1_stock_doc_referee.sql, schema/a2_approve_invoice.sql, or
-- schema/a2_4_void_quote_approve_lock.sql AFTER this file would put the old
-- versions back. If one of those is ever re-run, run this file again after it.
-- =============================================================================

-- 1. No negatives / bad quantities on new or changed rows (BUG-013/014/015/012).
alter table public.quote_lines drop constraint if exists quote_lines_qty_whole_positive;
alter table public.quote_lines add constraint quote_lines_qty_whole_positive
  check (qty > 0 and qty = trunc(qty)) not valid;

alter table public.quote_lines drop constraint if exists quote_lines_unit_price_not_negative;
alter table public.quote_lines add constraint quote_lines_unit_price_not_negative
  check (unit_price >= 0) not valid;

alter table public.invoice_lines drop constraint if exists invoice_lines_qty_whole_positive;
alter table public.invoice_lines add constraint invoice_lines_qty_whole_positive
  check (qty > 0 and qty = trunc(qty)) not valid;

alter table public.invoice_lines drop constraint if exists invoice_lines_unit_price_not_negative;
alter table public.invoice_lines add constraint invoice_lines_unit_price_not_negative
  check (unit_price >= 0) not valid;

alter table public.invoices drop constraint if exists invoices_fees_not_negative;
alter table public.invoices add constraint invoices_fees_not_negative
  check (shipping_fee >= 0 and duty >= 0 and tariffs >= 0 and cc_fee_amount >= 0) not valid;

alter table public.invoices drop constraint if exists invoices_totals_not_negative;
alter table public.invoices add constraint invoices_totals_not_negative
  check (subtotal >= 0 and total >= 0) not valid;

alter table public.inventory drop constraint if exists inventory_prices_not_negative;
alter table public.inventory add constraint inventory_prices_not_negative
  check (sell_price >= 0 and buy_price >= 0) not valid;

alter table public.inventory drop constraint if exists inventory_qty_not_negative;
alter table public.inventory add constraint inventory_qty_not_negative
  check (qty >= 0 and qty_used >= 0) not valid;

alter table public.quotes drop constraint if exists quotes_valid_until_not_before_date;
alter table public.quotes add constraint quotes_valid_until_not_before_date
  check (valid_until >= quote_date) not valid;

-- 2. SALE RULE — the one place Approve checks the customer.
--    shop_approve_invoice calls this before it locks or debits any shelf row.
--    A blank or spaces-only customer is refused. $0.00 invoices and $0.00
--    lines are allowed (a giveaway is a price edited to $0 plus a note).
--    Execute is revoked: only shop_approve_invoice (owner context) calls it.
create or replace function public.shop_invoice_sale_rules(p_invoice_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;

  -- RULE: A SALE NEEDS A CUSTOMER. Blank or spaces-only is blank.
  if coalesce(v_inv.customer_name, '') ~ '^[[:space:]]*$' then
    raise exception 'This invoice has no customer. Add a customer or tap Cash sale, then Save & print before Approve.';
  end if;
end;
$$;

revoke all on function public.shop_invoice_sale_rules(uuid) from public, anon, authenticated;

-- 3. Stock change: refuse Remove 0 and Remove more than on hand (BUG-010, BUG-022).
create or replace function public.shop_commit_qty(
  p_inventory_id uuid,
  p_action text,
  p_qty numeric,
  p_condition text default 'new',
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := lower(btrim(p_action));
  v_cond text := lower(btrim(coalesce(p_condition, 'new')));
  v_amount numeric := coalesce(p_qty, 0);
  v_row public.inventory%rowtype;
  v_before numeric;
  v_after numeric;
  v_delta numeric;
  v_who text;
  v_method text := 'fifo';
  v_adj uuid;
  v_left numeric;
  v_take numeric;
  v_layer record;
  v_log_action text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_inventory_id is null then
    raise exception 'Missing part';
  end if;
  if v_cond not in ('new', 'used') then
    raise exception 'Unknown stock bucket';
  end if;
  if v_action not in ('add', 'remove', 'set', 'in', 'out', 'stock_in', 'stock_out', 'set_qty') then
    raise exception 'Unknown stock action';
  end if;
  if v_action in ('in', 'stock_in') then v_action := 'add'; end if;
  if v_action in ('out', 'stock_out') then v_action := 'remove'; end if;
  if v_action = 'set_qty' then v_action := 'set'; end if;
  if v_amount < 0 or v_amount <> trunc(v_amount) then
    raise exception 'Quantity must be a whole number, zero or more';
  end if;
  -- Round 1 (BUG-022): Remove 0 is refused. Nothing is written.
  if v_action = 'add' and v_amount = 0 then
    raise exception 'Enter how many to add — 1 or more.';
  end if;
  if v_action = 'remove' and v_amount = 0 then
    raise exception 'Enter how many to remove — 1 or more.';
  end if;

  begin
    select full_name into v_who from public.profiles where id = auth.uid();
  exception when undefined_table then
    v_who := null;
  end;
  if v_who is null or btrim(v_who) = '' then
    v_who := coalesce(auth.jwt() ->> 'email', 'signed-in');
  end if;

  select * into v_row from public.inventory where id = p_inventory_id for update;
  if not found then
    raise exception 'Part not found';
  end if;

  if v_cond = 'used' then
    v_before := coalesce(v_row.qty_used, 0);
  else
    v_before := coalesce(v_row.qty, 0);
  end if;

  if v_action = 'add' then
    v_after := v_before + v_amount;
    v_log_action := 'stock_in';
  elsif v_action = 'remove' then
    -- Round 1 (BUG-010): removing more than is on hand is refused everywhere.
    -- Approve keeps its own sentence (it sets inmar.strict_remove). Floor
    -- Commit no longer floors at zero; it refuses and points at Set.
    if v_before < v_amount then
      if coalesce(current_setting('inmar.strict_remove', true), '') = 'on' then
        raise exception 'Not enough on hand for % (have %, need %)',
          coalesce(v_row.part_number, 'part'), v_before, v_amount;
      end if;
      if v_cond = 'used' then
        raise exception 'Only % used on hand. If the shelf has more, use Set to correct the count first.', v_before;
      end if;
      raise exception 'Only % on hand. If the shelf has more, use Set to correct the count first.', v_before;
    end if;
    v_after := v_before - v_amount;
    v_log_action := 'stock_out';
  else
    v_after := v_amount;
    v_log_action := 'set_qty';
  end if;
  v_delta := v_after - v_before;

  perform set_config('inmar.qty_write', 'on', true);

  if v_cond = 'used' then
    update public.inventory
      set qty_used = v_after,
          updated_by = v_who,
          updated_at = now()
      where id = p_inventory_id;
  else
    update public.inventory
      set qty = v_after,
          updated_by = v_who,
          updated_at = now()
      where id = p_inventory_id;
  end if;

  if v_delta <> 0 then
    insert into public.inventory_adjustments (
      inventory_id, part_number, name, action, qty_before, qty_after, changed_by, details
    ) values (
      p_inventory_id, v_row.part_number, v_row.name, v_log_action,
      v_before, v_after, v_who, p_details
    )
    returning id into v_adj;

    begin
      select value into v_method from public.app_settings where key = 'costing_method';
    exception when undefined_table then
      v_method := 'fifo';
    end;
    if v_method is null or lower(v_method) <> 'lifo' then
      v_method := 'fifo';
    else
      v_method := 'lifo';
    end if;

    begin
      if v_delta > 0 then
        insert into public.inventory_cost_layers (
          inventory_id, part_number, unit_cost, qty_original, qty_remaining,
          condition, source, changed_by
        ) values (
          p_inventory_id,
          v_row.part_number,
          case when v_cond = 'used' then 0 else coalesce(v_row.buy_price, 0) end,
          v_delta,
          v_delta,
          v_cond,
          'commit',
          v_who
        );
      else
        v_left := -v_delta;
        if v_method = 'lifo' then
          for v_layer in
            select id, qty_remaining
            from public.inventory_cost_layers
            where inventory_id = p_inventory_id
              and condition = v_cond
              and qty_remaining > 0
            order by acquired_at desc nulls last, id desc
            for update
          loop
            exit when v_left <= 0;
            v_take := least(v_layer.qty_remaining, v_left);
            update public.inventory_cost_layers
              set qty_remaining = qty_remaining - v_take
              where id = v_layer.id;
            v_left := v_left - v_take;
          end loop;
        else
          for v_layer in
            select id, qty_remaining
            from public.inventory_cost_layers
            where inventory_id = p_inventory_id
              and condition = v_cond
              and qty_remaining > 0
            order by acquired_at asc nulls last, id asc
            for update
          loop
            exit when v_left <= 0;
            v_take := least(v_layer.qty_remaining, v_left);
            update public.inventory_cost_layers
              set qty_remaining = qty_remaining - v_take
              where id = v_layer.id;
            v_left := v_left - v_take;
          end loop;
        end if;
      end if;
    exception when undefined_table then
      null;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'inventory_id', p_inventory_id,
    'condition', v_cond,
    'action', v_log_action,
    'qty_before', v_before,
    'qty_after', v_after,
    'qty', case when v_cond = 'used' then coalesce(v_row.qty, 0) else v_after end,
    'qty_used', case when v_cond = 'used' then v_after else coalesce(v_row.qty_used, 0) end,
    'adjustment_id', v_adj
  );
end;
$$;

-- 4. Approve: call the sale rules before any debit; report when the quote was marked Accepted.
create or replace function public.shop_approve_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_line record;
  v_part record;
  v_who text;
  v_ids uuid[] := '{}';
  v_need numeric[] := '{}';
  v_i integer;
  v_pos integer;
  v_want numeric;
  v_locked integer := 0;
  v_debited integer := 0;
  v_approved_at timestamptz;
  v_part_no text;
  v_quote public.quotes%rowtype;
  v_marked_accepted boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_invoice_id is null then
    raise exception 'Missing invoice';
  end if;

  select * into v_inv
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  -- Second tap / twin phone: the row is already the idempotency key.
  if v_inv.status = 'approved' or v_inv.approved_at is not null then
    return jsonb_build_object(
      'ok', true,
      'already_approved', true,
      'invoice_id', v_inv.id,
      'number', v_inv.number,
      'status', 'approved',
      'approved_at', v_inv.approved_at,
      'approved_by', v_inv.approved_by,
      'lines_debited', 0
    );
  end if;

  if v_inv.quote_id is not null then
    perform pg_advisory_xact_lock(hashtext('inmar-quote-sale:' || v_inv.quote_id::text));
    select * into v_quote
    from public.quotes
    where id = v_inv.quote_id
    for update;
    if not found then
      raise exception 'This invoice''s quote is missing. This invoice can''t be approved.';
    end if;
    if lower(btrim(coalesce(v_quote.status, ''))) = 'void' then
      raise exception '% is void. This invoice can''t be approved.',
        coalesce(nullif(btrim(v_quote.number), ''), 'This quote');
    end if;
    if exists (
      select 1 from public.invoices i
      where i.quote_id = v_inv.quote_id
        and i.id <> v_inv.id
        and (i.status = 'approved' or i.approved_at is not null)
    ) then
      raise exception 'This quote already has an approved invoice';
    end if;
  end if;

  if not exists (
    select 1 from public.invoice_lines where invoice_id = p_invoice_id
  ) then
    raise exception 'This invoice has no lines. It stayed a draft.';
  end if;

  -- Round 1: the no-customer rule lives in one function, before any debit.
  perform public.shop_invoice_sale_rules(p_invoice_id);

  for v_line in
    select *
    from public.invoice_lines
    where invoice_id = p_invoice_id
    order by line_no
    for update
  loop
    v_part_no := nullif(btrim(coalesce(v_line.part_number, '')), '');
    if v_line.inventory_id is null then
      -- Fee / shipping line: no part number, no shelf id. Stock-looking lines must fail.
      if v_part_no is not null then
        raise exception 'Stock line % (%) has no shelf part. Invoice stayed a draft.',
          v_line.line_no, v_part_no;
      end if;
      continue;
    end if;
    if v_line.qty is null or v_line.qty < 0 or v_line.qty <> trunc(v_line.qty) then
      raise exception 'Stock line % quantity must be a whole number, zero or more. Invoice stayed a draft.',
        v_line.line_no;
    end if;
    if v_line.qty = 0 then
      continue;
    end if;
    v_pos := 0;
    for v_i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
      if v_ids[v_i] = v_line.inventory_id then
        v_pos := v_i;
        exit;
      end if;
    end loop;
    if v_pos = 0 then
      v_ids := v_ids || v_line.inventory_id;
      v_need := v_need || v_line.qty;
    else
      v_need[v_pos] := v_need[v_pos] + v_line.qty;
    end if;
  end loop;

  -- Lock shelf rows in id order, then decide. Any short line aborts before a debit.
  for v_part in
    select i.id, i.part_number, coalesce(i.qty, 0) as on_hand
    from public.inventory i
    where i.id = any(v_ids)
    order by i.id
    for update of i
  loop
    v_locked := v_locked + 1;
    v_want := null;
    for v_i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
      if v_ids[v_i] = v_part.id then
        v_want := v_need[v_i];
        exit;
      end if;
    end loop;
    if v_want is null or v_want > v_part.on_hand then
      raise exception 'Not enough on hand for % (have %, invoice wants %). Invoice stayed a draft.',
        coalesce(v_part.part_number, 'part'), coalesce(v_part.on_hand, 0), coalesce(v_want, 0);
    end if;
  end loop;

  if v_locked <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'A stock line points at a missing part. Invoice stayed a draft.';
  end if;

  begin
    select full_name into v_who from public.profiles where id = auth.uid();
  exception when undefined_table then
    v_who := null;
  end;
  if v_who is null or btrim(v_who) = '' then
    v_who := coalesce(auth.jwt() ->> 'email', 'signed-in');
  end if;

  perform set_config('inmar.strict_remove', 'on', true);

  for v_line in
    select inventory_id, qty
    from public.invoice_lines
    where invoice_id = p_invoice_id
      and inventory_id is not null
      and coalesce(qty, 0) > 0
    order by line_no
  loop
    perform public.shop_commit_qty(
      v_line.inventory_id,
      'remove',
      v_line.qty,
      'new',
      'Approved ' || v_inv.number
    );
    v_debited := v_debited + 1;
  end loop;

  perform set_config('inmar.invoice_approve', 'on', true);

  update public.invoices
    set status = 'approved',
        approved_at = now(),
        approved_by = v_who,
        updated_at = now()
    where id = p_invoice_id
    returning approved_at into v_approved_at;

  if v_inv.quote_id is not null then
    -- BUG-007: Approve still accepts the quote. The screen now says so.
    v_marked_accepted := lower(btrim(coalesce(v_quote.status, ''))) <> 'accepted';
    update public.quotes
      set status = 'accepted',
          updated_at = now()
      where id = v_inv.quote_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already_approved', false,
    'invoice_id', p_invoice_id,
    'number', v_inv.number,
    'status', 'approved',
    'approved_at', v_approved_at,
    'approved_by', v_who,
    'lines_debited', v_debited,
    'quote_marked_accepted', v_marked_accepted
  );
end;
$$;

-- Same grants as schema/a2_approve_invoice.sql. Nothing is widened.
revoke all on function public.shop_commit_qty(uuid, text, numeric, text, text) from public, anon;
revoke all on function public.shop_approve_invoice(uuid) from public, anon;
grant execute on function public.shop_commit_qty(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.shop_approve_invoice(uuid) to authenticated;

notify pgrst, 'reload schema';
