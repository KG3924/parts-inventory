-- =============================================================================
-- A2.4b — Void is final. A void quote cannot be edited.
--
-- DO NOT RUN until this app build is on live Pages and every phone has
-- hard-refreshed. Order:
--   1. Merge, and wait until GitHub Pages is serving this build.
--   2. Hard-refresh every phone.
--   3. Then run this file once in the Supabase SQL editor.
--   4. Smoke. A grey Save button alone is not the lock. Pass is an UPDATE
--      of that void quote, with the session jwt sub set to a profile,
--      raising the sentence below.
--
-- Safe to re-run. Does not delete quotes, lines, or invoices.
-- Does not void a draft invoice and does not change shop_approve_invoice.
-- The Approve refuse from schema/a2_4_void_quote_approve_lock.sql stays.
--
-- Once quotes.status is void, any later UPDATE of that row raises:
--   "Q-… is void. Start a new quote to bring this deal back."
-- The number is the quote number. A blank number uses "This quote".
-- The UPDATE that first sets status to void still succeeds.
-- quote_lines INSERT, UPDATE, and DELETE raise the same sentence when the
-- parent quote is void, including an UPDATE that moves a line off a void quote.
-- A line whose parent row is missing is left alone.
--
-- The screen writes lines before it seals status = void, so this lock does
-- not reject that first Void save.
-- =============================================================================

create or replace function public.quotes_guard_void_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'void' then
    raise exception '% is void. Start a new quote to bring this deal back.',
      coalesce(nullif(btrim(old.number), ''), 'This quote');
  end if;
  return new;
end;
$$;

-- Reads public.quotes, so this is security definer: a row the caller's RLS
-- cannot see must not slip past the lock. It only raises or returns the row.
-- Execute is revoked below. It does not check auth.uid() because the sentence
-- above is the error for every update that reaches a void quote.
create or replace function public.quote_lines_guard_void_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_id uuid;
  v_status text;
  v_number text;
begin
  if tg_op = 'DELETE' then
    v_quote_id := old.quote_id;
  else
    v_quote_id := new.quote_id;
  end if;

  if v_quote_id is not null then
    select q.status, q.number into v_status, v_number
    from public.quotes q
    where q.id = v_quote_id;
    if v_status = 'void' then
      raise exception '% is void. Start a new quote to bring this deal back.',
        coalesce(nullif(btrim(v_number), ''), 'This quote');
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.quote_id is distinct from new.quote_id
     and old.quote_id is not null then
    select q.status, q.number into v_status, v_number
    from public.quotes q
    where q.id = old.quote_id;
    if v_status = 'void' then
      raise exception '% is void. Start a new quote to bring this deal back.',
        coalesce(nullif(btrim(v_number), ''), 'This quote');
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.quotes_guard_void_final() from public, anon, authenticated;
revoke all on function public.quote_lines_guard_void_final() from public, anon, authenticated;

drop trigger if exists quotes_void_final on public.quotes;
create trigger quotes_void_final
  before update on public.quotes
  for each row
  execute function public.quotes_guard_void_final();

drop trigger if exists quote_lines_void_final on public.quote_lines;
create trigger quote_lines_void_final
  before insert or update or delete on public.quote_lines
  for each row
  execute function public.quote_lines_guard_void_final();

notify pgrst, 'reload schema';
