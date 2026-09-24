-- Lets a signed-in shop account set another person's password.
-- Only the service role can run this. The edge function checks who is signed in first.
-- Length is the only rule: 8 characters. No symbol, case, or leaked-password check.
-- Safe to re-run. Does not change inventory.

create or replace function public.set_staff_password(target_email text, new_password text)
returns void
language plpgsql
security definer
set search_path = auth, extensions, public
as $$
declare
  uid uuid;
begin
  if new_password is null or length(new_password) < 8 then
    raise exception 'Use at least 8 characters';
  end if;
  if lower(target_email) not in (
    'glynn@inmarsystems.com',
    'kyle.grantham.kg@gmail.com',
    'toby@inmarsystems.com',
    'grant@inmarsystems.com',
    'ricky@inmarsystems.com'
  ) then
    raise exception 'Unknown person';
  end if;
  select id into uid from auth.users where lower(email) = lower(target_email);
  if uid is null then
    raise exception 'That login does not exist yet';
  end if;
  update auth.users
    set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
        updated_at = now()
    where id = uid;
  delete from auth.sessions where user_id = uid;
  delete from auth.refresh_tokens where user_id = uid::text;
end;
$$;

revoke all on function public.set_staff_password(text, text) from public;
revoke all on function public.set_staff_password(text, text) from anon, authenticated;
grant execute on function public.set_staff_password(text, text) to service_role;

notify pgrst, 'reload schema';
