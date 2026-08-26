import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { OFFER_CONDITIONS_HTML } from '$lib/server/offerConditions.js';

async function requireAdmin(locals) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  const sb = createAdminClient();
  const { data: me } = await sb.from('ud_user_profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') throw error(403, 'Tylko administrator.');
}

// Dane przykładowe (mock) — wyłącznie do dopracowania layoutu widoku klienta.
export async function load({ locals }) {
  await requireAdmin(locals);

  const documents = [
    {
      id: 'mock-lh',
      insurer_type: 'leadenhall',
      offer_number: 'LHQ3177434/1',
      insured_name: 'Jan Kowalski',
      insured_birthdate: '1985-04-12',
      insured_city: 'Warszawa',
      profession: 'Lekarz',
      risk_class: 'II',
      employment_type: 'uop',
      avg_monthly_income: 18500,
      insurance_period: '12 miesięcy',
      death_covered: false,
      temp_incapacity_covered: true,
      temp_monthly_benefit: 10000,
      temp_sum_insured: null,
      temp_daily_cap: null,
      perm_incapacity_covered: false,
      perm_sum_insured: 240000,
      indemnity_period: '24 miesiące',
      wait_accident: 14,
      wait_illness: 21,
      premium_total: 3036,
      premium_monthly: 253
    },
    {
      id: 'mock-ceu',
      insurer_type: 'ceu',
      offer_number: 'LOIP/2026/000239',
      insurance_period: '12 miesięcy',
      death_covered: false,
      temp_incapacity_covered: true,
      temp_monthly_benefit: 38000,
      temp_sum_insured: 874000,
      temp_daily_cap: null,
      perm_incapacity_covered: true,
      perm_sum_insured: 4800000,
      indemnity_period: '24 miesiące',
      wait_accident: null,
      wait_illness: null,
      premium_total: 27331.44,
      premium_monthly: 2277.62
    }
  ];

  const files = [
    { id: 'f4', file_type: 'offer_pdf', file_name: 'Oferta Leadenhall.pdf' },
    { id: 'f5', file_type: 'offer_pdf', file_name: 'Oferta CEU.pdf' },
    { id: 'f6', file_type: 'summary', file_name: 'Porównanie ofert (rekomendacja).pdf' },
    { id: 'f1', file_type: 'owu', file_name: 'OWU LW047.pdf' },
    { id: 'f2', file_type: 'owu', file_name: 'OWU LW049 (HIV/WZW).pdf' },
    { id: 'f3', file_type: 'owu', file_name: 'Karta produktowa.pdf' },
    { id: 'f7', file_type: 'attachment', file_name: 'Dodatkowe wyliczenie składki.pdf' }
  ];

  return {
    offer: {
      id: 'mock',
      name: 'Oferta demonstracyjna',
      offer_number: 'UD/2026/AD/00042/Kowalski',
      client_name: 'Jan Kowalski',
      broker_message: 'Dzień dobry, w załączeniu przygotowana rekomendacja. W razie pytań jestem do dyspozycji.',
      status: 'sent',
      client_choice: null
    },
    documents,
    files,
    conditionsHtml: OFFER_CONDITIONS_HTML,
    distributorPdf: { name: 'Informacja o dystrybutorze — Aura Expert.pdf' }
  };
}
