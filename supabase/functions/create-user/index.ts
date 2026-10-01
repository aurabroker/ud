import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Tylko admin moze wywolac te funkcje
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Brak autoryzacji');

    // Klient z prawami admina (service role)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Sprawdz czy wywolujacy jest adminem
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: caller }, error: callerErr } = await supabaseUser.auth.getUser();
    if (callerErr || !caller) throw new Error('Nie mozna zweryfikowac uzytkownika');

    const { data: callerProfile, error: profileErr } = await supabaseAdmin
      .from('ud_user_profiles')
      .select('role')
      .eq('id', caller.id)
      .single();
    if (profileErr || callerProfile?.role !== 'admin') {
      throw new Error('Brak uprawnien - tylko admin moze tworzyc uzytkownikow');
    }

    // Dane nowego usera
    const { email, password, full_name, role, leader_id, affiliate_code } = await req.json();
    if (!email || !password || !full_name) throw new Error('Brak wymaganych pol: email, password, full_name');

    // 1. Utworz konto w Supabase Auth
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createErr) throw createErr;

    // 2. Utworz profil w ud_user_profiles
    const { error: insertErr } = await supabaseAdmin
      .from('ud_user_profiles')
      .insert([{
        id: newUser.user.id,
        email,
        full_name,
        role: role || 'user',
        active: true,
        affiliate_code: affiliate_code || null,
        leader_id: leader_id || null,
      }]);
    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
