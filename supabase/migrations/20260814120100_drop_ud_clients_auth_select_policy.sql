-- ud_clients holds sensitive lead data (PESEL, medical answers, contact).
-- Reads must be limited to UD-module admins; ud_clients_admin_all already grants
-- SELECT to is_ud_admin(). The permissive ud_clients_auth_select USING(true)
-- lets any authenticated user from any module in the shared project read leads.
-- Edge functions use the service_role key and bypass RLS, so digest/confirmation
-- emails are unaffected.
drop policy if exists "ud_clients_auth_select" on public.ud_clients;
