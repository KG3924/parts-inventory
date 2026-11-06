-- CL2: frozen customer details on quotes and invoices, and optional ship-to save on Approve.
-- Run once in the Supabase SQL editor, only after this build is on live Pages and every phone has hard-refreshed.
-- Safe to re-run.
-- Does not add or change columns on public.customers.
-- Does not change shop_approve_invoice_r1, stock math, numbering, freeze guards, or void.
-- No customer data in this file.

begin;

alter table public.quotes add column if not exists contact_name text;
alter table public.quotes add column if not exists phone text;
alter table public.quotes add column if not exists email text;
alter table public.quotes add column if not exists billing_address text;
alter table public.quotes add column if not exists ship_to text;
alter table public.quotes add column if not exists tax_exempt_number text;
alter table public.quotes add column if not exists customer_notes text;

alter table public.invoices add column if not exists contact_name text;
alter table public.invoices add column if not exists phone text;
alter table public.invoices add column if not exists email text;
alter table public.invoices add column if not exists billing_address text;
alter table public.invoices add column if not exists tax_exempt_number text;
alter table public.invoices add column if not exists customer_notes text;
alter table public.invoices add column if not exists save_ship_to boolean not null default false;

-- Same entry point as schema/vd1_void_invoice.sql, plus the CL2 write of invoice.ship_to
-- onto customers.ship_to_address inside this same transaction after r1 succeeds.
create or replace function public.shop_approve_invoice(p_invoice_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.invoices;
  v_res jsonb;
  v_ship text;
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

  -- CL2: write invoice ship-to over the customer's one saved ship-to, only on a
  -- successful first Approve, only when the box was checked and ship-to has text.
  -- A failed Approve never reaches here (r1 raises). A second Approve does not write again.
  v_res := v_res || jsonb_build_object('ship_to_updated', false, 'customer_in_qb', false);
  if coalesce(v_res ->> 'ok', 'false') = 'true'
     and coalesce(v_res ->> 'already_approved', 'false') = 'false' then
    select * into v_inv from public.invoices where id = p_invoice_id;
    v_ship := pg_catalog.btrim(coalesce(v_inv.ship_to, ''));
    if coalesce(v_inv.save_ship_to, false)
       and v_inv.customer_id is not null
       and v_ship <> '' then
      update public.customers
         set ship_to_address = v_ship
       where id = v_inv.customer_id;
      if not found then
        raise exception 'That customer was not found. This invoice stayed a draft.';
      end if;
      v_res := v_res || jsonb_build_object(
        'ship_to_updated', true,
        'customer_in_qb', exists (
          select 1 from public.customers c
          where c.id = v_inv.customer_id
            and case
              when v_inv.company = 'S' then c.qb_status_systems
              else c.qb_status
            end = 'in_qb'
        )
      );
    end if;
  end if;

  return v_res;
end;
$$;
revoke all on function public.shop_approve_invoice(uuid) from public, anon;
grant execute on function public.shop_approve_invoice(uuid) to authenticated;

commit;
