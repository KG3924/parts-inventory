-- =============================================================================
-- A1 stock + document-number referee
--
-- DO NOT RUN until the app that calls these functions is on the phones
-- (hard-refresh after the Pages deploy). Running this first breaks Commit
-- and new Q- / INV- / PL- numbers on the old page.
--
-- Order:
--   1. Deploy the app (RPCs only).
--   2. Hard-refresh every phone.
--   3. Then run this file once in the Supabase SQL editor.
--   4. Floor-smoke only after both are live.
--
-- Additive. Safe to re-run. Does not delete inventory rows.
-- Already applied on production. The strict-remove check in shop_commit_qty
-- must stay: invoice Approve sets inmar.strict_remove, floor Commit does not.
-- =============================================================================

-- Next Q- / INV- / PL- / SO- number. One row lock so two phones cannot tie.
create or replace function public.shop_next_doc_number(doc_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := lower(btrim($1));
  v_year integer := extract(year from (now() at time zone 'America/Chicago'))::integer;
  v_prefix text;
  v_next integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  v_prefix := case v_type
    when 'quote' then 'Q'
    when 'invoice' then 'INV'
    when 'packing_list' then 'PL'
    when 'order' then 'SO'
    else null
  end;
  if v_prefix is null then
    raise exception 'Unknown document type';
  end if;

  perform pg_advisory_xact_lock(hashtext('inmar-doc:' || v_type || ':' || v_year::text));

  -- Column names stay inside the format string so doc_type is not ambiguous (42702).
  execute format(
    'insert into public.document_counters (doc_type, year, last_value)
     values (%L, %s, 0)
     on conflict (doc_type, year) do nothing',
    v_type, v_year
  );

  execute format(
    'update public.document_counters as c
     set last_value = c.last_value + 1
     where c.doc_type = %L and c.year = %s
     returning c.last_value',
    v_type, v_year
  ) into v_next;

  if v_next is null then
    raise exception 'Could not assign a document number';
  end if;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_next::text, 3, '0');
end;
$$;

-- Qty referee. Locks the part row, writes stock, the adjustment, and cost layers together.
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
    -- Floor Commit stays soft (floors at zero). Invoice Approve sets inmar.strict_remove
    -- so a short invoice fails instead of taking more than is on the shelf.
    if coalesce(current_setting('inmar.strict_remove', true), '') = 'on'
       and v_before < v_amount then
      raise exception 'Not enough on hand for % (have %, need %)',
        coalesce(v_row.part_number, 'part'), v_before, v_amount;
    end if;
    v_after := greatest(0, v_before - v_amount);
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

create or replace function public.inventory_guard_qty()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.qty is distinct from old.qty
       or new.qty_used is distinct from old.qty_used then
      if coalesce(current_setting('inmar.qty_write', true), '') <> 'on' then
        raise exception 'Stock qty is changed only by shop_commit_qty';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_qty_referee on public.inventory;
create trigger inventory_qty_referee
  before update on public.inventory
  for each row
  execute function public.inventory_guard_qty();

revoke all on function public.shop_next_doc_number(text) from public, anon;
revoke all on function public.shop_commit_qty(uuid, text, numeric, text, text) from public, anon;
revoke all on function public.inventory_guard_qty() from public, anon;

grant execute on function public.shop_next_doc_number(text) to authenticated;
grant execute on function public.shop_commit_qty(uuid, text, numeric, text, text) to authenticated;

revoke insert, update, delete on table public.document_counters from authenticated, anon;
grant select on table public.document_counters to authenticated;

notify pgrst, 'reload schema';
