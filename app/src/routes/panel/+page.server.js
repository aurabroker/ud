import { fail, redirect } from '@sveltejs/kit';
import { deleteOffer } from '$lib/server/offers.js';

export async function load({ locals }) {
  const { data: offers } = await locals.supabase
    .from('ud_offers')
    .select('id, name, client_name, status, source, created_at, sent_at, share_token')
    .eq('source', 'pdf_import')
    .order('created_at', { ascending: false })
    .limit(200);

  return { offers: offers || [] };
}

export const actions = {
  delete: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (!user) throw redirect(303, '/login');
    const form = await request.formData();
    const id = String(form.get('id') || '');
    try {
      await deleteOffer(id);
      return { deleted: true };
    } catch (e) {
      return fail(400, { error: e?.message || 'Błąd usuwania' });
    }
  }
};
