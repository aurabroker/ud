import { error } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { getSettings } from '$lib/server/settings.js';

const PUBLIC_BUCKET = 'ud-public';

// Globalny dokument „Informacja o dystrybutorze" — strumieniowany przez naszą domenę.
export async function GET() {
  const settings = await getSettings();
  const path = settings.distributor_pdf_path;
  if (!path) throw error(404, 'Brak dokumentu informacji o dystrybutorze.');

  const sb = createAdminClient();
  const { data, error: dlErr } = await sb.storage.from(PUBLIC_BUCKET).download(path);
  if (dlErr || !data) throw error(502, 'Nie udało się pobrać dokumentu.');

  const name = (settings.distributor_pdf_name || 'Informacja o dystrybutorze.pdf').replace(/["\\]/g, '');
  return new Response(data.stream(), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'no-store'
    }
  });
}
