-- BUG-038: a part that is still on an open quote can't be deleted.
-- Open quote = not void, and no approved invoice for it. A draft invoice counts through its quote.
-- One check per DELETE statement, so Clear all inventory lists every blocking quote and deletes nothing.
-- Run once, only after this build is on live Pages and every phone has hard-refreshed. Safe to re-run.
-- Reads only. Changes no rows. Does not touch Approve, shop_commit_qty, RLS, or the freeze / void locks.

create index if not exists quote_lines_inventory_id_idx on public.quote_lines (inventory_id);
create index if not exists invoice_lines_inventory_id_idx on public.invoice_lines (inventory_id);

drop trigger if exists inventory_delete_open_quote on public.inventory;
drop function if exists public.inventory_guard_delete_open_quote();

create or replace function public.inventory_guard_delete_open_quotes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parts integer;
  v_numbers text[];
  v_count integer;
  v_list text;
begin
  with lines as (
    select l.inventory_id, l.quote_id
    from public.quote_lines l
    join old_rows o on o.id = l.inventory_id
    union
    select il.inventory_id, d.quote_id
    from public.invoice_lines il
    join old_rows o on o.id = il.inventory_id
    join public.invoices d on d.id = il.invoice_id
    where d.quote_id is not null and d.approved_at is null and coalesce(d.status, 'draft') = 'draft'
  ), hits as (
    select x.inventory_id as part_id, coalesce(nullif(btrim(q.number), ''), 'without a number') as qnum
    from lines x
    join public.quotes q on q.id = x.quote_id
    where coalesce(q.status, '') <> 'void'
      and not exists (
        select 1 from public.invoices a
        where a.quote_id = q.id and (a.status = 'approved' or a.approved_at is not null))
  )
  select count(distinct part_id), array(select distinct qnum from hits order by qnum)
    into v_parts, v_numbers
  from hits;

  if coalesce(v_parts, 0) = 0 then
    return null;
  end if;

  v_count := array_length(v_numbers, 1);
  v_list := array_to_string(v_numbers[1:10], ', ');
  if v_count > 10 then
    v_list := v_list || ' and ' || (v_count - 10) || ' more';
  end if;

  if v_parts = 1 and v_count = 1 then
    raise exception 'Not deleted. This part is on open quote %. Remove it from that quote first.', v_list;
  elsif v_parts = 1 then
    raise exception 'Not deleted. This part is on open quotes %. Remove it from those quotes first.', v_list;
  elsif v_count = 1 then
    raise exception 'Not deleted. % parts are on open quote %. Remove them from that quote first.', v_parts, v_list;
  else
    raise exception 'Not deleted. % parts are on open quotes %. Remove them from those quotes first.', v_parts, v_list;
  end if;
end;
$$;

drop trigger if exists inventory_delete_open_quotes on public.inventory;
create trigger inventory_delete_open_quotes
  after delete on public.inventory
  referencing old table as old_rows
  for each statement execute function public.inventory_guard_delete_open_quotes();
