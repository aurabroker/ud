import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function logError(
  source: string,
  message: string,
  context?: Record<string, unknown>,
  ip?: string,
) {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await supabase.from('ud_errors').insert({
      source,
      level: 'error',
      message: String(message).substring(0, 500),
      context: context ?? null,
      ip: ip ?? null,
    });
  } catch {
    // nie przerywaj głównego flow jeśli logowanie zawiedzie
  }
}
