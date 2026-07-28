import { error, redirect } from '@sveltejs/kit';
import { ensureSummaryUrl } from '$lib/server/offers.js';

export async function GET({ params, locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
  const url = await ensureSummaryUrl(params.id);
  if (!url) throw error(400, 'PDF niedostępny — sprawdź klucz PDFShift (PDFSHIFT_API).');
  throw redirect(302, url);
}
