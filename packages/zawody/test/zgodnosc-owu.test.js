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
 *   w rozumieniu ustawy o PIT; tak samo „przychód … po odjęciu prowizji
 *   i paliwa" (21.10.2026, taksówkarz);
 * - „karencja", „od pierwszego dnia", kwoty dzienne — patrz CLAUDE.md.
 *
 * Reguły z przeglądu z 21.10.2026:
 * - „rozpoznania z kręgu psychicznego są z ochrony wyłączone" — każde zdanie
 *   o wyłączeniu chorób psychicznych, nie tylko to o „wariantach", ma nieść
 *   regułę jedynej przyczyny (albo mówić wyłącznie o CEU);
 * - zwyrodnienia „najwyżej przez 24 miesiące" w zawodzie medycznym — to
 *   LW044; w Medica i Medicare (LW046/LW047 § 7 ust. 2) świadczenie wynosi
 *   najwyżej 30% kwoty z polisy i trwa najwyżej 12 miesięcy;
 * - tantiemy i udział w zyskach z gry: odpowiedź mówi, że CEU ich nie wlicza
 *   (rozdz. XI § 29 pkt 13 lit. a, d);
 * - „wypłata z zysku spółki to przychód z kapitału" — tylko dywidenda ze spółki
 *   kapitałowej; udział wspólnika spółki osobowej to przychód z działalności
 *   (art. 5b ust. 2, art. 8 ust. 1 PIT);
 * - „obu ubezpieczycieli", „oba towarzystwa", „zależy od ubezpieczyciela" —
 *   ubezpieczyciel jest jeden: Lloyd’s Insurance Company S.A.; Leadenhall
 *   i CEU to coverholderzy Lloyd’s (karty produktu, LW044 § 1 ust. 3, OWU CEU
 *   § 1 ust. 2).
 *
 * Każda reguła ma przykład zdania, które kiedyś stało w pliku — test
 * sprawdza najpierw, że reguła ten przykład łapie. Bez tego wyrażenie
 * z literówką przechodziłoby na zielono, niczego nie pilnując. Reguły
 * z 21.10.2026 mają też przykłady poprawnych zdań (`dobre`), których łapać
 * nie wolno — inaczej reguła zbyt szeroka wymuszałaby psucie treści.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRESCI } from '../src/tresc.js';
import { ZAWODY } from '../src/index.js';

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
  {
    nazwa: '„przychód" nazwany kwotą po kosztach (LW044 § 15 ust. 16, CEU rozdz. XI pkt 13)',
    // VAT i — przy usługach materialnych w CEU — towary, materiały i części
    // naprawdę pomniejszają przychód (CEU § 29 pkt 13 ppkt 2, lit. b).
    re: /przych\p{L}*[^.]{0,80}po odjęciu(?!\s+(?:VAT|podatku VAT|kosztów zakupu towarów|materiałów))/iu,
    przyklad: 'Przychód powstaje z pojedynczych kursów, rozliczanych tego samego dnia, po odjęciu prowizji aplikacji i paliwa.',
    dobre: [
      'Pieniądze wpływają z pojedynczych kursów, rozliczanych tego samego dnia, a od razu odchodzą od nich prowizja aplikacji i paliwo.',
      'CEU liczy przychód po odjęciu VAT.',
    ],
  },
  {
    nazwa: '„zysk spółki to przychód z kapitału" bez zastrzeżenia, że chodzi o spółkę kapitałową (art. 5b ust. 2, art. 8 ust. 1 PIT)',
    re: /zysk\p{L}* spółki(?!\s+kapitałow)[^.]{0,60}przych\p{L}* z (?:tytułu inwestowania )?(?:własnego )?kapitał/iu,
    przyklad: 'Wypłata z zysku spółki to jednak przychód z kapitału, a nie z wykonywania zawodu.',
    dobre: ['Dywidenda ze spółki kapitałowej to przychód z kapitału, a nie z wykonywania zawodu.'],
  },
  {
    nazwa: 'Leadenhall i CEU jako dwaj ubezpieczyciele (ubezpieczyciel to Lloyd’s Insurance Company S.A., oni są coverholderami)',
    re: /(?<!\p{L})(?:ob(?:a|aj|u|ydwa|ydwaj|ydwu|ydwóch)|dw(?:a|aj|u|óch)|każd\p{L}*\s+z|żadn\p{L}*\s+z)\s+(?:ubezpieczyc|towarzystw)|zależ\p{L}*\s+od\s+(?:ubezpieczyc|towarzystw)|(?:ubezpieczyciel|towarzystw)\p{L}*\s+(?:Leadenhall|CEU)|(?:Leadenhall|CEU)\s+(?:to|jako|jest)\s+(?:ubezpieczyciel|towarzystw)|towarzystw\p{L}*\s+ubezpiecze/iu,
    przyklad: [
      'Działa — warunki obu ubezpieczycieli obejmują ochroną cały świat, całą dobę.',
      'Ochrona obejmuje cały świat, ale oba towarzystwa wyłączają szkody spowodowane wojną.',
      'To zależy od ubezpieczyciela.',
    ],
    dobre: [
      'Działa — warunki Leadenhall i CEU obejmują ochroną cały świat.',
      'Rzeczoznawca budowlany wydaje opinie, na których opierają się sądy, ubezpieczyciele i organy nadzoru.',
      'Trzeba tylko pamiętać, że ubezpieczyciel może wezwać na badanie u swojego lekarza.',
    ],
  },
];

/**
 * Wyłączenie chorób psychicznych: każde zdanie, które o nim mówi, niesie regułę
 * jedynej przyczyny (LW044/046/047 § 9 ust. 5) albo mówi wyłącznie o CEU
 * (§ 8, § 13 — tam zastrzeżenia nie ma). Szersze niż PSYCHIKA niżej: tamta
 * reguła reagowała tylko na zwroty o „wariantach", więc „są z ochrony
 * wyłączone", „pozostają poza ochroną" czy „nie są objęte" przechodziły.
 */
const PSY_ZDANIE = /psychiczn|psychiatryczn|kręgu psych|depresj|nerwic|lękow|wypaleni/iu;
const PSY_BEZ_WYPALENIA = /psychiczn|psychiatryczn|kręgu psych|depresj|nerwic|lękow/iu;
const PSY_WYLACZONE = /wyłącz|poza (?:ochron|zakres)|nie (?:są|jest|będą|będzie) objęt|nie obejmuj|nie daj\p{L}* (?:świadczeni|wypłat)|nie wypłac|nie płac/iu;
const PSY_JEDYNA = /jedyn|wyłącznie|(?<!\p{L})sam(?:a|e|o|i|ą|ej|ych)?(?!\p{L})|samodzieln|tylko (?:one|on|ona|ono)(?!\p{L})/iu;
/** „Wypalenie jako samodzielna diagnoza" to zastrzeżenie o wypaleniu, nie o chorobach psychicznych. */
const WYPALENIE_SAMODZIELNE = /wypaleni\p{L}*(?:\s+zawodow\p{L}*)?\s+jako\s+samodzieln\p{L}*\s+diagnoz\p{L}*/giu;

function psychikaBezJedynejPrzyczyny(zdanie) {
  if (!PSY_ZDANIE.test(zdanie) || !PSY_WYLACZONE.test(zdanie)) return false;
  const reszta = zdanie.replace(WYPALENIE_SAMODZIELNE, '');
  // Zdanie o samym wypaleniu „jako samodzielnej diagnozie" ma już zastrzeżenie.
  if (reszta !== zdanie && !PSY_BEZ_WYPALENIA.test(reszta)) return false;
  if (PSY_JEDYNA.test(reszta)) return false;
  // Zdanie wyłącznie o CEU — tam wyłączenie nie ma zastrzeżenia o jedynej przyczynie.
  if (/CEU/.test(reszta) && !/Leadenhall|wariant|polis|każd|wszystk|żadn/iu.test(reszta)) return false;
  return true;
}

/**
 * Zwyrodnienia w zawodach medycznych. Serwis kieruje je do Medica (lekarze,
 * dentyści) i Medicare (personel medyczny) — /jak-to-dziala/. Tam świadczenie
 * okresowe z powodu choroby zwyrodnieniowej wynosi najwyżej 30% kwoty z polisy
 * i trwa najwyżej 12 miesięcy (LW046/LW047 § 7 ust. 2). „24 miesiące" to LW044
 * § 7 ust. 2 — w zawodzie medycznym zdanie z tą liczbą musi powiedzieć, którego
 * wariantu dotyczy.
 */
const MEDYCZNE = new Set(['Medycyna', 'Stomatologia', 'Pielęgniarstwo']);
const LIMIT_24 = /(?:przez|najwyżej|maksymalnie|do|dłużej niż)\s+24\s+miesi/iu;
const WARIANT_MEDYCZNY = /Medica|Medicare|30\s?%|12 miesi|LW044|wariant\p{L}* ogóln/iu;

function zwyrodnieniaBezWariantu(tekst) {
  if (!/zwyrodn/iu.test(tekst)) return [];
  return zdania(tekst).filter((z) => LIMIT_24.test(z) && !WARIANT_MEDYCZNY.test(z));
}

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
    nazwa: 'tantiemy i udział w zyskach z gry: odpowiedź mówi, że CEU ich nie wlicza (rozdz. XI pkt 13 lit. a, d)',
    // Do 21.10.2026 reguła wymagała w pytaniu „wlicza / liczy się", więc
    // „jak wykazać dochód?" muzyka i „udział w zyskach z gry" przechodziły.
    // „Udział w zysku lokalu" (szef kuchni) to wynagrodzenie za pracę — nie łapiemy.
    pytanie: /tantiem|udział\p{L}* w zyskach z/iu,
    odpowiedz: /CEU/,
    zly: ['Mam tantiemy z licencji — czy wliczają się do dochodu?', 'Tak, jeśli są udokumentowane.'],
    zle: [
      ['Mam koncerty, lekcje i tantiemy — jak wykazać dochód?', 'Sumujesz wszystkie źródła z rozliczenia rocznego. Tantiemy warto wykazać osobno, bo płyną dalej mimo przerwy.'],
      ['Mam udział w zyskach z gry — czy to wchodzi do dochodu?', 'Wchodzi dopiero po wypłacie i rozliczeniu, bo suma liczy się od dochodu udokumentowanego.'],
    ],
    dobre: ['Mam udział w zysku lokalu — czy to liczy się do dochodu?'],
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
    for (const p of [].concat(r.przyklad)) {
      assert.ok(r.re.test(p), `reguła „${r.nazwa}" nie łapie własnego przykładu: „${p}"`);
    }
    for (const d of r.dobre ?? []) {
      assert.ok(!r.re.test(d), `reguła „${r.nazwa}" łapie poprawne zdanie: „${d}"`);
    }
  }
  assert.equal(psychikaBezZastrzezenia(
    'To ryzyko realne. Choroby psychiczne nie są objęte żadnym z wariantów polisy.').length, 1,
  'reguła o zaburzeniach psychicznych nie łapie zdania kategorycznego');
  assert.equal(psychikaBezZastrzezenia(
    'Wypalenie jako samodzielna diagnoza nie daje świadczenia w żadnym wariancie.').length, 0,
  'reguła o zaburzeniach psychicznych łapie zdanie z zastrzeżeniem');
  for (const r of PARY) {
    for (const [p, o] of [r.zly, ...(r.zle ?? [])]) {
      assert.ok(r.pytanie.test(p) && !r.odpowiedz.test(o), `reguła „${r.nazwa}" nie łapie przykładu: „${p}"`);
    }
    for (const p of r.dobre ?? []) {
      assert.ok(!r.pytanie.test(p), `reguła „${r.nazwa}" łapie pytanie, którego nie powinna: „${p}"`);
    }
  }
});

test('reguła jedynej przyczyny i reguła zwyrodnień łapią zdania, które stały w pliku do 21.10.2026', () => {
  const zle = [
    'Ten układ obciąża szczególnie mocno, a rozpoznania z kręgu psychicznego są z ochrony wyłączone.',
    'Choroby psychiczne — ryzyko realne, ale wyłączone',
    'Ekspozycja na konflikt jest w tej roli stała, a diagnozy z kręgu psychicznego pozostają poza ochroną.',
    'Objęte są następstwa fizyczne; ewentualne skutki psychiczne pozostają poza zakresem ochrony.',
    // „samodzielna" dotyczy tu wypalenia, nie chorób psychicznych:
    'Trzeba to powiedzieć wprost: żaden z wariantów polisy nie obejmuje chorób psychicznych ani wypalenia zawodowego jako samodzielnej diagnozy.',
    'Wypalenie zawodowe jako samodzielna diagnoza, choroby psychiczne, częściowa niezdolność do pracy i schorzenia leczone w ciągu 24 miesięcy przed zawarciem umowy nie są objęte ochroną.',
  ];
  for (const z of zle) assert.ok(psychikaBezJedynejPrzyczyny(z), `reguła jedynej przyczyny nie łapie: „${z}"`);
  const dobre = [
    'Rozpoznanie z kręgu chorób psychicznych, które jako jedyne nie pozwala pracować, jest z ochrony wyłączone.',
    'Ekspozycja na konflikt jest w tej roli stała, a diagnoza z kręgu psychicznego pozostaje poza ochroną, kiedy sama nie pozwala pracować; CEU wyłącza ją nawet bez tego zastrzeżenia.',
    'CEU wyłącza niezdolność, której przyczyną było rozpoznanie psychiatryczne, bez tego zastrzeżenia.',
    'Wypalenie jako samodzielna diagnoza nie daje świadczenia w żadnym wariancie.',
    'Depresja i zaburzenia lękowe są w tej branży statystycznie częstsze niż urazy fizyczne.',
  ];
  for (const z of dobre) assert.ok(!psychikaBezJedynejPrzyczyny(z), `reguła jedynej przyczyny łapie poprawne zdanie: „${z}"`);

  assert.equal(zwyrodnieniaBezWariantu(
    'W Leadenhall choroba zwyrodnieniowa daje ponadto świadczenie okresowe najwyżej przez 24 miesiące i nie daje świadczenia z tytułu trwałej niezdolności.').length, 1,
  'reguła zwyrodnień nie łapie „najwyżej przez 24 miesiące" bez wariantu');
  assert.equal(zwyrodnieniaBezWariantu(
    'Choroba zwyrodnieniowa ma w Leadenhall własne granice: w wariancie Medica dla lekarzy świadczenie okresowe z jej powodu wynosi najwyżej 30% kwoty z polisy i trwa najwyżej 12 miesięcy. Warunkiem jest też, żeby schorzenie nie było konsultowane ani leczone w ciągu 24 miesięcy przed początkiem ochrony.').length, 0,
  'reguła zwyrodnień łapie zdanie o Medica albo o 24 miesiącach przed ochroną');
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

test('zaburzenia psychiczne: każde zdanie o wyłączeniu niesie regułę jedynej przyczyny (LW044/046/047 § 9 ust. 5, CEU § 8, § 13)', () => {
  const bledy = [];
  for (const [slug, pole, tekst] of pola()) {
    for (const z of zdania(tekst)) {
      if (psychikaBezJedynejPrzyczyny(z)) bledy.push(`${slug}.${pole}: „${z}"`);
    }
  }
  assert.deepEqual(bledy, [], `\n  ${bledy.join('\n  ')}`);
});

test('zwyrodnienia w zawodach medycznych: Medica/Medicare — 30% i 12 miesięcy, nie 24 (LW046/LW047 § 7 ust. 2)', () => {
  const kategoria = Object.fromEntries(ZAWODY.map((z) => [z.slug, z.kategoria]));
  // Bez tej kontroli literówka w nazwie kategorii wyłączyłaby regułę po cichu.
  for (const k of MEDYCZNE) {
    assert.ok(ZAWODY.some((z) => z.kategoria === k), `nie ma kategorii „${k}" — reguła zwyrodnień nic by nie sprawdzała`);
  }
  const bledy = [];
  for (const [slug, pole, tekst] of pola()) {
    if (!MEDYCZNE.has(kategoria[slug])) continue;
    for (const z of zwyrodnieniaBezWariantu(tekst)) bledy.push(`${slug}.${pole}: „${z}"`);
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
