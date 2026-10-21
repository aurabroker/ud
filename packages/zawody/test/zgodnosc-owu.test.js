/**
 * Zgodność treści zawodów z OWU i przepisami o zasiłku chorobowym.
 *
 * tresci.json to 188 tekstów pisanych pod cytowanie przez modele językowe,
 * więc zdanie niezgodne z warunkami wychodzi poza serwis. Ten test pilnuje
 * sformułowań, które już raz w nich stały i były nieprawdziwe:
 *
 * - „na B2B nie ma zasiłku" — jest, z dobrowolnej składki chorobowej
 *   (ustawa o sus art. 11 ust. 2), po 90 dniach i od zadeklarowanej podstawy;
 * - „zasiłek z etatu liczy się od podstawy ograniczonej ustawowo" — limit
 *   30-krotności dotyczy składek emerytalnej i rentowej, nie chorobowej;
 * - „choroby psychiczne wyłączone we wszystkich wariantach" — Leadenhall
 *   (LW044/046/047 § 9 ust. 5) wyłącza je, gdy są JEDYNĄ przyczyną, CEU
 *   (§ 8, § 13) bez tego zastrzeżenia;
 * - „dłuższy pobyt za granicą trzeba zgłosić" — obie karty produktu: ochrona
 *   na całym świecie;
 * - „ubezpieczyciel ocenia niezdolność częściową" — polisa płaci wyłącznie
 *   za całkowitą (LW044 § 15 ust. 2, CEU § 7 ust. 1);
 * - „warto pokazać dwa lata" — limit liczy się od przychodu z 12 miesięcy
 *   bezpośrednio przed zawarciem umowy (LW044 § 15 ust. 16, CEU § 6 ust. 2);
 * - „liczy się dochód, a nie obrót" — obie OWU mówią o przychodzie
 *   w rozumieniu ustawy o PIT;
 * - „karencja", „od pierwszego dnia", kwoty dzienne — patrz CLAUDE.md.
 *
 * Każda reguła ma przykład zdania, które kiedyś stało w pliku — test
 * sprawdza najpierw, że reguła ten przykład łapie. Bez tego wyrażenie
 * z literówką przechodziłoby na zielono, niczego nie pilnując.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRESCI } from '../src/tresc.js';

/** Wszystkie pola tekstowe: [slug, ścieżka pola, tekst]. */
function pola() {
  const out = [];
  for (const [slug, t] of Object.entries(TRESCI)) {
    for (const k of ['wstep', 'dochod', 'przerwa']) out.push([slug, k, t[k] ?? '']);
    (t.ryzyka ?? []).forEach((r, i) => {
      out.push([slug, `ryzyka[${i}].tytul`, r.tytul ?? '']);
      out.push([slug, `ryzyka[${i}].opis`, r.opis ?? '']);
    });
    (t.pytania ?? []).forEach((p, i) => {
      out.push([slug, `pytania[${i}].pytanie`, p.pytanie ?? '']);
      out.push([slug, `pytania[${i}].odpowiedz`, p.odpowiedz ?? '']);
    });
  }
  return out;
}

const zdania = (s) => s.split(/(?<=[.!?])\s+/);

/** Sformułowania zakazane w każdym polu. */
const ZAKAZANE = [
  {
    nazwa: '„karencja" zamiast „okres wyczekiwania"',
    re: /karencj/i,
    przyklad: 'Pojedyncza infekcja to zwykle za krótka niezdolność, żeby uruchomić świadczenie po karencji.',
  },
  {
    nazwa: 'świadczenie „od pierwszego dnia" (LW044 § 7 ust. 4 — okres wyczekiwania)',
    re: /(świadczeni|wypłat|polis|zasił)[^.]{0,80}od (pierwszego|1\.?) dnia|od (pierwszego|1\.?) dnia (niezdolności|choroby|zwolnienia)/i,
    przyklad: 'Polisa wypłaca do 80% dochodu, a świadczenie jest możliwe od pierwszego dnia niezdolności do pracy.',
  },
  {
    nazwa: 'okres odszkodowawczy jako minimum (LW044 § 15 ust. 9 — to MAKSYMALNY okres)',
    re: /(minimum|co najmniej|przynajmniej|nie krócej niż) (przez )?24 miesi/i,
    przyklad: 'Świadczenie wypłacane jest minimum przez 24 miesiące.',
  },
  {
    nazwa: 'kwota dzienna zamiast miesięcznej',
    re: /zł\s*(\/|na)\s*(dzień|dobę)|zł dziennie|dziennie do \d|\b2\s?240\s?zł|\b2\s?800\s?zł/i,
    przyklad: 'Świadczenie wynosi 120 zł / dzień.',
  },
  {
    nazwa: 'B2B / kontrakt „bez zasiłku" (ustawa o sus art. 11 ust. 2 — chorobowe dobrowolne)',
    re: /(B2B|kontrakc\p{L}*|kontrakt\p{L}*)[^.]{0,80}(nie ma|bez|zero)\s+(żadnego\s+)?(zasiłku|zabezpieczenia z ZUS|płatnego zwolnienia(?! w takiej formie))|zero zabezpieczenia z ZUS|nie ma zasiłku chorobowego|nie ma płatnego zwolnienia(?! w takiej formie)/iu,
    przyklad: 'Jednocześnie na B2B nie ma zasiłku chorobowego, więc polisa jest tu jedynym zabezpieczeniem.',
  },
  {
    nazwa: 'praktyka prywatna lekarza „bez zabezpieczenia z ZUS" (zasiłek z działalności od zadeklarowanej podstawy)',
    re: /(praktyk\p{L}*|gabinet\p{L}*|zabieg\p{L}* prywatn\p{L}*|porod\p{L}* prywatn\p{L}*|prowadzenie ciąż)[^.]{0,60}(nie ma\p{L}*|pozbawion\p{L}*|woln\p{L}* od)\s+(żadnego |jakiegokolwiek )?zabezpieczeni/iu,
    przyklad: 'Prowadzenie ciąż i porody prywatne nie mają żadnego zabezpieczenia z ZUS.',
  },
  {
    nazwa: 'zasiłek z etatu „od ograniczonej podstawy" (ustawa o sus art. 20 ust. 1 — bez limitu 30-krotności)',
    re: /(zasił\p{L}*|podstaw\p{L}* wymiaru)[^.]{0,80}(ograniczon\p{L}* ustawowo|jest ograniczona|nie od faktycznych zarobków|bywa znacznie niższa niż realne zarobki|nie obejmuje pełnej wysokości premii|rzadko odzwierciedla zarobki)/iu,
    przyklad: 'Zasiłek liczy się od podstawy wymiaru składek, która jest ograniczona ustawowo.',
  },
  {
    nazwa: '„objęte wyłącznie następstwa somatyczne" (LW044 § 9 ust. 5 — wyłączenie tylko przy jedynej przyczynie)',
    re: /objęte (są )?wyłącznie (następstwa|skutki) somatyczne/i,
    przyklad: 'Objęte są wyłącznie następstwa somatyczne, jeśli mają odrębne rozpoznanie.',
  },
  {
    nazwa: 'ochrona „niezależnie od przyczyny" (OWU mają wyłączenia: LW044 § 9, § 11, § 12; CEU § 18, § 19)',
    re: /niezależnie od (tego, co ją powoduje|jego przyczyny|jej przyczyny)|przed wszystkim poza tym jednym/i,
    przyklad: 'Chroniona jest niezdolność do wykonywania zawodu, niezależnie od tego, co ją powoduje.',
  },
  {
    nazwa: 'obowiązek zgłaszania pobytu za granicą (karty produktu: ochrona na całym świecie)',
    re: /(o ile|dopóki) (mieszkasz|pracujesz)[^.]{0,40}(z Polski|w Polsce|z terytorium Polski)|dłuższ\p{L}* (pobyt|pobyty|wyjazd\p{L}*)[^.]{0,80}(zgłosz|zgłasza|zgłosić|poinformować)|(zgłosić|zgłoszenia wymaga|wymaga zgłoszenia)[^.]{0,60}(pobyt|wyjazd)|krótkie wyjazdy[^.]{0,30}(tak|są objęte)/iu,
    przyklad: 'Nie, o ile pracujesz z Polski. Znaczenie ma dłuższy pobyt za granicą, który wymaga zgłoszenia.',
  },
  {
    nazwa: 'świadczenie za niezdolność częściową (LW044 § 15 ust. 2, CEU § 7 ust. 1 — tylko całkowita)',
    re: /ocenia niezdolność częściową|(sytuacja|przypadek|sytuacji|przypadku) niezdolności częściowej|może stanowić niezdolność częściową|nie przysługiwać w pełnej wysokości|przynajmniej w zakresie tej specjalizacji/i,
    przyklad: 'Wyklucza z chirurgii, ale nie z pracy ambulatoryjnej — i to jest sytuacja, w której ubezpieczyciel ocenia niezdolność częściową.',
  },
  {
    nazwa: 'uśrednianie kilku lat (LW044 § 15 ust. 16, CEU § 6 ust. 2 — 12 miesięcy przed zawarciem umowy)',
    re: /(pokaza|przedstawi|wykaza|przygotowa)\p{L}*[^.]{0,30}\b(dwa|trzy|dwóch|trzech)\b[^.]{0,15}\blat|średni\p{L}*[^.]{0,20}z dwóch[^.]{0,15}lat|przy (silnych )?wahaniach z dwóch lat|warto pokazać dwa\b/iu,
    przyklad: 'Przy silnych wahaniach warto pokazać dwa lata, żeby suma nie została wyliczona z przypadkowo słabego okresu.',
  },
  {
    nazwa: 'podstawą „dochód po kosztach" (LW044 § 15 ust. 16, CEU rozdz. XI pkt 13 — przychód w rozumieniu PIT)',
    re: /dochód, a nie obrót|podstaw\p{L}*[^.]{0,30}jest dochód|ile faktycznie z firmy wyjmujesz|zmienia sposób liczenia podstawy|forma opodatkowania nie wyklucza|po odjęciu (prowizji i )?kosztów|świadczenie miesięczne[^.]{0,40}liczone od Twojego średniego dochodu/iu,
    przyklad: 'Ubezpieczyciel liczy dochód, a nie obrót — więc po odjęciu prowizji i kosztów.',
  },
  {
    nazwa: 'dyskopatia przy dźwiganiu „zwykle wypadkiem" (LW044 § 15 ust. 8, CEU rozdz. XI pkt 3 — przyczyna zewnętrzna)',
    re: /wypadnięcie krążka[^.]{0,60}zwykle tak/i,
    przyklad: 'Nagłe wypadnięcie krążka przy podnoszeniu ciężaru zwykle tak.',
  },
];

/** Zdanie mówiące o „wszystkich wariantach" przy zaburzeniach psychicznych musi nieść regułę jedynej przyczyny. */
const PSYCHIKA = /psychi|psychiatr|wypaleni/i;
const KATEGORYCZNIE = /(we wszystkich wariantach|wszystkich wariantach|żaden z wariantów|żaden wariant|żadnym z wariantów|w żadnym wariancie|w żadnym z wariantów|w każdym wariancie)/i;
const ZASTRZEZENIE = /(jedyn|samodzieln|wyłącznie|\bsame\b|\bsam\b|\bsamo\b)/i;

function psychikaBezZastrzezenia(tekst) {
  if (!PSYCHIKA.test(tekst)) return [];
  return zdania(tekst).filter((z) => KATEGORYCZNIE.test(z) && !ZASTRZEZENIE.test(z));
}

/** Reguły dla par pytanie → odpowiedź. */
const PARY = [
  {
    nazwa: 'praca na wysokości: odpowiedź mówi o wyłączeniu w CEU (§ 18 pkt 2)',
    pytanie: /wysokoś|na dachu/i,
    odpowiedz: /CEU/,
    zly: ['Czy praca na dachu wyklucza mnie z ubezpieczenia?', 'Nie wyklucza, ale jest jednym z zawodów o wyższej ocenie ryzyka.'],
  },
  {
    nazwa: 'zmiany zwyrodnieniowe: odpowiedź mówi o trwałej niezdolności (LW044 § 9 ust. 4)',
    pytanie: /zwyrodn/i,
    odpowiedz: /trwał/i,
    zly: ['Zmiany zwyrodnieniowe narastają latami — czy będą objęte?', 'Decyduje moment rozpoznania i leczenia.'],
  },
  {
    nazwa: 'tantiemy: odpowiedź mówi, że CEU ich nie wlicza (rozdz. XI pkt 13 lit. d)',
    pytanie: /tantiem[^?]*(wlicza|liczą się|się liczy)/i,
    odpowiedz: /CEU/,
    zly: ['Mam tantiemy z licencji — czy wliczają się do dochodu?', 'Tak, jeśli są udokumentowane.'],
  },
  {
    nazwa: 'praca za granicą: odpowiedź mówi o ochronie na całym świecie',
    pytanie: /za granic|zagranic|z zagranicy/i,
    odpowiedz: /cał(y|ym) świ(at|ecie)/i,
    zly: ['Pracuję zdalnie z zagranicy — czy ochrona działa?', 'To zależy od wariantu i od tego, jak długo trwa pobyt.'],
  },
  {
    nazwa: 'niezdolność częściowa: odpowiedź mówi o wymogu całkowitej',
    pytanie: /częściow/i,
    odpowiedz: /całkowit/i,
    zly: ['Utrata widzenia w jednym oku — czy to niezdolność częściowa?', 'Wyklucza z chirurgii, ale nie z pracy ambulatoryjnej.'],
  },
];

test('każda reguła łapie zdanie, które kiedyś stało w pliku', () => {
  for (const r of ZAKAZANE) {
    assert.ok(r.re.test(r.przyklad), `reguła „${r.nazwa}" nie łapie własnego przykładu`);
  }
  assert.equal(psychikaBezZastrzezenia(
    'To ryzyko realne. Choroby psychiczne nie są objęte żadnym z wariantów polisy.').length, 1,
  'reguła o zaburzeniach psychicznych nie łapie zdania kategorycznego');
  assert.equal(psychikaBezZastrzezenia(
    'Wypalenie jako samodzielna diagnoza nie daje świadczenia w żadnym wariancie.').length, 0,
  'reguła o zaburzeniach psychicznych łapie zdanie z zastrzeżeniem');
  for (const r of PARY) {
    const [p, o] = r.zly;
    assert.ok(r.pytanie.test(p) && !r.odpowiedz.test(o), `reguła „${r.nazwa}" nie łapie własnego przykładu`);
  }
});

test('treści zawodów nie zawierają sformułowań niezgodnych z OWU i przepisami', () => {
  const bledy = [];
  for (const [slug, pole, tekst] of pola()) {
    for (const r of ZAKAZANE) {
      const m = tekst.match(r.re);
      if (m) bledy.push(`${slug}.${pole}: ${r.nazwa} — „${m[0]}"`);
    }
  }
  assert.deepEqual(bledy, [], `\n  ${bledy.join('\n  ')}`);
});

test('zaburzenia psychiczne: zdanie o wariantach niesie regułę jedynej przyczyny (LW044 § 9 ust. 5)', () => {
  const bledy = [];
  for (const [slug, pole, tekst] of pola()) {
    for (const z of psychikaBezZastrzezenia(tekst)) bledy.push(`${slug}.${pole}: „${z}"`);
  }
  assert.deepEqual(bledy, [], `\n  ${bledy.join('\n  ')}`);
});

test('odpowiedzi na pytania o wysokość, zwyrodnienia, tantiemy, zagranicę i niezdolność częściową', () => {
  const bledy = [];
  for (const [slug, t] of Object.entries(TRESCI)) {
    (t.pytania ?? []).forEach((p, i) => {
      for (const r of PARY) {
        if (r.pytanie.test(p.pytanie) && !r.odpowiedz.test(p.odpowiedz)) {
          bledy.push(`${slug}.pytania[${i}]: ${r.nazwa}`);
        }
      }
    });
  }
  assert.deepEqual(bledy, [], `\n  ${bledy.join('\n  ')}`);
});

test('zatrucie jako wypadek: tekst zastrzega, że CEU go nie uznaje (rozdz. XI pkt 3)', () => {
  const bledy = pola()
    .filter(([, , t]) => /zatruci/i.test(t) && /definicj\p{L}* nieszczęśliwego wypadku/iu.test(t) && !/CEU/.test(t))
    .map(([slug, pole]) => `${slug}.${pole}`);
  assert.deepEqual(bledy, []);
});
