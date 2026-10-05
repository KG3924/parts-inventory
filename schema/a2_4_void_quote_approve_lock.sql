-- =============================================================================
-- A2.4 — Refuse Approve when the quote is void, or the quote row is missing.
--
-- DO NOT RUN until this app build is on live Pages and every phone has
-- hard-refreshed. Order:
--   1. Merge, and wait until GitHub Pages is serving this build.
--   2. Hard-refresh every phone.
--   3. Then run this file once in the Supabase SQL editor.
--   4. Smoke. Draft invoices on a void quote stay drafts.
--
-- Requires schema/a2_approve_invoice.sql already applied (approved_at column
-- and shop_approve_invoice). This file replaces that function only.
-- Safe to re-run. Does not delete inventory, quotes, or invoices.
-- Does not void a draft invoice and does not change the shelf on a refuse.
-- A void quote raises before any debit: "Q-… is void. This invoice can't be approved."
-- A missing quote row, when quote_id is set, raises the same way.
-- Already-approved, one approved invoice per quote, and short-shelf behavior stay.
-- schema/a2_approve_invoice.sql carries this same function, so re-running that
-- file does not drop this refuse.
-- =============================================================================

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
    'lines_debited', v_debited
  );
end;
$$;

revoke all on function public.shop_approve_invoice(uuid) from public, anon;
grant execute on function public.shop_approve_invoice(uuid) to authenticated;

notify pgrst, 'reload schema';
