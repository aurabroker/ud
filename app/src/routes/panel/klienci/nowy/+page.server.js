import { fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';

export async function load({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  return {};
}

export const actions = {
  default: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');

    const form = await request.formData();
    const str = (k) => { const v = String(form.get(k) ?? '').trim(); return v || null; };
    const bool = (k) => form.get(k) === 'on';

    const full_name = str('full_name');
    if (!full_name) return fail(400, { error: 'Imię i nazwisko jest wymagane.', values: Object.fromEntries(form) });

    const row = {
      full_name,
      email: str('email'),
      phone: str('phone'),
      pesel: str('pesel'),
      height: str('height'),
      weight: str('weight'),
      handedness: str('handedness'),
      profession: str('profession'),
      employment_type: str('employment_type'),
      tax_form: str('tax_form'),
      smoker: bool('smoker'),
      risk_death_invalidity: bool('risk_death_invalidity'),
      risk_temp_incapacity: bool('risk_temp_incapacity'),
      temp_incapacity_sum: str('temp_incapacity_sum'),
      risk_perm_incapacity: bool('risk_perm_incapacity'),
      perm_incapacity_sum: str('perm_incapacity_sum'),
      nw_death_sum: str('nw_death_sum'),
      med_notes: str('med_notes'),
      source: 'manual',
      referred_by: user.id,
      form_data: {}
    };

    const sb = createAdminClient();
    const { data, error } = await sb.from('ud_clients').insert(row).select('id').single();
    if (error) return fail(400, { error: 'Zapis: ' + error.message, values: Object.fromEntries(form) });

    throw redirect(303, `/panel/klienci/${data.id}`);
  }
};
