/**
 * Zakładka „Klienci" — lista z kolumną „Akcja" (etap leada klienta,
 * src/lib/klienci/akcja.js). Bez importów ze SvelteKita: test przeglądarkowy
 * woła tę samą funkcję na prawdziwym SQL (test/leady/serwer.mjs).
 */
import { synchronizuj } from './leady.js';
import { klienciWidoczni } from './widocznosc.js';
import { akcjaKlienta } from '../klienci/akcja.js';

export async function listaKlientow(sb, userId) {
  // Ta sama synchronizacja co przy otwarciu tablicy: nowy klient od razu ma
  // lead i etap. Awaria jej nie blokuje listy — „Akcja" pokaże wtedy „—".
  await synchronizuj(sb);
  // Agent widzi tylko klientów swoich leadów (null = administrator, wszyscy).
  const widoczni = await klienciWidoczni(sb, userId);
  const tylkoWidoczni = (zapytanie, kolumna) =>
    widoczni === null ? zapytanie : widoczni.length ? zapytanie.in(kolumna, widoczni) : Promise.resolve({ data: [] });

  const [{ data: clients }, { data: profiles }, { data: leady }, { data: etapy }] = await Promise.all([
    tylkoWidoczni(sb.from('ud_clients')
      .select('id, full_name, email, phone, employment_type, referred_by, created_at, source')
      .order('created_at', { ascending: false }), 'id'),
    sb.from('ud_user_profiles').select('id, full_name'),
    tylkoWidoczni(sb.from('ud_leady').select('id, klient_id, etap_id, zarchiwizowano_at, powod_utraty, ochrona_do'), 'klient_id'),
    sb.from('ud_leady_etap').select('id, klucz, rodzaj, nazwa'),
  ]);

  const owners = {};
  for (const p of profiles || []) owners[p.id] = p.full_name || '—';
  const leadKlienta = new Map((leady || []).filter((l) => l.klient_id).map((l) => [l.klient_id, l]));
  const etapPo = new Map((etapy || []).map((e) => [e.id, e]));
  const dzis = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());

  return (clients || []).map((c) => {
    const lead = leadKlienta.get(c.id);
    return {
      ...c,
      owner_name: c.referred_by ? (owners[c.referred_by] || 'nieznany user') : null,
      akcja: akcjaKlienta(lead, lead ? etapPo.get(lead.etap_id) : null, dzis),
    };
  });
}
