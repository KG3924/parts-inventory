-- =============================================================================
-- VD1 - Void an approved invoice. Stock goes back once, at its original cost.
--
-- DO NOT RUN until this app build is on live Pages and every phone has
-- hard-refreshed. Order:
--   1. Merge, and wait until GitHub Pages is serving this build.
--   2. Hard-refresh every phone.
--   3. Run this file once in the Supabase SQL editor. Safe to re-run.
--   4. Then run the checks.
--
-- One new function: shop_void_invoice(invoice id, reason). It is one locked
-- database step. All of it happens, or none of it does.
--   - It locks the invoice row first. Two phones at once give one void and
--     one "already void" (already_void = true, nothing moves).
--   - Only a signed-in staff member (a row in profiles) can call it.
--   - Only an approved invoice can be voided. A draft is refused.
--   - A reason is required (1 to 300 characters after trimming).
--   - If any stock line's part, or its cost record, is gone, it stops with a
--     plain message naming the part. Nothing changes.
--   - Each stock line goes back to the shelf with its own stock-history row:
--     "Returned: voided I-xxxxx (reason)".
--   - COST: shop_approve_invoice now records which cost layers each approval
--     used (new table invoice_stock_takes, written by a trigger). The void
--     gives exactly those quantities back to exactly those layers, so layers
--     read the same after the void as before the invoice. Price history is
--     never touched. An invoice approved BEFORE this file ran has no record,
--     so the void refuses it with a plain message and changes nothing.
--   - The invoice becomes status 'void'. It keeps its number and company.
--     voided_at, voided_by, void_reason are saved. approved_at moves to
--     approved_at_was and approved_at becomes empty, so the quote is free for
--     a new approved invoice and the one-approved-per-quote index lets it in.
--   - The quote goes to 'accepted' in the same step, unless it is cancelled
--     (void), which stays cancelled.
-- A void invoice is frozen like an approved one: header and lines can't be
-- edited, and Approve refuses it.
--
-- Four existing functions are replaced below: the approve referee, the two
-- freeze guards, and the Approve entry point. Each is the current live text
-- plus lines marked "-- VD1". The stock referee (shop_commit_qty), Approve's
-- own body (shop_approve_invoice_r1) and every quote lock are untouched.
-- =============================================================================

begin;

alter table public.invoices add column if not exists voided_at timestamptz;
alter table public.invoices add column if not exists voided_by text;
alter table public.invoices add column if not exists void_reason text;
alter table public.invoices add column if not exists approved_at_was timestamptz;

-- Which cost layers each approval used. The app can't read or write it.
create table if not exists public.invoice_stock_takes (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  layer_id uuid,
  inventory_id uuid,
  qty numeric not null,
  taken_at timestamptz not null default now()
);
create index if not exists invoice_stock_takes_invoice_idx on public.invoice_stock_takes (invoice_id);
alter table public.invoice_stock_takes enable row level security;
revoke all on table public.invoice_stock_takes from public, anon, authenticated;

-- Writes a take row whenever a layer is used up while Approve has named its invoice.
create or replace function public.inventory_cost_layers_log_take()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv text := nullif(pg_catalog.current_setting('inmar.take_invoice', true), '');
begin
  if v_inv is not null and new.qty_remaining < old.qty_remaining then
    insert into public.invoice_stock_takes (invoice_id, layer_id, inventory_id, qty)
    values (v_inv::uuid, new.id, new.inventory_id, old.qty_remaining - new.qty_remaining);
  end if;
  return null;
end;
$$;
revoke all on function public.inventory_cost_layers_log_take() from public, anon, authenticated;
drop trigger if exists inventory_cost_layers_log_take on public.inventory_cost_layers;
create trigger inventory_cost_layers_log_take
  after update of qty_remaining on public.inventory_cost_layers
  for each row
  execute function public.inventory_cost_layers_log_take();

-- 1. Approve referee (A2). Adds one early return: the void step, and only it.
create or replace function public.invoices_guard_approve()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' or old.approved_at is not null then
      raise exception 'Approved invoices stay on the books';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    -- VD1: shop_void_invoice sets this flag, and only approved -> void passes.
    if coalesce(current_setting('inmar.invoice_void', true), '') = 'on'
       and old.status = 'approved' and new.status = 'void' then
      return new;
    end if;
    if old.approved_at is not null and new.approved_at is distinct from old.approved_at then
      raise exception 'Approved invoices stay approved';
    end if;
    if old.status = 'approved' and new.status is distinct from 'approved' then
      raise exception 'Approved invoices stay approved';
    end if;
    if ((new.status = 'approved' and old.status is distinct from 'approved')
        or (new.approved_at is not null and old.approved_at is null))
       and coalesce(current_setting('inmar.invoice_approve', true), '') <> 'on' then
      raise exception 'Approve an invoice only with shop_approve_invoice';
    end if;
    if new.quote_id is not null and new.quote_id is distinct from old.quote_id then
      perform pg_advisory_xact_lock(hashtext('inmar-quote-sale:' || new.quote_id::text));
      if exists (
        select 1 from public.invoices i
        where i.quote_id = new.quote_id
          and i.id <> new.id
          and (i.status = 'approved' or i.approved_at is not null)
      ) then
        raise exception 'This quote already has an approved invoice';
      end if;
    end if;
    return new;
  end if;

  if new.quote_id is not null then
    perform pg_advisory_xact_lock(hashtext('inmar-quote-sale:' || new.quote_id::text));
    if exists (
      select 1 from public.invoices i
      where i.quote_id = new.quote_id
        and (i.status = 'approved' or i.approved_at is not null)
    ) then
      raise exception 'This quote already has an approved invoice';
    end if;
  end if;
  return new;
end;
$$;

-- 2. Header freeze (A2.6). A void invoice is frozen too; the void step passes.
create or replace function public.invoices_guard_approved_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- VD1: the one allowed change on an approved invoice.
    if coalesce(current_setting('inmar.invoice_void', true), '') = 'on'
       and old.status = 'approved' and new.status = 'void' then
      return new;
    end if;
    -- VD1: a void invoice never changes again.
    if old.status = 'void' then
      raise exception '% is void. This invoice can''t change.',
        coalesce(nullif(btrim(old.number), ''), 'This invoice');
    end if;
    if old.status = 'approved' or old.approved_at is not null then
      raise exception '% is approved. This invoice can''t change.',
        coalesce(nullif(btrim(old.number), ''), 'This invoice');
    end if;
  end if;
  return new;
end;
$$;

-- 3. Line freeze (A2.6). Lines of a void invoice are frozen like approved ones.
create or replace function public.invoice_lines_guard_approved_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_approved_at timestamptz;
  v_number text;
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is null then
      return old;
    end if;
    select i.status, i.approved_at, i.number
      into v_status, v_approved_at, v_number
    from public.invoices i
    where i.id = old.invoice_id;
    if found and (v_status in ('approved', 'void') or v_approved_at is not null) then   -- VD1
      raise exception '% is % This invoice can''t change.',
        coalesce(nullif(btrim(v_number), ''), 'This invoice'),
        case when v_status = 'void' then 'void.' else 'approved.' end;
    end if;
    return old;
  end if;

  if new.invoice_id is not null then
    select i.status, i.approved_at, i.number
      into v_status, v_approved_at, v_number
    from public.invoices i
    where i.id = new.invoice_id;
    if found and (v_status in ('approved', 'void') or v_approved_at is not null) then   -- VD1
      raise exception '% is % This invoice can''t change.',
        coalesce(nullif(btrim(v_number), ''), 'This invoice'),
        case when v_status = 'void' then 'void.' else 'approved.' end;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.invoice_id is distinct from new.invoice_id
     and old.invoice_id is not null then
    select i.status, i.approved_at, i.number
      into v_status, v_approved_at, v_number
    from public.invoices i
    where i.id = old.invoice_id;
    if found and (v_status in ('approved', 'void') or v_approved_at is not null) then   -- VD1
      raise exception '% is % This invoice can''t change.',
        coalesce(nullif(btrim(v_number), ''), 'This invoice'),
        case when v_status = 'void' then 'void.' else 'approved.' end;
    end if;
  end if;

  return new;
end;
$$;

-- 4. Approve entry point (CO1). Adds one refusal: a void invoice is never approved again.
create or replace function public.shop_approve_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_inv public.invoices; v_res jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  -- VD1
  if found and v_inv.status = 'void' then
    raise exception '% is void. It can''t be approved again. Start a new invoice from the quote.',
      coalesce(nullif(btrim(v_inv.number), ''), 'This invoice');
  end if;
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
  -- VD1: name the invoice so the layer trigger records which layers Approve uses.
  perform pg_catalog.set_config('inmar.take_invoice', p_invoice_id::text, true);
  v_res := public.shop_approve_invoice_r1(p_invoice_id);
  perform pg_catalog.set_config('inmar.take_invoice', '', true);
  -- VD1: one marker row per freshly approved invoice (layer_id empty, qty 0).
  if coalesce(v_res ->> 'already_approved', 'false') = 'false' then
    insert into public.invoice_stock_takes (invoice_id, layer_id, inventory_id, qty)
    values (p_invoice_id, null, null, 0);
  end if;
  return v_res;
end;
$$;
revoke all on function public.shop_approve_invoice(uuid) from public, anon;
grant execute on function public.shop_approve_invoice(uuid) to authenticated;

-- 5. The void itself.
create or replace function public.shop_void_invoice(p_invoice_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_who text;
  v_line record;
  v_take record;
  v_part public.inventory%rowtype;
  v_ids uuid[];
  v_returned integer := 0;
  v_voided_at timestamptz;
  v_quote_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Only signed-in staff can void an invoice.';
  end if;
  if p_invoice_id is null then
    raise exception 'Missing invoice';
  end if;

  -- Lock first. A second phone waits here, then sees status void.
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_inv.status = 'void' then
    return jsonb_build_object(
      'ok', true, 'already_void', true,
      'invoice_id', v_inv.id, 'number', v_inv.number, 'status', 'void',
      'voided_at', v_inv.voided_at, 'voided_by', v_inv.voided_by,
      'lines_returned', 0);
  end if;

  if v_inv.status is distinct from 'approved' or v_inv.approved_at is null or v_inv.number is null then
    raise exception 'Only an approved invoice can be voided. A draft just stays a draft.';
  end if;
  if v_reason is null then
    raise exception 'Enter a short reason for the void.';
  end if;
  if pg_catalog.length(v_reason) > 300 then
    raise exception 'Keep the reason to 300 characters or less.';
  end if;

  if v_inv.quote_id is not null then
    perform pg_advisory_xact_lock(hashtext('inmar-quote-sale:' || v_inv.quote_id::text));
  end if;

  -- Approved before cost tracking existed: its layers can't be restored exactly.
  if not exists (select 1 from public.invoice_stock_takes t
                 where t.invoice_id = p_invoice_id and t.layer_id is null) then
    raise exception 'Can''t void %. It was approved before void tracking was added, so its stock can''t go back at its original cost. Nothing was changed.',
      v_inv.number;
  end if;

  -- Every stock line's part must still exist. Checked before anything moves.
  for v_line in
    select l.line_no, l.part_number, l.inventory_id
    from public.invoice_lines l
    where l.invoice_id = p_invoice_id
      and coalesce(l.qty, 0) > 0
      and (l.inventory_id is not null or nullif(pg_catalog.btrim(coalesce(l.part_number, '')), '') is not null)
    order by l.line_no
  loop
    if v_line.inventory_id is null
       or not exists (select 1 from public.inventory i where i.id = v_line.inventory_id) then
      raise exception 'Can''t void %. % is no longer in the parts list, so its stock can''t go back. Nothing was changed.',
        v_inv.number, coalesce(nullif(pg_catalog.btrim(coalesce(v_line.part_number, '')), ''), 'A part');
    end if;
  end loop;

  -- Every cost layer this approval used must still exist.
  for v_take in
    select t.layer_id, t.inventory_id
    from public.invoice_stock_takes t
    where t.invoice_id = p_invoice_id and t.layer_id is not null
  loop
    if not exists (select 1 from public.inventory_cost_layers c where c.id = v_take.layer_id) then
      raise exception 'Can''t void %. The cost record for % is gone, so its stock can''t go back at its original cost. Nothing was changed.',
        v_inv.number,
        coalesce((select i.part_number from public.inventory i where i.id = v_take.inventory_id), 'a part');
    end if;
  end loop;

  begin
    select full_name into v_who from public.profiles where id = auth.uid();
  exception when undefined_table then
    v_who := null;
  end;
  if v_who is null or pg_catalog.btrim(v_who) = '' then
    v_who := coalesce(auth.jwt() ->> 'email', 'signed-in');
  end if;

  -- Lock the shelf rows in id order (same order Approve uses).
  select array_agg(distinct l.inventory_id) into v_ids
  from public.invoice_lines l
  where l.invoice_id = p_invoice_id and l.inventory_id is not null and coalesce(l.qty, 0) > 0;
  perform 1 from public.inventory i where i.id = any(coalesce(v_ids, '{}')) order by i.id for update;

  -- One return per stock line: shelf quantity back, one stock-history row.
  perform pg_catalog.set_config('inmar.qty_write', 'on', true);
  for v_line in
    select l.inventory_id, l.qty
    from public.invoice_lines l
    where l.invoice_id = p_invoice_id
      and l.inventory_id is not null
      and coalesce(l.qty, 0) > 0
    order by l.line_no
  loop
    select * into v_part from public.inventory where id = v_line.inventory_id;
    update public.inventory
       set qty = coalesce(qty, 0) + v_line.qty,
           updated_by = v_who,
           updated_at = now()
     where id = v_line.inventory_id;
    insert into public.inventory_adjustments (
      inventory_id, part_number, name, action, qty_before, qty_after, changed_by, details
    ) values (
      v_line.inventory_id, v_part.part_number, v_part.name, 'stock_in',
      coalesce(v_part.qty, 0), coalesce(v_part.qty, 0) + v_line.qty, v_who,
      'Returned: voided ' || v_inv.number || ' (' || v_reason || ')');
    v_returned := v_returned + 1;
  end loop;
  perform pg_catalog.set_config('inmar.qty_write', 'off', true);

  -- Cost: give each layer back exactly what this approval took, never above its original size.
  update public.inventory_cost_layers c
     set qty_remaining = least(c.qty_original, c.qty_remaining + g.q)
    from (select t.layer_id, sum(t.qty) as q
          from public.invoice_stock_takes t
          where t.invoice_id = p_invoice_id and t.layer_id is not null
          group by t.layer_id) g
   where c.id = g.layer_id;

  perform pg_catalog.set_config('inmar.invoice_void', 'on', true);
  update public.invoices
     set status = 'void',
         approved_at_was = v_inv.approved_at,
         approved_at = null,
         voided_at = now(),
         voided_by = v_who,
         void_reason = v_reason,
         updated_at = now()
   where id = p_invoice_id
   returning voided_at into v_voided_at;
  perform pg_catalog.set_config('inmar.invoice_void', 'off', true);

  -- The quote can be invoiced again. A cancelled quote stays cancelled.
  if v_inv.quote_id is not null then
    update public.quotes
       set status = 'accepted', updated_at = now()
     where id = v_inv.quote_id
       and lower(pg_catalog.btrim(coalesce(status, ''))) not in ('void', 'accepted');
    select status into v_quote_status from public.quotes where id = v_inv.quote_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'already_void', false,
    'invoice_id', p_invoice_id, 'number', v_inv.number, 'status', 'void',
    'voided_at', v_voided_at, 'voided_by', v_who, 'lines_returned', v_returned,
    'quote_status', v_quote_status);
end;
$$;

revoke all on function public.shop_void_invoice(uuid, text) from public, anon;
grant execute on function public.shop_void_invoice(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
