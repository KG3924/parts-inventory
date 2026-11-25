-- SEC1: sign-in by name. The browser never sees a login email.
-- Run ONCE in the SQL editor BEFORE the SEC1 PR is merged (the new page needs it).
-- Additive only: the old page keeps working until the merge. Safe to re-run.
-- Holds no emails or passwords. Emails stay only in public.profiles.

begin;

-- One profile per name: sign-in looks people up by full_name.
-- Fails here (nothing applied) if two rows already share a name.
create unique index if not exists profiles_full_name_key on public.profiles (full_name);

-- Name to login email, for the staff-sign-in Edge Function only (service role).
-- Returns null for a name that is not a staff profile.
create or replace function public.shop_staff_email(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.email from public.profiles p where p.full_name = p_name;
$$;

-- Password set by name. Replaces set_staff_password(target_email, ...) after the merge.
create or replace function public.set_staff_password_by_name(target_name text, new_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  if new_password is null or length(new_password) < 8 then
    raise exception 'Use at least 8 characters';
  end if;
  select p.id into uid from public.profiles p where p.full_name = target_name;
  if uid is null then
    raise exception 'Unknown person';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = uid;
  if not found then
    raise exception 'That login does not exist yet';
  end if;
  delete from auth.sessions where user_id = uid;
  delete from auth.refresh_tokens where user_id = uid::text;
end;
$$;

revoke all on function public.shop_staff_email(text) from public, anon, authenticated;
revoke all on function public.set_staff_password_by_name(text, text) from public, anon, authenticated;
grant execute on function public.shop_staff_email(text) to service_role;
grant execute on function public.set_staff_password_by_name(text, text) to service_role;

notify pgrst, 'reload schema';

commit;

select 'sec1_sign_in_lookup' as file, 'ok' as result;
