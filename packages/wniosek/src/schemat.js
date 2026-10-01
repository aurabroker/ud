/**
 * schemat.js — definicja wniosku: kroki, pola, walidacja.
 *
 * Wniosek zbiera dane, po których ubezpieczyciel wycenia ryzyko, więc jego
 * kształt jest wspólny dla portalu (zbiera) i panelu (wyświetla i wycenia).
 * Trzymanie go w jednym miejscu jest jedynym sposobem, żeby nazwa pola po
 * obu stronach znaczyła to samo — nazwy pól są tu identyczne jak w starym
 * formularzu, bo pod nimi siedzą kolumny w ud_clients i parser ofert.
 *
 * KOLEJNOŚĆ KROKÓW MA ZNACZENIE: zakres ochrony stoi PRZED stanem zdrowia,
 * bo suma trwałej niezdolności powyżej miliona złotych wyzwala rozszerzoną
 * ankietę medyczną. W starym formularzu było odwrotnie — pytanie wyzwalające
 * padało po tym, co wyzwala.
 */
import {
  HEALTH_SURVEY_THRESHOLD, HEALTH_SURVEY_ITEMS, surveyRequired, parseSum,
} from './ankieta.js';

export { HEALTH_SURVEY_THRESHOLD, surveyRequired, parseSum };

/** Maksymalny udział dochodu objęty ochroną — zależy od formy zatrudnienia. */
export const LIMIT_DOCHODU = {
  b2b: 0.8,
  uop: 0.65,
  zlecenie: 0.65,
};

export const FORMY_ZATRUDNIENIA = [
  { wartosc: 'b2b',      etykieta: 'Samozatrudnienie (B2B / JDG)' },
  { wartosc: 'uop',      etykieta: 'Umowa o pracę' },
  { wartosc: 'zlecenie', etykieta: 'Umowa zlecenie / o dzieło' },
];

export const FORMY_OPODATKOWANIA = [
  { wartosc: 'zasady_ogolne',  etykieta: 'Zasady ogólne (skala podatkowa)' },
  { wartosc: 'liniowy',        etykieta: 'Podatek liniowy (19%)' },
  { wartosc: 'ryczalt',        etykieta: 'Ryczałt od przychodów ewidencjonowanych' },
  { wartosc: 'karta_podatkowa',etykieta: 'Karta podatkowa' },
];

/** Podstawowa ankieta medyczna — siedem pytań, każde TAK wymaga opisu. */
export const PYTANIA_MEDYCZNE = [
  { klucz: 'med_heart',    etykieta: 'Problemy z sercem, nadciśnienie, bóle w klatce piersiowej?' },
  { klucz: 'med_diabetes', etykieta: 'Cukrzyca, problemy z nerkami, prostatą lub układem moczowym?' },
  { klucz: 'med_bones',    etykieta: 'Problemy z kręgosłupem, stawami, układem kostnym?' },
  { klucz: 'med_stomach',  etykieta: 'Choroby żołądka, jelit, wątroby lub trzustki?' },
  { klucz: 'med_neuro',    etykieta: 'Choroby neurologiczne, psychiczne lub zaburzenia lękowe?' },
  { klucz: 'med_surgery',  etykieta: 'Operacje chirurgiczne lub stałe leki?' },
  { klucz: 'med_aids',     etykieta: 'Testy w związku z AIDS / HIV?' },
];

/** Aktywności podwyższonego ryzyka. Wpływają na ocenę, nie wykluczają z automatu. */
/**
 * Aktywności podwyższonego ryzyka.
 *
 * Piętnaście pozycji, tyle samo, ile kolumn `risk_*` ma tabela ud_clients
 * i tyle samo, ile mapuje funkcja form-submit. Stary formularz pokazywał
 * osiem: łączył jazdę konną ze skokami przez przeszkody i kolarstwo
 * grawitacyjne z raftingiem, a lotnictwa, balonu, spadochroniarstwa,
 * paralotniarstwa i quadów nie miał wcale. Underwriter dostawał więc puste
 * pole tam, gdzie klient mógł mieć „tak" — i to jest ten rodzaj braku,
 * który wychodzi dopiero przy odmowie wypłaty.
 *
 * Kolejność od najczęstszych do najrzadszych, żeby dało się przejrzeć listę
 * wzrokiem i nie klikać przez rzeczy, których nikt nie uprawia.
 */
export const AKTYWNOSCI_RYZYKOWNE = [
  { klucz: 'risk_climbing',          etykieta: 'Wspinaczka wysokogórska' },
  { klucz: 'risk_caving',            etykieta: 'Eksploracja jaskiń' },
  { klucz: 'risk_diving',            etykieta: 'Nurkowanie głębokie lub jaskiniowe' },
  { klucz: 'risk_skiing',            etykieta: 'Narciarstwo poza trasami' },
  { klucz: 'risk_gravity_bike',      etykieta: 'Kolarstwo grawitacyjne (downhill, enduro)' },
  { klucz: 'risk_extreme_bike_boat', etykieta: 'Rafting i kajakarstwo górskie' },
  { klucz: 'risk_sailing',           etykieta: 'Żeglarstwo morskie (załoga)' },
  { klucz: 'risk_horse',             etykieta: 'Jazda konna' },
  { klucz: 'risk_horse_jumping',     etykieta: 'Skoki przez przeszkody konne' },
  { klucz: 'risk_quad',              etykieta: 'Quady i sporty motorowe' },
  { klucz: 'risk_skydiving',         etykieta: 'Spadochroniarstwo' },
  { klucz: 'risk_paragliding',       etykieta: 'Paralotniarstwo i lotniarstwo' },
  { klucz: 'risk_balloon',           etykieta: 'Loty balonem' },
  { klucz: 'risk_aviation',          etykieta: 'Lotnictwo — pilot lub członek załogi' },
  { klucz: 'risk_hunting',           etykieta: 'Łowiectwo z użyciem broni' },
];

/**
 * Trzy ryzyka główne.
 *
 * „Okresowa niezdolność do pracy" jest ryzykiem PODSTAWOWYM (`podstawowe`) —
 * to ona jest ubezpieczeniem utraty dochodu, a dwa pozostałe ryzyka tylko ją
 * rozszerzają. Polisy bez niej nie ma, więc kreator trzyma ją zaznaczoną na
 * stałe, a `sprawdzKrok` nie przepuszcza zakresu bez niej. Wcześniej wszystkie
 * trzy startowały puste i wystarczało „dowolne jedno" — 28.09.2026 przeszedł
 * tak wniosek z samą śmiercią / inwalidztwem.
 */
export const RYZYKA = [
  {
    klucz: 'riskDeathInvalidity',
    poleSumy: 'nwDeathSum',
    etykieta: 'Śmierć / inwalidztwo w wyniku nieszczęśliwego wypadku',
    rodzaj: 'Jednorazowe świadczenie',
    podpowiedz: 'Zaokrąglana do pełnych tysięcy złotych.',
  },
  {
    klucz: 'riskTempIncapacity',
    poleSumy: 'tempIncapacitySum',
    etykieta: 'Okresowa niezdolność do pracy',
    rodzaj: 'Miesięczne świadczenie',
    podstawowe: true,
    podpowiedz: 'Maksymalnie {limit}% średniorocznych przychodów netto.',
  },
  {
    klucz: 'riskPermIncapacity',
    poleSumy: 'permIncapacitySum',
    etykieta: 'Trwała niezdolność do pracy',
    rodzaj: 'Jednorazowe świadczenie',
    podpowiedz: 'Maksymalnie 10× roczne przychody. Zaokrąglana do tysięcy.',
  },
];

/**
 * Próg, powyżej którego ubezpieczyciel udostępnia klauzule dodatkowe.
 *
 * Klauzule NW są rozszerzeniem ryzyka „śmierć / inwalidztwo", a nie osobnym
 * produktem — mają sens dopiero przy sumie, która sama w sobie jest istotna.
 * Poniżej progu ubezpieczyciel ich nie oferuje, więc formularz nie ma prawa
 * ich pokazywać: zebranie wyboru, którego nie da się zrealizować, kończy się
 * ofertą inną niż to, co klient widział na ekranie.
 */
export const PROG_KLAUZUL_NW = 300_000;

/** Czy przy obecnym zakresie klauzule dodatkowe są w ogóle dostępne. */
export function klauzuleDostepne(dane) {
  if (!dane?.riskDeathInvalidity) return false;
  const suma = parseSum(dane.nwDeathSum);
  return suma != null && suma > PROG_KLAUZUL_NW;
}

/** Klauzule dodatkowe w ramach ubezpieczenia następstw nieszczęśliwych wypadków. */
export const KLAUZULE_NW = [
  { klucz: 'nwFuneral',           etykieta: 'Świadczenie pogrzebowe',
    kwoty: [0, 5000, 10000, 15000, 20000, 25000] },
  { klucz: 'nwAdaptation',        etykieta: 'Dostosowanie do życia w niepełnosprawności',
    kwoty: [0, 10000, 20000, 30000, 40000, 50000, 100000, 150000, 200000] },
  { klucz: 'nwHospitalDaily',     etykieta: 'Dzienne świadczenie szpitalne',
    kwoty: [0, 100, 200, 300, 400, 500], naDzien: true },
  { klucz: 'nwMedicalCosts',      etykieta: 'Świadczenie do kosztów medycznych',
    kwoty: [0, 500, 1000, 2500, 5000, 10000] },
  { klucz: 'nwUnconsciousWeekly', etykieta: 'Tygodniowe świadczenie z tytułu nieprzytomności',
    kwoty: [0, 100, 250, 500, 1000], naTydzien: true },
];

/**
 * Kroki wniosku. `opis` mówi, jakie dane zbiera dany krok — używa go kreator
 * jako podtytułu, a klauzula informacyjna RODO jako wyliczenia kategorii
 * danych. Trzymanie tego w jednym miejscu jest wymogiem praktycznym:
 * rozjazd między formularzem a klauzulą to naruszenie obowiązku
 * informacyjnego z art. 13 RODO.
 */
export const KROKI = [
  { id: 'kontakt', tytul: 'Kontakt',
    opis: 'imię i nazwisko, adres e-mail, numer telefonu oraz — jeśli ją zaznaczysz — zgoda na kontakt w sprawie wniosku' },
  { id: 'dane',    tytul: 'Dane podstawowe',
    opis: 'PESEL, zawód, forma zatrudnienia i opodatkowania, wysokość dochodu' },
  { id: 'zakres',  tytul: 'Zakres ochrony',
    opis: 'wybrane ryzyka, sumy ubezpieczenia i okres wypłaty świadczenia' },
  { id: 'zdrowie', tytul: 'Stan zdrowia',
    opis: 'ankieta medyczna — dane szczególnej kategorii, przetwarzane wyłącznie za wyraźną zgodą' },
  { id: 'zgody',   tytul: 'Zgody',
    opis: 'zaznaczone zgody i potwierdzenia' },
];

/**
 * Liczba kroków słowami, z poprawną odmianą — do tekstów, które nie mogą się
 * rozjechać z KROKI („cztery kroki”, „pięć kroków”). Liczba kroków była wpisana
 * na sztywno w kilku miejscach i przy dodaniu kroku `kontakt` wszystkie trzeba
 * było poprawiać ręcznie; stąd jedno źródło prawdy.
 */
export function krokiSlownie(n = KROKI.length) {
  const slowa = { 2: 'dwa', 3: 'trzy', 4: 'cztery', 5: 'pięć', 6: 'sześć', 7: 'siedem', 8: 'osiem' };
  const rzeczownik = n >= 2 && n <= 4 ? 'kroki' : 'kroków';
  return `${slowa[n] ?? n} ${rzeczownik}`;
}

/**
 * Zgoda na kontakt w sprawie niedokończonego wniosku — osobny checkbox w kroku
 * `kontakt`, domyślnie NIEZAZNACZONY i niewarunkujący dalszej części wniosku.
 *
 * E-mail zachęcający do dokończenia wniosku to marketing bezpośredni (art. 398
 * Prawa komunikacji elektronicznej) i wymaga uprzedniej zgody — także na telefon.
 * Bez zgody szkic wniosku służy wyłącznie lejkowi: ani imienia, ani e-maila,
 * ani telefonu nie zapisujemy.
 *
 * `wersja` idzie do funkcji brzegowej `wniosek-szkic`, a TREŚĆ do bazy dopisuje
 * ona sama z własnej mapy wersja → tekst (rozliczalność, art. 7 ust. 1 RODO).
 * Zmiana treści = NOWA wersja w obu miejscach; test/szkice.spec.js pilnuje, żeby
 * tekst tu i w funkcji był ten sam.
 *
 * Treść wersji `v1-2026-10` zaakceptował prawnik bez zmian (potwierdzenie
 * właściciela, 01.10.2026); zadanie `wnioski-przypomnienia` w pg_cron jest od tego
 * dnia włączone (patrz migracja 20261001101112_wnioski_szkice.sql). Zmiana treści
 * wymaga nowej wersji i nowej akceptacji — wtedy wyłącz zadanie do jej uzyskania.
 */
export const ZGODA_KONTAKT = {
  wersja: 'v1-2026-10',
  tresc: 'Zgadzam się na kontakt e-mailowy i telefoniczny ze strony Aura Expert sp. z o.o. '
    + 'w sprawie mojego wniosku — także wtedy, gdy go nie dokończę. Zgodę mogę wycofać w każdej chwili.',
};

/* ── Walidacja ───────────────────────────────────────────────────────────── */

/**
 * PESEL — suma kontrolna, nie sama długość.
 *
 * Literówka w PESEL-u zatrzymuje wniosek u ubezpieczyciela na kilka dni,
 * bo wychodzi dopiero przy weryfikacji. Sprawdzenie cyfry kontrolnej po
 * stronie przeglądarki kosztuje nic i łapie większość pomyłek od razu.
 */
export function pesekPoprawny(pesel) {
  const s = String(pesel ?? '').trim();
  if (!/^\d{11}$/.test(s)) return false;
  const wagi = [9, 7, 3, 1, 9, 7, 3, 1, 9, 7];
  const suma = wagi.reduce((acc, w, i) => acc + w * Number(s[i]), 0);
  return suma % 10 === Number(s[10]);
}

/** Data urodzenia z PESEL-u — miesiąc koduje też stulecie. */
export function dataZPesel(pesel) {
  if (!pesekPoprawny(pesel)) return null;
  const s = String(pesel);
  const rr = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const dd = Number(s.slice(4, 6));
  const stulecia = { 0: 1900, 1: 2000, 2: 2100, 3: 2200, 4: 1800 };
  const baza = stulecia[Math.floor(mm / 20)];
  if (baza === undefined) return null;
  const d = new Date(Date.UTC(baza + rr, (mm % 20) - 1, dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Wiek w pełnych latach na dziś. */
export function wiekZPesel(pesel, dzis = new Date()) {
  const d = dataZPesel(pesel);
  if (!d) return null;
  let wiek = dzis.getUTCFullYear() - d.getUTCFullYear();
  const m = dzis.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && dzis.getUTCDate() < d.getUTCDate())) wiek -= 1;
  return wiek;
}

/** Telefon polski — dziewięć cyfr, z opcjonalnym prefiksem kierunkowym. */
export function telefonPoprawny(tel) {
  const cyfry = String(tel ?? '').replace(/[\s()-]/g, '');
  return /^(?:\+?48)?\d{9}$/.test(cyfry);
}

export function emailPoprawny(email) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(email ?? '').trim());
}

/**
 * Sprawdza jeden krok. Zwraca mapę pole → komunikat; pusty obiekt znaczy „można dalej".
 * Komunikaty są po polsku i mówią, co zrobić, a nie co jest nie tak.
 */
export function sprawdzKrok(krok, dane) {
  const bledy = {};
  const wymagane = (pole, komunikat) => {
    if (!String(dane[pole] ?? '').trim()) bledy[pole] = komunikat;
  };

  // Krok `kontakt` jest pierwszy: kto odpadnie później, zostawia tu e-mail
  // i telefon. Zgoda na kontakt (`zgodaKontakt`) jest OPCJONALNA i niczego tu
  // nie blokuje — niezaznaczona znaczy tylko, że nie dzwonimy i nie piszemy
  // o niedokończonym wniosku.
  if (krok === 'kontakt') {
    wymagane('fullName', 'Podaj imię i nazwisko.');
    if (!emailPoprawny(dane.email)) bledy.email = 'Podaj adres e-mail, na który wyślemy ofertę.';
    if (!telefonPoprawny(dane.phone)) bledy.phone = 'Podaj numer telefonu — dziewięć cyfr.';
  }

  if (krok === 'dane') {
    wymagane('profession', 'Wybierz zawód z listy albo wpisz własny.');
    if (!pesekPoprawny(dane.pesel)) {
      bledy.pesel = 'PESEL ma 11 cyfr i musi się zgadzać z cyfrą kontrolną.';
    } else {
      const wiek = wiekZPesel(dane.pesel);
      if (wiek !== null && (wiek < 18 || wiek > 65)) {
        bledy.pesel = `Ochrona obejmuje osoby od 18 do 65 lat, a z PESEL-u wychodzi ${wiek}.`;
      }
    }
  }

  if (krok === 'zakres') {
    const wybrane = RYZYKA.filter((r) => dane[r.klucz]);
    // Klauzula wybrana, a potem próg przestał być spełniony — to nie jest błąd
    // użytkownika, tylko stan, który wyzeruje zerujKlauzule() przed wysyłką.

    const brakPodstawowego = RYZYKA.find((r) => r.podstawowe && !dane[r.klucz]);
    if (brakPodstawowego) {
      bledy.ryzyka = `„${brakPodstawowego.etykieta}" to ryzyko podstawowe — polisa zawsze je obejmuje. `
        + 'Pozostałe ryzyka możesz do niego dołożyć.';
    }
    for (const r of wybrane) {
      const suma = Number(dane[r.poleSumy]);
      if (!Number.isFinite(suma) || suma <= 0) {
        bledy[r.poleSumy] = 'Wpisz kwotę.';
      }
    }
  }

  if (krok === 'zdrowie') {
    for (const p of PYTANIA_MEDYCZNE) {
      if (dane[p.klucz] === 'yes' && !String(dane[`${p.klucz}_notes`] ?? '').trim()) {
        bledy[`${p.klucz}_notes`] = 'Przy odpowiedzi „tak" opisz krótko, czego dotyczy.';
      }
    }
    // Ankieta rozszerzona pyta o te same rzeczy co panel przy ręcznym wprowadzaniu,
    // a panel wymaga opisu przy każdym „tak". Samo „tak" przy pozycji „inna,
    // niewymieniona wcześniej choroba" nie jest informacją — underwriter i tak
    // odbije wniosek, tylko dzień później i przez agenta.
    if (ankietaRozszerzona(dane)) {
      for (const poz of HEALTH_SURVEY_ITEMS) {
        // Brak odpowiedzi musi zatrzymać wniosek tutaj. Gdyby przeszedł dalej,
        // doWysylki() wystawiłby „nie" — bo puste nie jest „tak" — i klient
        // złożyłby oświadczenie, którego nie złożył. Panel przy ręcznym
        // wprowadzaniu odrzuca to samo i tym samym komunikatem.
        if (dane[poz.key] !== 'yes' && dane[poz.key] !== 'no') {
          bledy[poz.key] = 'Odpowiedz „tak" albo „nie".';
          continue;
        }
        if (dane[poz.key] === 'yes' && !String(dane[`${poz.key}_notes`] ?? '').trim()) {
          bledy[`${poz.key}_notes`] = 'Przy odpowiedzi „tak" opisz krótko, czego dotyczy.';
        }
      }
    }
  }

  if (krok === 'zgody') {
    if (!dane.exclusions_accepted) {
      bledy.exclusions_accepted = 'Potwierdź, że znasz główne wyłączenia odpowiedzialności.';
    }
    if (!dane.informedAccepted) {
      bledy.informedAccepted = 'Potwierdź zapoznanie się z klauzulą informacyjną.';
    }
  }

  return bledy;
}

/** Czy krok „zdrowie" ma pokazać rozszerzoną ankietę. */
export function ankietaRozszerzona(dane) {
  return surveyRequired(dane.permIncapacitySum);
}

/**
 * Pola, które backend czyta jako boolean. Przeglądarka wysyła checkboxy jako
 * „on" albo wcale, a stary backend oczekuje „Yes"/„No" — zachowujemy ten kontrakt,
 * bo po drugiej stronie siedzą kolumny, których nie ruszamy przy przeprowadzce.
 */
export const POLA_LOGICZNE = [
  ...PYTANIA_MEDYCZNE.map((p) => p.klucz),
  ...AKTYWNOSCI_RYZYKOWNE.map((a) => a.klucz),
  ...RYZYKA.map((r) => r.klucz),
  'exclusions_accepted', 'employsPeople', 'informedAccepted', 'nwPermanentDamage',
];

/*
 * Czego tu NIE MA i dlaczego nie wolno tego dopisać.
 *
 * Stały tu kiedyś `weightChange`, `takesMeds`, `pendingDiagnosis`,
 * `disabilityCongenital`, `smoker`, `eventHospitalization`, `eventSickLeave30`
 * i `eventFurtherDiagnosis` — nazwy ze starego formularza, który pytał o te
 * rzeczy wprost. Nowy kreator pyta o nie wyłącznie w ankiecie rozszerzonej,
 * pod kluczami `weight_change`, `takes_meds` i tak dalej.
 *
 * Dopóki tu stały, normalizacja niżej wpisywała im „No" — bo pola o takiej
 * nazwie w stanie kreatora nie ma. Funkcja brzegowa czyta
 * `body.weightChange ?? body.weight_change`, a `??` przepuszcza „No”
 * (to nie jest null ani undefined) i po prawdziwą odpowiedź nigdy nie sięga.
 * Klient mógł zaznaczyć „tak" przy hospitalizacji i do bazy szło „nie”.
 *
 * Bez tych nazw w ładunku nie ma nic, funkcja zapisuje null, a `cleanRecord`
 * i tak wycina nulle — kolumna zostaje pusta. Puste znaczy „nie pytaliśmy”
 * i o to chodzi: przy sumie poniżej progu ankiety nie ma, więc twarde „nie”
 * na pytanie o stałe leki byłoby oświadczeniem, którego klient nie złożył.
 */

/** Zamienia stan formularza na kształt, którego oczekuje funkcja form-submit. */
export function doWysylki(dane) {
  const out = { ...dane };
  // Zgoda na kontakt w sprawie niedokończonego wniosku dotyczy szkicu
  // (`wniosek-szkic`), nie wniosku. Kontrakt z form-submit się nie zmienia.
  delete out.zgodaKontakt;
  // Gdy próg nie jest spełniony, klauzule nie mogą pójść dalej z żadną wartością.
  // Inaczej klient dostałby ofertę bez rozszerzeń, które wcześniej zaznaczył.
  if (!klauzuleDostepne(dane)) {
    for (const k of KLAUZULE_NW) out[k.klucz] = 0;
  }
  for (const pole of POLA_LOGICZNE) {
    const v = dane[pole];
    out[pole] = v === true || v === 'yes' || v === 'Yes' || v === 'on' ? 'Yes' : 'No';
  }
  if (out.employsPeople === 'Yes' && dane.emp_contribution_slider != null) {
    out.emp_contribution = `${dane.emp_contribution_slider}%`;
  }
  // Ankieta rozszerzona ma JEDEN kontrakt z funkcją brzegową: pola `hs_<klucz>`
  // z wartością „tak"/„nie" i `hsd_<klucz>` ze szczegółami. Tak samo wysyła ją
  // panel przy ręcznym wprowadzaniu klienta.
  //
  // Nie jest to kwestia stylu. form-submit zbiera ankietę wyłącznie z kluczy
  // zaczynających się od `hs_`, a potem sprawdza, czy przy sumie trwałej
  // niezdolności powyżej progu cokolwiek zebrał. Kreator wysyłający gołe
  // `weight_change: 'yes'` daje zero trafień i dostaje 400 z poleceniem
  // wypełnienia ankiety, którą klient właśnie wypełnił — pętla bez wyjścia,
  // i to przy najwyższych sumach, czyli najdroższych wnioskach.
  //
  // Kontrakt po drugiej stronie: supabase/functions/form-submit/index.ts,
  // stałe HEALTH_SURVEY_COLUMNS i HEALTH_SURVEY_THRESHOLD.
  if (ankietaRozszerzona(dane)) {
    for (const poz of HEALTH_SURVEY_ITEMS) {
      const odp = dane[poz.key];
      out[`hs_${poz.key}`] = odp === true || odp === 'yes' || odp === 'tak' ? 'tak' : 'nie';
      out[`hsd_${poz.key}`] = String(dane[`${poz.key}_notes`] ?? '');
    }
  }
  return out;
}
