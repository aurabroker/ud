/**
 * Niedokończone wnioski — lista szkiców ZE ZGODĄ na kontakt + lejek.
 *
 * Plan: PLAN-NIEDOKONCZONE-WNIOSKI.md. Tabela `ud_wnioski_szkice` ma RLS bez
 * polityk, więc czyta ją wyłącznie klucz serwisowy (createAdminClient) — dlatego
 * dostęp do tej strony sprawdzamy sami: sesja agenta jest wymagana, a role nie
 * mają znaczenia (decyzja właściciela z 01.10.2026: widzi każdy agent z dostępem
 * do panelu).
 *
 * Czego tu NIE MA i nie będzie: PESEL-u i odpowiedzi z ankiety medycznej. Szkic
 * ich nie zbiera — dane o zdrowiu z wniosku, którego ktoś nie wysłał, nie mają
 * podstawy prawnej.
 */
import { fail, redirect } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase.js';
import { lejek } from '$lib/lejek.js';

/**
 * Czy prawnik zatwierdził treść zgody na kontakt (ZGODA_KONTAKT w @ud/wniosek).
 *
 * Do tego czasu strona pokazuje ostrzeżenie: z listy nie dzwonimy i nie piszemy.
 * Zadanie `wnioski-przypomnienia` w pg_cron jest wtedy wyłączone. Po akceptacji:
 * zmień na `true`, wdróż panel i włącz zadanie (migracja
 * 20261001101112_wnioski_szkice.sql, sekcja „Przypomnienie e-mailem").
 */
const ZGODA_ZATWIERDZONA = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Akcje formularzy nie przechodzą przez +layout.server.js, więc sesję sprawdzamy tu. */
async function wymagajSesji(locals) {
  const { user } = await locals.safeGetSession();
  if (!user) throw redirect(303, '/login');
}

export async function load({ locals }) {
  await wymagajSesji(locals);
  const sb = createAdminClient();

  const [szkice, widok] = await Promise.all([
    sb.from('ud_wnioski_szkice')
      .select('id, created_at, updated_at, ostatni_krok, imie, email, phone, przypomnienie_wyslane_at')
      .eq('zgoda_kontakt', true)
      .is('ukonczony_at', null)
      .is('obsluzony_at', null)
      .order('updated_at', { ascending: false })
      .limit(200),
    sb.from('ud_lejek_wniosku')
      .select('tydzien, ostatni_krok, szkicow')
      .order('tydzien', { ascending: false })
      .limit(120),
  ]);

  return {
    szkice: szkice.data || [],
    lejek: lejek(widok.data || []),
    zgodaZatwierdzona: ZGODA_ZATWIERDZONA,
    loadError: szkice.error?.message || widok.error?.message || '',
  };
}

export const actions = {
  /** „Obsłużony": ktoś z zespołu zajął się tą osobą — znika z listy i z puli przypomnień. */
  obsluzony: async ({ request, locals }) => {
    await wymagajSesji(locals);
    const id = String((await request.formData()).get('id') || '');
    if (!UUID.test(id)) return fail(400, { error: 'Nieprawidłowy identyfikator.' });

    const { error } = await createAdminClient()
      .from('ud_wnioski_szkice')
      .update({ obsluzony_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return fail(500, { error: 'Nie udało się zapisać: ' + error.message });
    return { ok: true };
  }
};
