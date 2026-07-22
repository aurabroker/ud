import { error, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { isVerified } from '$lib/server/clientAuth.js';
import { signedFileUrl } from '$lib/server/offers.js';

export async function GET({ params, cookies }) {
  const sb = createAdminClient();
  const { data: offer } = await sb
    .from('ud_offers')
    .select('id')
    .eq('share_token', params.token)
    .maybeSingle();
  if (!offer) throw error(404, 'Nie znaleziono');

  if (!(await isVerified(cookies, offer.id))) throw error(403, 'Wymagane hasło');

  const { data: file } = await sb
    .from('ud_offer_files')
    .select('storage_bucket, storage_path')
    .eq('id', params.fileId)
    .eq('offer_id', offer.id)
    .maybeSingle();
  if (!file) throw error(404, 'Plik nie istnieje');

  const url = await signedFileUrl(file.storage_bucket, file.storage_path, 300);
  throw redirect(302, url);
}
