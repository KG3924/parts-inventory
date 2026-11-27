-- =============================================================================
-- QL1 — Lock quote lines once an invoice is approved.
--
-- DO NOT RUN until this build is on Pages and every phone has
-- hard-refreshed. Order:
--   1. Merge, and wait until GitHub Pages is serving this build.
--   2. Hard-refresh every phone.
--   3. Then run this file once in the Supabase SQL editor. Safe to re-run.
--   4. Then run the checks.
--
-- Touches public.quote_lines only: one trigger function, BEFORE INSERT OR
-- UPDATE OR DELETE, FOR EACH ROW. A quote is locked when any invoice for it
-- has status = 'approved' or approved_at is not null (the same test as
-- invoices_one_approved_per_quote and VD1). The row is refused with:
--   "Q-… has approved invoice I-…. Its lines can't change. Void the invoice first to change them."
-- The numbers are that quote's number and that invoice's number. A blank
-- quote number uses "This quote".
-- An UPDATE checks the old quote_id and the new quote_id. Before the check,
-- the guard takes pg_advisory_xact_lock(hashtext('inmar-quote-sale:' || quote_id)),
-- the same lock VD1 and Approve take. A move locks both quote ids, lower id
-- first, so two edits can't deadlock.
--
-- Does not add a quotes trigger. Does not change RLS.
-- Does not change shop_approve_invoice, shop_void_invoice, or shop_save_new_quote.
-- Does not read approved_at_was. After shop_void_invoice moves approved_at
-- onto approved_at_was and sets status 'void', the quote has no approved
-- invoice, so its lines can be edited again.
-- Line DELETE is allowed when the parent quote row is already gone, or when
-- a2_4b's transaction-local flag inmar.wipe_<quote id without dashes> is
-- 'on' (the same rule as quote_lines_void_final). Whatever deleting a quote
-- does today, it keeps doing.
-- Does not change schema/co1_cutover_reset.sql. That file runs
-- `disable trigger user` before it deletes, so this guard is not fired.
--
-- Trigger name quote_lines_wlock_approved sorts after quote_lines_void_final.
-- Postgres fires same-event BEFORE triggers in name order, so a void quote
-- still raises a2_4b's "is void" sentence. This guard does not replace it.
-- =============================================================================

create or replace function public.quote_lines_guard_wlock_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_ids uuid[] := array[]::uuid[];
  v_check_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_number text;
  v_invoice text;
  v_wipe text;
begin
  if tg_op = 'DELETE' then
    if old.quote_id is not null then
      v_lock_ids := array[old.quote_id];
    end if;
  elsif tg_op = 'UPDATE'
        and old.quote_id is not null
        and new.quote_id is not null
        and old.quote_id is distinct from new.quote_id then
    if old.quote_id < new.quote_id then
      v_lock_ids := array[old.quote_id, new.quote_id];
    else
      v_lock_ids := array[new.quote_id, old.quote_id];
    end if;
    v_check_ids := array[new.quote_id, old.quote_id];
  elsif tg_op = 'UPDATE' then
    v_id := coalesce(new.quote_id, old.quote_id);
    if v_id is not null then
      v_lock_ids := array[v_id];
      v_check_ids := array[v_id];
    end if;
  elsif new.quote_id is not null then
    v_lock_ids := array[new.quote_id];
    v_check_ids := array[new.quote_id];
  end if;

  foreach v_id in array v_lock_ids loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('inmar-quote-sale:' || v_id::text));
  end loop;

  if tg_op = 'DELETE' then
    if old.quote_id is null then
      return old;
    end if;
    perform 1 from public.quotes q where q.id = old.quote_id;
    if not found then
      return old;
    end if;
    v_wipe := pg_catalog.current_setting(
      'inmar.wipe_' || pg_catalog.replace(old.quote_id::text, '-', ''), true);
    if coalesce(v_wipe, '') = 'on' then
      return old;
    end if;
    v_check_ids := array[old.quote_id];
  end if;

  foreach v_id in array v_check_ids loop
    select q.number into v_number from public.quotes q where q.id = v_id;
    if not found then
      continue;
    end if;
    select i.number into v_invoice
    from public.invoices i
    where i.quote_id = v_id
      and (i.status = 'approved' or i.approved_at is not null)
    order by i.approved_at desc nulls last, i.id
    limit 1;
    if found then
      raise exception '% has approved invoice %. Its lines can''t change. Void the invoice first to change them.',
        coalesce(nullif(pg_catalog.btrim(v_number), ''), 'This quote'),
        coalesce(nullif(pg_catalog.btrim(v_invoice), ''), 'This invoice');
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.quote_lines_guard_wlock_approved() from public, anon, authenticated;

-- Sorts after quote_lines_void_final so a void quote raises a2_4b's sentence.
drop trigger if exists quote_lines_wlock_approved on public.quote_lines;
create trigger quote_lines_wlock_approved
  before insert or update or delete on public.quote_lines
  for each row
  execute function public.quote_lines_guard_wlock_approved();

notify pgrst, 'reload schema';
