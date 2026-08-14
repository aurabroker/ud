-- Public form-submit goes through the edge function (service_role bypasses RLS),
-- so the anon INSERT policy is unused and a spam/poisoning vector that bypasses
-- Turnstile and PESEL validation. Drop it.
drop policy if exists "ud_clients_anon_insert" on public.ud_clients;
