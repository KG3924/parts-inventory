-- =============================================================================
-- DO NOT RUN THIS until the login app is merged to main and live Pages
-- is the version that requires sign-in.
--
-- Running it now, while main is still the no-login app, locks the live
-- shop out of inventory immediately. The anon key in the old page will
-- get zero rows and every save will fail.
--
-- Cutover order:
--   1. QA Pass on the phone preview (not this SQL).
--   2. Merge the PR to main. Wait until Pages shows the login wall.
--   3. Then run this file once in the Supabase SQL Editor.
--   4. Each phone enrolls / saves its login again on the live Pages URL.
--   5. Smoke: unlock → scan → new or used → Commit → label still scans.
--
-- Safe to re-run after that. Does not delete inventory rows.
-- =============================================================================

begin;

-- Staff directory. Names are not editable by the browser.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique
);

insert into public.profiles (id, full_name, email)
select u.id, v.full_name, v.email
from auth.users u
join (values
  ('glynn@inmarsystems.com', 'Glynn Grantham'),
  ('kyle.grantham.kg@gmail.com', 'Kyle Grantham'),
  ('toby@inmarsystems.com', 'Toby Whitfield'),
  ('grant@inmarsystems.com', 'Grant Adams'),
  ('ricky@inmarsystems.com', 'Ricky Whitfield')
) as v(email, full_name) on lower(u.email) = lower(v.email)
on conflict (id) do update set full_name = excluded.full_name, email = excluded.email;

-- Drop every open "anyone can change everything" policy. Do not leave them
-- next to the new rules.
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname, p.polname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.polname, r.nspname, r.relname);
  end loop;
end $$;

-- Stop the public anon key from touching shop tables even if a policy is missed.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter table public.inventory enable row level security;
alter table public.inventory_adjustments enable row level security;
alter table public.inventory_price_history enable row level security;
alter table public.inventory_cost_layers enable row level security;
alter table public.app_settings enable row level security;
alter table public.app_lookups enable row level security;
alter table public.customers enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;
alter table public.document_counters enable row level security;
alter table public.packing_lists enable row level security;
alter table public.packing_list_lines enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.profiles enable row level security;

-- Five signed-in shop accounts share the stock. There is no per-row owner.
-- Public signup must stay OFF so a sixth account cannot appear.
do $$
declare t text;
begin
  foreach t in array array[
    'inventory','inventory_adjustments','inventory_price_history','inventory_cost_layers',
    'app_settings','app_lookups','customers','quotes','quote_lines','document_counters',
    'packing_lists','packing_list_lines','invoices','invoice_lines'
  ]
  loop
    execute format('create policy "shop read %1$s" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "shop insert %1$s" on public.%1$I for insert to authenticated with check (true)', t);
    execute format('create policy "shop update %1$s" on public.%1$I for update to authenticated using (true) with check (true)', t);
    execute format('create policy "shop delete %1$s" on public.%1$I for delete to authenticated using (true)', t);
  end loop;
end $$;

create policy "shop read profiles" on public.profiles
  for select to authenticated using (true);

-- No anon policies. Unsigned requests see no rows.

notify pgrst, 'reload schema';

commit;

-- Also in the Supabase dashboard, before or with this script:
-- Authentication → Sign In / Providers → Email → turn OFF "Allow new users to sign up".
-- This file cannot flip that GoTrue switch. The five accounts already exist.
