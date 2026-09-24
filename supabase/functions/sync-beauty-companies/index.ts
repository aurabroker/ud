import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const AURA_EXPERT_TENANT_ID = '9dabd3a0-f1ee-43bc-92a1-6137ac814100';
const BEAUTY_URL = 'https://dhuvykwecsxgchzxufxw.supabase.co';
const PAGE_SIZE = 1000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const BEAUTY_KEY = Deno.env.get('BEAUTY_SERVICE_ROLE_KEY') ?? '';
  const AURA_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const AURA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!BEAUTY_KEY) {
    return new Response(JSON.stringify({ error: 'BEAUTY_SERVICE_ROLE_KEY not configured' }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  let logId: string | null = null;
  try {
    const logRes = await fetch(`${AURA_URL}/rest/v1/crm_sync_log`, {
      method: 'POST',
      headers: { 'apikey': AURA_KEY, 'Authorization': `Bearer ${AURA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ tenant_id: AURA_EXPERT_TENANT_ID, source: 'beauty.crm_companies', status: 'running' })
    });
    if (logRes.ok) { const d = await logRes.json(); logId = Array.isArray(d) ? d[0]?.id : d?.id; }
  } catch (_) {}

  const finishLog = async (status: string, records: number, error?: string) => {
    if (!logId) return;
    await fetch(`${AURA_URL}/rest/v1/crm_sync_log?id=eq.${logId}`, {
      method: 'PATCH',
      headers: { 'apikey': AURA_KEY, 'Authorization': `Bearer ${AURA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, records_synced: records, finished_at: new Date().toISOString(), ...(error ? { error } : {}) })
    }).catch(() => {});
  };

  try {
    const companies: any[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const beautyRes = await fetch(
        `${BEAUTY_URL}/rest/v1/crm_companies?select=id,company,city,state,nip,regon,rodo,email,phone,contact,title&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: { 'apikey': BEAUTY_KEY, 'Authorization': `Bearer ${BEAUTY_KEY}` } }
      );
      if (!beautyRes.ok) throw new Error(`BEAUTY ${beautyRes.status}: ${await beautyRes.text()}`);
      const page = await beautyRes.json() as any[];
      companies.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    if (!companies.length) {
      await finishLog('done', 0);
      return new Response(JSON.stringify({ synced: 0 }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const mappedClients = companies.map((c: any) => ({
      tenant_id: AURA_EXPERT_TENANT_ID,
      beauty_id: c.id,
      typ: 'firma',
      nazwa: c.company ?? '(brak nazwy)',
      ulica: [c.city, c.state].filter(Boolean).join(', ') || null,
      nip: c.nip || null,
      regon: c.regon || null,
      email: c.email || null,
      telefon: c.phone || null,
      rodo_zgoda: !!(c.rodo && c.rodo !== '' && c.rodo !== 'brak'),
      rodo_data: null,
      rodo_kanal: 'Import BEAUTY'
    }));

    for (let i = 0; i < mappedClients.length; i += 100) {
      const batch = mappedClients.slice(i, i + 100);
      const res = await fetch(
        `${AURA_URL}/rest/v1/crm_clients?on_conflict=beauty_id,tenant_id`,
        {
          method: 'POST',
          headers: { 'apikey': AURA_KEY, 'Authorization': `Bearer ${AURA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(batch)
        }
      );
      if (!res.ok) throw new Error(`Upsert clients batch ${i}: ${res.status} ${await res.text()}`);
    }

    const companiesWithContact = companies.filter((c: any) => c.contact && c.contact.trim() !== '');

    if (companiesWithContact.length > 0) {
      const beautyToClientId = new Map<any, any>();
      for (let i = 0; i < companiesWithContact.length; i += 500) {
        const idsBatch = companiesWithContact.slice(i, i + 500).map((c: any) => c.id);
        const clientsRes = await fetch(
          `${AURA_URL}/rest/v1/crm_clients?select=id,beauty_id&beauty_id=in.(${idsBatch.join(',')})&tenant_id=eq.${AURA_EXPERT_TENANT_ID}`,
          { headers: { 'apikey': AURA_KEY, 'Authorization': `Bearer ${AURA_KEY}` } }
        );
        const clientRows = clientsRes.ok ? (await clientsRes.json() as any[]) : [];
        for (const r of clientRows) beautyToClientId.set(r.beauty_id, r.id);
      }

      const mappedContacts = companiesWithContact
        .map((c: any) => {
          const klientId = beautyToClientId.get(c.id);
          if (!klientId) return null;
          return {
            tenant_id: AURA_EXPERT_TENANT_ID,
            beauty_id: c.id,
            klient_id: klientId,
            imie_nazwisko: c.contact.trim(),
            stanowisko: c.title || null,
            telefon: c.phone || null,
            email: c.email || null,
            notatki: 'Sync z Beauty CRM'
          };
        })
        .filter(Boolean);

      for (let i = 0; i < mappedContacts.length; i += 100) {
        const batch = mappedContacts.slice(i, i + 100);
        const res = await fetch(
          `${AURA_URL}/rest/v1/crm_client_contacts?on_conflict=tenant_id,beauty_id`,
          {
            method: 'POST',
            headers: { 'apikey': AURA_KEY, 'Authorization': `Bearer ${AURA_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(batch)
          }
        );
        if (!res.ok) {
          console.error(`Contacts batch ${i}: ${res.status} ${await res.text()}`);
        }
      }
    }

    await finishLog('done', mappedClients.length);
    return new Response(
      JSON.stringify({ synced: mappedClients.length, contacts_with_data: companiesWithContact.length }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    await finishLog('error', 0, err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
