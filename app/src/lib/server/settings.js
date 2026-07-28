/**
 * settings.js — odczyt ustawień panelu z ud_settings (klucz-wartość jsonb).
 */
import { createAdminClient } from './supabase.js';

const DEFAULTS = {
  company_name: 'Aura Expert sp. z o.o.',
  company_full: '',
  default_broker_message: '',
  exclusions_text: '',
  logo_url: '',
  logo_path: '',
  pdf_footer: ''
};

/** @returns {Promise<Record<string, any>>} */
export async function getSettings() {
  const sb = createAdminClient();
  const { data } = await sb.from('ud_settings').select('key, value');
  const out = { ...DEFAULTS };
  for (const row of data || []) out[row.key] = row.value;
  return out;
}

export { DEFAULTS as SETTINGS_DEFAULTS };
