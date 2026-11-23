-- =============================================================================
-- ARCHIVE V1 - read-only search over the old Logs site's quotes and invoices.
--
-- DO NOT RUN until this build is on live Pages and every phone has
-- hard-refreshed. Order:
--   1. Merge, and wait until GitHub Pages is green.
--   2. Hard-refresh every phone.
--   3. Run this file once in the Supabase SQL editor. Safe to re-run.
--   4. Then run the checks.
--
-- No records and no customer data in this file. Tables are created empty.
-- The records are loaded later in a separate step outside the repo.
--
-- What it adds:
--   - Schema "archive" with 14 tables: per company (sys_ = In-Mar Systems,
--     sol_ = In-Mar Solutions) one table per old table. Every old column is
--     kept as raw text under its own name. Typed dates, amounts, ids and the
--     search keys are GENERATED from that text, so a load writes only
--     old_id, the raw columns and snapshot_date.
--   - old_id is the old site's row id, the primary key, and the load's
--     upsert key (insert ... on conflict (old_id) do update).
--   - Row security on every table. One read-only policy per table: a signed-in
--     staff member (a row in public.profiles). No insert/update/delete policy
--     and no write grant to anyone the browser can be.
--   - anon and public get nothing: no schema usage, no table grant, no
--     function execute.
--   - The "archive" schema is NOT added to the API's exposed schemas. The page
--     reaches the data only through three public functions:
--       public.archive_list    - search / hull / serial / customer lists,
--                                50 rows a page, fixed on the server
--       public.archive_record  - one record, lookups resolved to names
--       public.archive_lookups - the lookup lists and the Solutions customers
--     All three are SECURITY INVOKER: the caller's grants and row security
--     still apply, so a bug in a function cannot show more than the caller
--     could already read. Each refuses a caller with no auth.uid() or no
--     profiles row. Static SQL only; the typed text is a value, never SQL.
-- =============================================================================
begin;
create extension if not exists pg_trgm with schema extensions;
create schema if not exists archive;
-- ---------------------------------------------------------------------------
-- Key helpers (immutable, so generated columns can use them).
-- ---------------------------------------------------------------------------
-- Numbers: upper case, spaces and dashes removed. "ab-12 3" -> "AB123".
create or replace function archive.num_key(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select nullif(pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p, ''), '[[:space:]\u00a0-]+', '', 'g')), '') $$;
-- Names: lower case, outer spaces trimmed, inner runs of spaces made one.
create or replace function archive.name_key(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select nullif(pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p, ''), '[[:space:]\u00a0]+', ' ', 'g'))), '') $$;
-- 'YYYY-MM-DD' -> date. Anything else -> null (raw text is still kept).
create or replace function archive.to_day(p text)
returns date language sql immutable parallel safe set search_path = ''
as $$
  select case when p ~ '^\d{4}-\d{2}-\d{2}$'
               and pg_catalog.substr(p, 6, 2)::int between 1 and 12
               and pg_catalog.substr(p, 9, 2)::int between 1 and 31
              then pg_catalog.make_date(pg_catalog.substr(p, 1, 4)::int, pg_catalog.substr(p, 6, 2)::int, 1)
                   + (pg_catalog.substr(p, 9, 2)::int - 1)
         end
$$;
-- '-1234.5' -> numeric. Anything else -> null.
create or replace function archive.to_num(p text)
returns numeric language sql immutable parallel safe set search_path = ''
as $$ select case when pg_catalog.btrim(p) ~ '^-?\d{1,12}(\.\d{1,4})?$' then pg_catalog.btrim(p)::numeric end $$;
-- '12' -> 12. Anything else -> null.
create or replace function archive.to_int(p text)
returns integer language sql immutable parallel safe set search_path = ''
as $$ select case when pg_catalog.btrim(p) ~ '^\d{1,9}$' then pg_catalog.btrim(p)::integer end $$;
-- ---------------------------------------------------------------------------
-- Quotes (same columns in both companies)
-- ---------------------------------------------------------------------------
create table if not exists archive.sys_quotes (
  old_id              integer primary key,          -- QuoteId
  quote_number        text,                         -- QuoteNumber
  quote_date          text,                         -- Date
  customer            text,                         -- Customer
  contact             text,                         -- Contact
  project             text,                         -- Project
  manufacturer        text,                         -- Manufacturer
  part_number         text,                         -- PartNumber
  mfg_drawing_no      text,                         -- MfgDrawingNo
  quoted_by           text,                         -- QuotedBy (plain text in the old site)
  payment_terms       text,                         -- PaymentTerms
  customer_po         text,                         -- CustomerPO
  vendor_order_number text,                         -- VendorOrderNumber
  snapshot_date       date not null,
  quote_day           date generated always as (archive.to_day(quote_date)) stored,
  quote_number_key    text generated always as (archive.num_key(quote_number)) stored,
  part_number_key     text generated always as (archive.num_key(part_number)) stored,
  mfg_drawing_no_key  text generated always as (archive.num_key(mfg_drawing_no)) stored,
  customer_po_key     text generated always as (archive.num_key(customer_po)) stored,
  project_key         text generated always as (archive.num_key(project)) stored,
  customer_key        text generated always as (archive.name_key(customer)) stored,
  search_key          text generated always as (
    coalesce(archive.num_key(quote_number), '') || '|' || coalesce(archive.num_key(customer), '') || '|' ||
    coalesce(archive.num_key(project), '') || '|' || coalesce(archive.num_key(manufacturer), '') || '|' ||
    coalesce(archive.num_key(part_number), '') || '|' || coalesce(archive.num_key(mfg_drawing_no), '') || '|' ||
    coalesce(archive.num_key(customer_po), '')) stored
);
create table if not exists archive.sol_quotes (
  like archive.sys_quotes including defaults including generated including comments,
  primary key (old_id)
);
-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create table if not exists archive.sys_invoices (
  old_id             integer primary key,           -- InvoiceID
  invoice_number     text,                          -- InvoiceNumber
  invoice_date       text,                          -- InvoiceDate
  customer           text,                          -- Customer
  po_number          text,                          -- PONumber
  project            text,                          -- Project
  invoice_amount     text,                          -- InvoiceAmount
  date_received      text,                          -- DateReceived
  payment_type       text,                          -- PaymentType (plain text in the old site)
  vendor             text,                          -- Vendor (id into sys_vendors)
  serial_number      text,                          -- SerialNumber
  snapshot_date      date not null,
  invoice_day        date    generated always as (archive.to_day(invoice_date)) stored,
  date_received_day  date    generated always as (archive.to_day(date_received)) stored,
  invoice_amount_num numeric generated always as (archive.to_num(invoice_amount)) stored,
  vendor_id          integer generated always as (archive.to_int(vendor)) stored,
  invoice_number_key text    generated always as (archive.num_key(invoice_number)) stored,
  po_number_key      text    generated always as (archive.num_key(po_number)) stored,
  serial_number_key  text    generated always as (archive.num_key(serial_number)) stored,
  project_key        text    generated always as (archive.num_key(project)) stored,
  customer_key       text    generated always as (archive.name_key(customer)) stored,
  search_key         text    generated always as (
    coalesce(archive.num_key(invoice_number), '') || '|' || coalesce(archive.num_key(customer), '') || '|' ||
    coalesce(archive.num_key(project), '') || '|' || coalesce(archive.num_key(po_number), '') || '|' ||
    coalesce(archive.num_key(serial_number), '')) stored
);
create table if not exists archive.sol_invoices (
  old_id             integer primary key,           -- InvoiceID
  invoice_number     text,                          -- InvoiceNumber
  invoice_date       text,                          -- InvoiceDate
  customer           text,                          -- Customer
  po_number          text,                          -- PONumber
  project            text,                          -- Project
  location           text,                          -- Location
  goods_amount       text,                          -- GoodsAmount
  sh_amount          text,                          -- SHAmount
  service_charge     text,                          -- ServiceCharge
  total_amount       text,                          -- TotalAmount
  tax_amount         text,                          -- TaxAmount
  date_received      text,                          -- DateReceived
  payment_type       text,                          -- PaymentType (plain text in the old site)
  vendor             text,                          -- Vendor (id into sol_vendors)
  serial_number      text,                          -- SerialNumber
  industry           text,                          -- Industry (id into sol_industries)
  comments           text,                          -- Comments (free text; shown as plain text only)
  payment_id         text,                          -- PaymentID (a payment/batch reference, not a lookup id)
  deposit_amount     text,                          -- DepositAmount
  sundry             text,                          -- Sundry
  snapshot_date      date not null,
  invoice_day        date    generated always as (archive.to_day(invoice_date)) stored,
  date_received_day  date    generated always as (archive.to_day(date_received)) stored,
  goods_amount_num   numeric generated always as (archive.to_num(goods_amount)) stored,
  sh_amount_num      numeric generated always as (archive.to_num(sh_amount)) stored,
  service_charge_num numeric generated always as (archive.to_num(service_charge)) stored,
  total_amount_num   numeric generated always as (archive.to_num(total_amount)) stored,
  tax_amount_num     numeric generated always as (archive.to_num(tax_amount)) stored,
  deposit_amount_num numeric generated always as (archive.to_num(deposit_amount)) stored,
  vendor_id          integer generated always as (archive.to_int(vendor)) stored,
  industry_id        integer generated always as (archive.to_int(industry)) stored,
  invoice_number_key text    generated always as (archive.num_key(invoice_number)) stored,
  po_number_key      text    generated always as (archive.num_key(po_number)) stored,
  serial_number_key  text    generated always as (archive.num_key(serial_number)) stored,
  project_key        text    generated always as (archive.num_key(project)) stored,
  customer_key       text    generated always as (archive.name_key(customer)) stored,
  search_key         text    generated always as (
    coalesce(archive.num_key(invoice_number), '') || '|' || coalesce(archive.num_key(customer), '') || '|' ||
    coalesce(archive.num_key(project), '') || '|' || coalesce(archive.num_key(po_number), '') || '|' ||
    coalesce(archive.num_key(serial_number), '')) stored
);
-- ---------------------------------------------------------------------------
-- Solutions customer list and the lookups (id + name)
-- ---------------------------------------------------------------------------
create table if not exists archive.sol_customers (
  old_id                         integer primary key,  -- id
  name                           text,                 -- name
  tax_certificate_expiration     text,                 -- TaxCertificateExpiration
  snapshot_date                  date not null,
  tax_certificate_expiration_day date generated always as (archive.to_day(tax_certificate_expiration)) stored,
  name_key                       text generated always as (archive.name_key(name)) stored
);
create table if not exists archive.sys_vendors       (old_id integer primary key, vendor text,         snapshot_date date not null); -- VendorID, Vendor
create table if not exists archive.sys_payment_types (old_id integer primary key, payment_type text,   snapshot_date date not null); -- PaymentID, PaymentType
create table if not exists archive.sys_quoted_by     (old_id integer primary key, quoted_by_name text, snapshot_date date not null); -- QuotedByID, QuotedByName
create table if not exists archive.sys_companies     (old_id integer primary key, company_name text,   snapshot_date date not null); -- CompanyId, CompanyName
create table if not exists archive.sol_vendors       (old_id integer primary key, vendor text,         snapshot_date date not null);
create table if not exists archive.sol_payment_types (old_id integer primary key, payment_type text,   snapshot_date date not null);
create table if not exists archive.sol_quoted_by     (old_id integer primary key, quoted_by_name text, snapshot_date date not null);
create table if not exists archive.sol_companies     (old_id integer primary key, company_name text,   snapshot_date date not null);
create table if not exists archive.sol_industries    (old_id integer primary key, name text,           snapshot_date date not null); -- ID, Name
-- ---------------------------------------------------------------------------
-- Indexes (search is a contains-match on search_key; trigram makes it fast)
-- ---------------------------------------------------------------------------
create index if not exists sys_quotes_search_trgm   on archive.sys_quotes   using gin (search_key extensions.gin_trgm_ops);
create index if not exists sol_quotes_search_trgm   on archive.sol_quotes   using gin (search_key extensions.gin_trgm_ops);
create index if not exists sys_invoices_search_trgm on archive.sys_invoices using gin (search_key extensions.gin_trgm_ops);
create index if not exists sol_invoices_search_trgm on archive.sol_invoices using gin (search_key extensions.gin_trgm_ops);
create index if not exists sys_quotes_day     on archive.sys_quotes   (quote_day desc, old_id desc);
create index if not exists sol_quotes_day     on archive.sol_quotes   (quote_day desc, old_id desc);
create index if not exists sys_invoices_day   on archive.sys_invoices (invoice_day desc, old_id desc);
create index if not exists sol_invoices_day   on archive.sol_invoices (invoice_day desc, old_id desc);
create index if not exists sys_quotes_project   on archive.sys_quotes   (project_key);
create index if not exists sol_quotes_project   on archive.sol_quotes   (project_key);
create index if not exists sys_invoices_project on archive.sys_invoices (project_key);
create index if not exists sol_invoices_project on archive.sol_invoices (project_key);
create index if not exists sys_invoices_serial  on archive.sys_invoices (serial_number_key);
create index if not exists sol_invoices_serial  on archive.sol_invoices (serial_number_key);
create index if not exists sys_quotes_customer   on archive.sys_quotes   (customer_key);
create index if not exists sol_quotes_customer   on archive.sol_quotes   (customer_key);
create index if not exists sys_invoices_customer on archive.sys_invoices (customer_key);
create index if not exists sol_invoices_customer on archive.sol_invoices (customer_key);
create index if not exists sol_customers_name    on archive.sol_customers (name_key);
-- ---------------------------------------------------------------------------
-- Who may read: a signed-in staff member. Read only.
-- ---------------------------------------------------------------------------
revoke all on schema archive from public, anon, authenticated;
revoke all on all tables    in schema archive from public, anon, authenticated;
revoke all on all sequences in schema archive from public, anon, authenticated;
revoke all on all functions in schema archive from public, anon, authenticated;
grant usage on schema archive to authenticated;
grant select on all tables in schema archive to authenticated;
-- Generated columns call these helpers, and so do the functions below.
grant execute on function archive.num_key(text), archive.name_key(text), archive.to_day(text),
                          archive.to_num(text), archive.to_int(text) to authenticated;
do $$
declare t text;
begin
  foreach t in array array[
    'sys_quotes','sys_invoices','sys_vendors','sys_payment_types','sys_quoted_by','sys_companies',
    'sol_quotes','sol_invoices','sol_customers','sol_vendors','sol_payment_types','sol_quoted_by','sol_companies','sol_industries'
  ]
  loop
    execute format('alter table archive.%I enable row level security', t);
    execute format('drop policy if exists "staff read %1$s" on archive.%1$I', t);
    execute format('create policy "staff read %1$s" on archive.%1$I for select to authenticated '
                   'using (exists (select 1 from public.profiles p where p.id = (select auth.uid())))', t);
  end loop;
end $$;
-- ---------------------------------------------------------------------------
-- archive_list: the one list behind search, hull history, serial history and
-- the customer view. 50 rows a page, always (no size parameter).
--   p_company : 'systems' | 'solutions'  (one company per call; never mixed)
--   p_mode    : 'search'   contains-match on quote #, invoice #, customer,
--                          project/hull, manufacturer, part #, drawing #,
--                          serial #, PO # (dashes, spaces, case ignored)
--               'hull'     every quote and invoice whose project is this hull
--               'serial'   every invoice with this serial (quotes have none)
--               'customer' every quote and invoice for this customer name
--   p_kind    : 'all' | 'quote' | 'invoice'
--   p_from/p_to : optional date range (records with no date drop out)
--   p_page    : 1, 2, 3 ...
-- Empty text returns no rows. Search and customer are newest first; hull and
-- serial history are oldest first. total = rows matched over all pages.
-- ---------------------------------------------------------------------------
create or replace function public.archive_list(
  p_company text, p_mode text, p_q text,
  p_kind text default 'all', p_from date default null, p_to date default null, p_page integer default 1)
returns table (kind text, old_id integer, doc_number text, day date, customer text, project text,
               item text, serial_number text, amount numeric, total bigint)
language plpgsql stable security invoker set search_path = ''
as $$
#variable_conflict use_column
declare
  v_mode text := coalesce(p_mode, '');
  v_kind text := coalesce(nullif(p_kind, ''), 'all');
  v_num  text := archive.num_key(p_q);
  v_name text := archive.name_key(p_q);
  v_like text;
  v_d0   date := least(coalesce(p_from, p_to), coalesce(p_to, p_from));
  v_d1   date := greatest(coalesce(p_from, p_to), coalesce(p_to, p_from));
  v_off  integer := (least(greatest(coalesce(p_page, 1), 1), 10000) - 1) * 50;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Only signed-in staff can open the archive.';
  end if;
  if p_company not in ('systems', 'solutions') then raise exception 'Pick In-Mar Systems or In-Mar Solutions.'; end if;
  if v_mode not in ('search', 'hull', 'serial', 'customer') then raise exception 'Unknown list'; end if;
  if v_kind not in ('all', 'quote', 'invoice') then raise exception 'Unknown record type'; end if;
  if v_num is null then return; end if;  -- empty search shows nothing
  -- The typed text is a value. LIKE wildcards in it are made literal.
  v_like := '%' || replace(replace(replace(replace(v_num, '|', ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  with hits as (
    select 'quote'::text as kind, q.old_id, q.quote_number as doc_number, q.quote_day as day, q.customer, q.project,
           q.part_number as item, null::text as serial_number, null::numeric as amount
    from archive.sys_quotes q
    where p_company = 'systems' and v_kind in ('all', 'quote') and v_mode <> 'serial'
      and ((v_mode = 'search' and q.search_key like v_like)
        or (v_mode = 'hull' and q.project_key = v_num)
        or (v_mode = 'customer' and q.customer_key = v_name))
    union all
    select 'invoice', i.old_id, i.invoice_number, i.invoice_day, i.customer, i.project,
           null, i.serial_number, i.invoice_amount_num
    from archive.sys_invoices i
    where p_company = 'systems' and v_kind in ('all', 'invoice')
      and ((v_mode = 'search' and i.search_key like v_like)
        or (v_mode = 'hull' and i.project_key = v_num)
        or (v_mode = 'serial' and i.serial_number_key = v_num)
        or (v_mode = 'customer' and i.customer_key = v_name))
    union all
    select 'quote', q.old_id, q.quote_number, q.quote_day, q.customer, q.project,
           q.part_number, null, null
    from archive.sol_quotes q
    where p_company = 'solutions' and v_kind in ('all', 'quote') and v_mode <> 'serial'
      and ((v_mode = 'search' and q.search_key like v_like)
        or (v_mode = 'hull' and q.project_key = v_num)
        or (v_mode = 'customer' and q.customer_key = v_name))
    union all
    select 'invoice', i.old_id, i.invoice_number, i.invoice_day, i.customer, i.project,
           null, i.serial_number, i.total_amount_num
    from archive.sol_invoices i
    where p_company = 'solutions' and v_kind in ('all', 'invoice')
      and ((v_mode = 'search' and i.search_key like v_like)
        or (v_mode = 'hull' and i.project_key = v_num)
        or (v_mode = 'serial' and i.serial_number_key = v_num)
        or (v_mode = 'customer' and i.customer_key = v_name))
  ),
  dated as (
    select h.* from hits h
    where v_d0 is null or h.day between v_d0 and v_d1
  )
  select d.kind, d.old_id, d.doc_number, d.day, d.customer, d.project, d.item, d.serial_number, d.amount,
         count(*) over () as total
  from dated d
  order by
    case when v_mode in ('hull', 'serial') then d.day end asc nulls last,
    case when v_mode not in ('hull', 'serial') then d.day end desc nulls last,
    d.kind, d.old_id desc
  offset v_off
  limit 50;
end;
$$;
-- ---------------------------------------------------------------------------
-- archive_record: one record, every column, lookups resolved to names.
-- Returns null when there is no such record.
-- ---------------------------------------------------------------------------
create or replace function public.archive_record(p_company text, p_kind text, p_old_id integer)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare v jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Only signed-in staff can open the archive.';
  end if;
  if p_company = 'systems' and p_kind = 'quote' then
    select to_jsonb(q) - 'search_key' into v from archive.sys_quotes q where q.old_id = p_old_id;
  elsif p_company = 'solutions' and p_kind = 'quote' then
    select to_jsonb(q) - 'search_key' into v from archive.sol_quotes q where q.old_id = p_old_id;
  elsif p_company = 'systems' and p_kind = 'invoice' then
    select (to_jsonb(i) - 'search_key') || jsonb_build_object('vendor_name', ve.vendor)
      into v
    from archive.sys_invoices i
    left join archive.sys_vendors ve on ve.old_id = i.vendor_id
    where i.old_id = p_old_id;
  elsif p_company = 'solutions' and p_kind = 'invoice' then
    select (to_jsonb(i) - 'search_key') || jsonb_build_object('vendor_name', ve.vendor, 'industry_name', ind.name)
      into v
    from archive.sol_invoices i
    left join archive.sol_vendors ve on ve.old_id = i.vendor_id
    left join archive.sol_industries ind on ind.old_id = i.industry_id
    where i.old_id = p_old_id;
  else
    raise exception 'Unknown record';
  end if;
  return v;
end;
$$;
-- ---------------------------------------------------------------------------
-- archive_lookups: the small lists for one company, plus the Solutions
-- customer list (id, name, tax certificate expiration).
-- ---------------------------------------------------------------------------
create or replace function public.archive_lookups(p_company text)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Only signed-in staff can open the archive.';
  end if;
  if p_company = 'systems' then
    return jsonb_build_object(
      'companies',     (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.company_name) order by t.old_id), '[]') from archive.sys_companies t),
      'vendors',       (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.vendor) order by t.old_id), '[]') from archive.sys_vendors t),
      'payment_types', (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.payment_type) order by t.old_id), '[]') from archive.sys_payment_types t),
      'quoted_by',     (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.quoted_by_name) order by t.old_id), '[]') from archive.sys_quoted_by t),
      'snapshot_date', (select max(t.snapshot_date) from archive.sys_invoices t));
  elsif p_company = 'solutions' then
    return jsonb_build_object(
      'companies',     (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.company_name) order by t.old_id), '[]') from archive.sol_companies t),
      'vendors',       (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.vendor) order by t.old_id), '[]') from archive.sol_vendors t),
      'payment_types', (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.payment_type) order by t.old_id), '[]') from archive.sol_payment_types t),
      'quoted_by',     (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.quoted_by_name) order by t.old_id), '[]') from archive.sol_quoted_by t),
      'industries',    (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.name) order by t.old_id), '[]') from archive.sol_industries t),
      'customers',     (select coalesce(jsonb_agg(jsonb_build_object('id', t.old_id, 'name', t.name, 'name_key', t.name_key,
                                          'tax_certificate_expiration', t.tax_certificate_expiration) order by t.name_key, t.old_id), '[]') from archive.sol_customers t),
      'snapshot_date', (select max(t.snapshot_date) from archive.sol_invoices t));
  else
    raise exception 'Pick In-Mar Systems or In-Mar Solutions.';
  end if;
end;
$$;
revoke all on function public.archive_list(text, text, text, text, date, date, integer) from public, anon;
revoke all on function public.archive_record(text, text, integer) from public, anon;
revoke all on function public.archive_lookups(text) from public, anon;
grant execute on function public.archive_list(text, text, text, text, date, date, integer) to authenticated;
grant execute on function public.archive_record(text, text, integer) to authenticated;
grant execute on function public.archive_lookups(text) to authenticated;
notify pgrst, 'reload schema';
commit;
