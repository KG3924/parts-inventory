-- =============================================================================
-- A2.6 — Freeze an approved invoice. The sale record stays as sold.
--
-- DO NOT RUN until this app build is on live Pages and every phone has
-- hard-refreshed. Order:
--   1. Merge, and wait until GitHub Pages is serving this build.
--   2. Hard-refresh every phone.
--   3. Then run this file once in the Supabase SQL editor.
--   4. Smoke. A grey button alone is not the lock. Pass is an UPDATE of
--      that approved invoice, with a signed-in profile, raising the
--      sentence below (P0001).
-- Safe to re-run.
-- Does not itself delete invoices or lines.
-- Does not void a draft invoice and does not restock.
-- Does not change shop_approve_invoice.
-- Does not replace invoices_guard_approve. DELETE of an approved invoice
-- still raises "Approved invoices stay on the books". Flipping an approved
-- invoice off approved still raises "Approved invoices stay approved".
-- Only shop_approve_invoice may stamp a draft approved.
-- Does not touch the void-quote triggers.
--
-- The freeze keys off the row that is ALREADY approved (OLD status or
-- OLD approved_at). The UPDATE that first stamps a draft approved still
-- succeeds. A check of NEW status would kill that first stamp.
-- invoice_lines INSERT, UPDATE, and DELETE raise the same sentence only
-- when the parent invoice row is already approved. The first Approve does
-- not write invoice_lines. A draft's lines still insert, update, and delete.
-- =============================================================================

create or replace function public.invoices_guard_approved_freeze()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- OLD, not NEW. Becoming approved is the first stamp and must succeed.
  if tg_op = 'UPDATE'
     and (old.status = 'approved' or old.approved_at is not null) then
    raise exception '% is approved. This invoice can''t change.',
      coalesce(nullif(btrim(old.number), ''), 'This invoice');
  end if;
  return new;
end;
$$;

-- Reads public.invoices, so this is security definer: a row the caller's RLS
-- cannot see must not slip past the lock. It only raises or returns the row.
-- Execute is revoked below. It does not check auth.uid() because the sentence
-- above is the error for every edit that reaches an already-approved invoice.
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
    -- Missing parent: orphan cleanup. Present and already approved: refuse.
    if found and (v_status = 'approved' or v_approved_at is not null) then
      raise exception '% is approved. This invoice can''t change.',
        coalesce(nullif(btrim(v_number), ''), 'This invoice');
    end if;
    return old;
  end if;

  if new.invoice_id is not null then
    select i.status, i.approved_at, i.number
      into v_status, v_approved_at, v_number
    from public.invoices i
    where i.id = new.invoice_id;
    if found and (v_status = 'approved' or v_approved_at is not null) then
      raise exception '% is approved. This invoice can''t change.',
        coalesce(nullif(btrim(v_number), ''), 'This invoice');
    end if;
  end if;

  -- Moving a line off an already-approved invoice is the same refuse.
  if tg_op = 'UPDATE'
     and old.invoice_id is distinct from new.invoice_id
     and old.invoice_id is not null then
    select i.status, i.approved_at, i.number
      into v_status, v_approved_at, v_number
    from public.invoices i
    where i.id = old.invoice_id;
    if found and (v_status = 'approved' or v_approved_at is not null) then
      raise exception '% is approved. This invoice can''t change.',
        coalesce(nullif(btrim(v_number), ''), 'This invoice');
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.invoices_guard_approved_freeze() from public, anon, authenticated;
revoke all on function public.invoice_lines_guard_approved_freeze() from public, anon, authenticated;

drop trigger if exists invoices_approved_freeze on public.invoices;
create trigger invoices_approved_freeze
  before update on public.invoices
  for each row
  execute function public.invoices_guard_approved_freeze();

drop trigger if exists invoice_lines_approved_freeze on public.invoice_lines;
create trigger invoice_lines_approved_freeze
  before insert or update or delete on public.invoice_lines
  for each row
  execute function public.invoice_lines_guard_approved_freeze();

notify pgrst, 'reload schema';
