import { error, redirect } from '@sveltejs/kit';
import { ensureSummaryUrl } from '$lib/server/offers.js';

export async function GET({ params, locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');

  const url = await ensureSummaryUrl(params.id);
  if (!url) throw error(400, 'PDF niedostępny — sprawdź klucz PDFShift (PDFSHIFT_API).');

  // Strumieniujemy przez naszą domenę — link Supabase nie jest ujawniany.
  const res = await fetch(url);
  if (!res.ok) throw error(502, 'Nie udało się pobrać PDF ze storage.');

  return new Response(res.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="podsumowanie-oferty.pdf"',
      'Cache-Control': 'no-store'
    }
  });
}
