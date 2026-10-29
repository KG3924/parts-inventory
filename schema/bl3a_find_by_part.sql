-- BL3a: part search in Find Quotes and Find Invoices.
-- Run once in the Supabase SQL editor, only after this build is on live Pages and every phone has hard-refreshed.
-- Safe to re-run. Reads only: adds one function. Changes no rows, tables, policies or other functions.
-- No customer data in this file.

begin;

-- Quotes or invoices that have a line whose part number or name holds the typed part.
-- Punctuation-blind: "ab-123", "AB 123" and "ab123" all find AB-123 (lowercase, letters and digits only, both sides).
-- The typed text is plain text, never a pattern. Fewer than 2 letters or digits finds nothing.
-- Same documents and day rules as Find today: cancelled quotes and draft invoices (no number yet) included;
-- quote day = created, else quote date, else updated; invoice day = approved (if approved), else invoice date;
-- days are Chicago days. With no dates, every quote or invoice counts. Newest first, 50 at most,
-- more = true when over 50. Security invoker: the caller's row security still applies.
create or replace function public.shop_find_docs_by_part(p_kind text, p_q text, p_from date default null, p_to date default null)
returns table (id uuid, more boolean)
language sql stable security invoker set search_path = ''
as $$
  with k as (
    select pg_catalog.lower(pg_catalog.regexp_replace(coalesce(p_q, ''), '[^[:alnum:]]', '', 'g')) as q,
           least(coalesce(p_from, p_to), coalesce(p_to, p_from)) as d0,
           greatest(coalesce(p_from, p_to), coalesce(p_to, p_from)) as d1
  ),
  lines as (
    select l.quote_id as doc_id, l.part_number, l.name from public.quote_lines l where p_kind = 'quote'
    union all
    select l.invoice_id, l.part_number, l.name from public.invoice_lines l where p_kind = 'invoice'
  ),
  matched as (
    select distinct m.doc_id
    from lines m, k
    where pg_catalog.length(k.q) >= 2
      and (pg_catalog.strpos(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(m.part_number, ''), '[^[:alnum:]]', '', 'g')), k.q) > 0
        or pg_catalog.strpos(pg_catalog.lower(pg_catalog.regexp_replace(coalesce(m.name, ''), '[^[:alnum:]]', '', 'g')), k.q) > 0)
  ),
  docs as (
    select q.id,
           coalesce((q.created_at at time zone 'America/Chicago')::date, q.quote_date,
                    (q.updated_at at time zone 'America/Chicago')::date) as day,
           coalesce(q.created_at, q.updated_at) as stamp
    from public.quotes q
    where p_kind = 'quote' and q.id in (select m.doc_id from matched m)
    union all
    select i.id,
           case when i.status = 'approved' and i.approved_at is not null
                then (i.approved_at at time zone 'America/Chicago')::date else i.invoice_date end,
           coalesce(i.approved_at, i.created_at)
    from public.invoices i
    where p_kind = 'invoice' and i.id in (select m.doc_id from matched m)
  ),
  picked as (
    select d.id, pg_catalog.row_number() over (order by d.day desc nulls last, d.stamp desc nulls last, d.id) as n
    from docs d, k
    where case when k.d0 is null then (p_kind = 'invoice' or d.day is not null)
               else d.day between k.d0 and k.d1 end
    order by n
    limit 51
  )
  select p.id, (select pg_catalog.count(*) from picked) > 50
  from picked p
  where p.n <= 50
  order by p.n
$$;

revoke all on function public.shop_find_docs_by_part(text, text, date, date) from public, anon;
grant execute on function public.shop_find_docs_by_part(text, text, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
