/**
 * Per-zawodowy llms.txt — po jednym dla każdej podstrony zawodu.
 *
 * Stary serwis miał takie pliki i były zaindeksowane, więc znikają tylko te,
 * których zawód wypadł z listy. Format ten sam co w pliku głównym: H1 jako
 * pierwszy element, cytat blokowy ze streszczeniem, sekcje H2.
 *
 * Sens jest tu inny niż przy pliku głównym: to jest treść podstrony bez
 * nawigacji, stopki i szumu — czyli dokładnie to, co model chce przeczytać,
 * gdy trafi na tę stronę.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { ZAWODY, zawod, tresc, pokrewne, slugKategorii } from '@ud/zawody';
import { FIRMA, SERWIS } from '../../lib/firma';
import { symuluj, zl, ZUS_MIESIECZNIE } from '../../lib/symulacja';

export const getStaticPaths: GetStaticPaths = () =>
  ZAWODY.map((z) => ({ params: { zawod: z.slug } }));

export const GET: APIRoute = ({ params }) => {
  const z = zawod(params.zawod!)!;
  const o = z.odmiana;
  const t = tresc(z.slug);

  const dochod = Math.max(8000, Math.round((z.swiadczenieDzienne ?? 400) * 30 / 0.8 / 1000) * 1000);
  const w = symuluj({ dochod, zatrudnienie: 'b2b' });

  const ryzyka = (t?.ryzyka ?? z.ryzyka)
    .map((r) => `- **${r.tytul}** — ${r.opis}`)
    .join('\n');

  const pytania = t?.pytania?.length
    ? `\n## Pytania i odpowiedzi\n\n${t.pytania
        .map((p) => `### ${p.pytanie}\n\n${p.odpowiedz}`)
        .join('\n\n')}\n`
    : '';

  const pokrewneZawody = pokrewne(z.slug, 8)
    .map((p) => `- [${p.nazwa}](${SERWIS.url}/${p.slug}/)`)
    .join('\n');

  const tekst = `# Ubezpieczenie utraty dochodu dla ${o.dopelniacz.toLowerCase()}

> ${t?.wstep ?? `Ochrona dochodu ${o.dopelniacz.toLowerCase()} na wypadek całkowitej niezdolności do wykonywania zawodu wskutek choroby lub nieszczęśliwego wypadku.`}

Strona: ${SERWIS.url}/${z.slug}/
Kategoria zawodowa: ${z.kategoria}
Odmiana nazwy: ${o.mianownik} / ${o.dopelniacz} / ${o.narzednik} / liczba mnoga: ${o.mnoga}

## Jak wygląda dochód w tym zawodzie

${t?.dochod ?? `Zarobki ${o.dopelniacz.toLowerCase()} na kontrakcie zależą od wykonanej pracy, a nie od gotowości do niej.`}

## Co się dzieje przy niezdolności do pracy

${t?.przerwa ?? 'Koszty stałe biegną dalej, a klienci nie czekają.'}

## Ryzyka charakterystyczne dla zawodu

${ryzyka}

## Symulacja świadczenia

To jest wyliczenie szacunkowe, nie oferta. Realną składkę wylicza system
ubezpieczyciela po ocenie ryzyka.

- Dochód przyjęty do wyliczenia: ${zl(dochod)} miesięcznie
- Limit świadczenia przy kontrakcie B2B: 80%
- Miesięczne świadczenie z polisy: ${zl(w.swiadczenie)}
- Zasiłek ZUS przy podstawie ${zl(ZUS_MIESIECZNIE)}: ${zl(w.zus)}
- Szacowana składka miesięczna: ${zl(w.skladka)}
${pytania}
## Wyłączenia

Nieobjęte ochroną: wypalenie zawodowe jako samodzielna diagnoza, choroby
psychiczne, częściowa niezdolność do pracy, schorzenia leczone w ciągu
24 miesięcy przed zawarciem umowy.

## Zawody pokrewne

${pokrewneZawody}

## Dalsze kroki

- [Wniosek online](${SERWIS.url}/wniosek/?zawod=${z.slug})
- [Wszystkie zawody: ${z.kategoria}](${SERWIS.url}/zawody/${slugKategorii(z.kategoria)}/)
- [Indeks całego serwisu](${SERWIS.url}/llms.txt)

Operator: ${FIRMA.nazwaPelna}, agent ubezpieczeniowy w rejestrze KNF ${FIRMA.rpu}.
Kontakt: ${FIRMA.telefonWyswietlany}, ${FIRMA.email}.
`;

  return new Response(tekst, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
