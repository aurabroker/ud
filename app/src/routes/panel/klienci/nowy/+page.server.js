import { fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';

// Pola tekstowe (jak w formularzu self-service)
const TEXT_FIELDS = [
  'email', 'phone', 'pesel', 'height', 'weight', 'handedness', 'tax_form',
  'profession', 'employment_type',
  'b2b_start_date', 'b2b_industry', 'b2b_character', 'b2b_area',
  'b2b_employees_2024', 'b2b_employees_2025', 'b2b_own_contribution', 'b2b_description',
  'temp_incapacity_sum', 'perm_incapacity_sum', 'nw_death_sum', 'nw_funeral',
  'nw_adaptation', 'nw_hospital_daily', 'nw_medical_costs', 'nw_unconscious_weekly',
  'med_notes'
];

// Pola tak/nie (checkboxy)
const BOOL_FIELDS = [
  'smoker', 'weight_change', 'takes_meds', 'pending_diagnosis', 'disability_congenital',
  'employs_people',
  'med_heart', 'med_diabetes', 'med_bones', 'med_stomach', 'med_neuro', 'med_surgery', 'med_aids',
  'event_hospitalization', 'event_sick_leave_30', 'event_further_diagnosis',
  'nw_permanent_damage',
  'risk_death_invalidity', 'risk_temp_incapacity', 'risk_perm_incapacity',
  'informed_accepted', 'exclusions_accepted',
  'risk_balloon', 'risk_sailing', 'risk_skiing', 'risk_skydiving', 'risk_diving', 'risk_caving',
  'risk_aviation', 'risk_extreme_bike_boat', 'risk_climbing', 'risk_paragliding', 'risk_horse',
  'risk_horse_jumping', 'risk_gravity_bike', 'risk_quad', 'risk_hunting'
];

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
    const full_name = String(form.get('full_name') ?? '').trim();
    if (!full_name) return fail(400, { error: 'Imię i nazwisko jest wymagane.', values: Object.fromEntries(form) });

    const row = { full_name, source: 'manual', referred_by: user.id, form_data: {} };
    for (const f of TEXT_FIELDS) {
      const v = String(form.get(f) ?? '').trim();
      if (v) row[f] = v;
    }
    for (const f of BOOL_FIELDS) row[f] = form.get(f) === 'on';

    const sb = createAdminClient();
    const { data, error } = await sb.from('ud_clients').insert(row).select('id').single();
    if (error) return fail(400, { error: 'Zapis: ' + error.message, values: Object.fromEntries(form) });

    throw redirect(303, `/panel/klienci/${data.id}`);
  }
};
