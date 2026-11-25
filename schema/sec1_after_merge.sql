-- SEC1 cleanup. Run ONCE only after the SEC1 PR is merged, Pages is green,
-- every phone has hard-refreshed and the new set-staff-password function is deployed.
-- Removes the old email-based password function. Safe to re-run.
begin;
drop function if exists public.set_staff_password(text, text);
notify pgrst, 'reload schema';
commit;
select 'sec1_after_merge' as file, 'ok' as result;
