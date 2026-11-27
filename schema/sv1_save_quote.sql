-- =============================================================================
-- SV1 — Save an existing quote in one step.
--
-- DO NOT RUN until this build is on Pages and every phone has
-- hard-refreshed. Order:
--   1. Merge, and wait until GitHub Pages is serving this build.
--   2. Hard-refresh every phone.
--   3. Then run this file once in the Supabase SQL editor. Safe to re-run.
--   4. Then run the checks.
--
-- The merge does not apply this SQL. Until it is run, Save on an existing
-- quote keeps today's order: replace the lines, then write the header.
--
-- Assumes every file README lists before this one has already been run,
-- including schema/cl2_customer_carry.sql and schema/ql1_lock_quote_lines.sql.
--
-- Touches one function: public.shop_save_quote(uuid, jsonb, jsonb).
-- An existing quote's lines are deleted and inserted, then the header is
-- updated, in that order, in this one call. Any error rolls the whole call
-- back. Lines are written before the header so a save that seals a quote
-- void still writes lines while the quote is not void.
--
-- Does not add a table, column, RLS policy, or trigger.
-- Does not change shop_save_new_quote, shop_approve_invoice,
-- shop_void_invoice, QL1's guard, or a2_4b.
-- Does not delete or re-insert the quote row. id, number, company, and
-- created_at are never written from the payload. Columns the client does
-- not send keep their value. Keys that are not columns are ignored.
-- Takes pg_advisory_xact_lock(hashtext('inmar-quote-sale:' || quote id)),
-- the same lock as Approve, VD1, and QL1, so a Save and an Approve on the
-- same quote run one after the other.
-- =============================================================================

create or replace function public.shop_save_quote(p_quote_id uuid, p_quote jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_set text;
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if p_lines is null
     or pg_catalog.jsonb_typeof(p_lines) <> 'array'
     or pg_catalog.jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line before saving';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_populate_recordset(null::public.quote_lines, p_lines) l
    where l.inventory_id is not null
      and not exists (select 1 from public.inventory i where i.id = l.inventory_id)
  ) then
    raise exception 'A line points at a part that is no longer on the shelf list. The quote was not saved.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('inmar-quote-sale:' || p_quote_id::text));

  select q.id into v_id
  from public.quotes q
  where q.id = p_quote_id
  for update;
  if not found then
    raise exception 'This quote is missing. It was not saved.';
  end if;

  -- Lines first, then the header. Sealing status void has to write lines
  -- while the quote is not void yet, or a2_4b refuses them.
  delete from public.quote_lines where quote_id = p_quote_id;
  insert into public.quote_lines (quote_id, line_no, inventory_id, part_number, name, qty, unit_price)
    select p_quote_id, coalesce(l.line_no, 1), l.inventory_id, l.part_number, coalesce(l.name, 'Item'),
           coalesce(l.qty, 1), coalesce(l.unit_price, 0)
    from pg_catalog.jsonb_populate_recordset(null::public.quote_lines, p_lines) l;

  select pg_catalog.string_agg(pg_catalog.format('%I = r.%I', a.attname, a.attname), ', ' order by a.attnum)
    into v_set
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.quotes'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attname not in ('id', 'number', 'company', 'created_at')
    and pg_catalog.jsonb_exists(p_quote, a.attname);

  if v_set is not null and v_set <> '' then
    execute pg_catalog.format(
      'update public.quotes q set %s from pg_catalog.jsonb_populate_record(null::public.quotes, $1) r where q.id = $2',
      v_set
    ) using p_quote, p_quote_id;
  end if;

  select pg_catalog.jsonb_build_object('id', q.id, 'number', q.number, 'status', q.status)
    into v_out
  from public.quotes q
  where q.id = p_quote_id;
  return v_out;
end;
$$;

revoke all on function public.shop_save_quote(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.shop_save_quote(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
