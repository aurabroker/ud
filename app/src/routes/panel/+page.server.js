export async function load({ locals }) {
  const { data: offers } = await locals.supabase
    .from('ud_offers')
    .select('id, name, client_name, status, source, created_at, sent_at, share_token')
    .eq('source', 'pdf_import')
    .order('created_at', { ascending: false })
    .limit(100);

  return { offers: offers || [] };
}
