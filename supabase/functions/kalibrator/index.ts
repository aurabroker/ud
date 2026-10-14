import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logError } from "../_shared/logger.ts";

/**
 * kalibrator — przeliczenie stawek kalkulatora z ofert wystawionych w panelu.
 *
 * Specyfikacja i decyzje właściciela z 14.10.2026: MODEL-SKLADKI.md („Plan:
 * worker ud-kalibrator") i CLAUDE.md („Kalkulator — stawka pochodzi z ofert").
 * Metodę liczy funkcja SQL `ud_kalibracja_stawek()` — ten plik jej NIE
 * powtarza: bierze agregaty, pilnuje bramek, porównuje z plikiem
 * `apps/portal/src/lib/kalibracja.json` i decyduje, co z tym zrobić.
 *
 * WDROŻENIE: verify_jwt = false. W repozytorium nie ma supabase/config.toml,
 * więc zapisujemy to tutaj: przy wdrożeniu przez MCP `verify_jwt: false`,
 * pliki `source/index.ts` i `_shared/logger.ts`, entrypoint `source/index.ts`
 * (CLAUDE.md, „Wdrażanie przez MCP"). Bramką jest token z Vaulta sprawdzany
 * w kodzie PRZED pierwszym odczytem — jak w send-digest-email
 * i wniosek-przypomnienie. Woła ją wyłącznie pg_cron przez funkcję SQL
 * `ud_kalibracja_uruchom()` (zadanie `kalibracja-stawek`, pn–pt 05:40 UTC,
 * powstaje WYŁĄCZONE), która dokłada nagłówek x-cron-token z Vaulta.
 *
 * Tryby (kolumna `tryb` w tabeli ustawień kalibracji):
 *  • wylaczony  — wpis w dzienniku i koniec;
 *  • na_sucho   — codzienny mail z porównaniem, ŻADNYCH zapisów do GitHuba;
 *  • propozycja — zmiana stawek idzie jako pull request z gałęzi
 *                 `kalibrator/propozycja`; scala właściciel. Nigdy commit
 *                 prosto na gałąź produkcyjną (decyzja z 14.10.2026).
 *
 * Czego tu nie wolno dopisać:
 *  • zapisu do GitHuba poza jedną ścieżką — plik kalibracji na gałęzi bota
 *    (`zapisDozwolony()` to twarda lista, sprawdzana przed każdym żądaniem);
 *  • nowych kluczy `okresy` (48, 60) do pliku — idą do maila „do decyzji";
 *  • `MNOZNIK_HIV_WZW` — stoi ręcznie w symulacja.ts;
 *  • czegokolwiek z danych klientów: repozytorium jest publiczne. Numery
 *    ofert (bez członu z nazwiskiem) pojawiają się wyłącznie w mailu.
 *
 * Sekrety: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND2_API_KEY
 * (zapasowo RESEND_API_KEY), GITHUB_KALIBRATOR_TOKEN — fine-grained, tylko
 * aurabroker/ud, uprawnienia Contents: write i Pull requests: write.
 * Bez tokenu odczyt pliku idzie anonimowo (repozytorium jest publiczne),
 * a tryb propozycji kończy się odmową.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ZRODLO_BLEDU = "kalibrator";

const REPO = "aurabroker/ud";
const GITHUB_API = `https://api.github.com/repos/${REPO}`;
const GITHUB_RAW = `https://raw.githubusercontent.com/${REPO}`;
/** Jedyny plik, który kalibrator zmienia — i jedyna gałąź, na którą pisze. */
const PLIK = "apps/portal/src/lib/kalibracja.json";
const GALAZ_BOTA = "kalibrator/propozycja";

/** Podgląd gałęzi bota w Cloudflare Pages (alias gałęzi: „/" → „-"). */
const PODGLAD = "https://kalibrator-propozycja.utratadochodu.pages.dev/kalkulator/";
const STRONA_MD = "https://utratadochodu.pages.dev/kalkulator/index.md";

const ODBIORCA_DOMYSLNY = "biuro@utratadochodu.com";
const NADAWCA = "UtrataDochodu.pl <noreply@utratadochodu.com>";
const NADAWCA_ZAPASOWY = "UtrataDochodu <info@utratadochodu.pl>";

/** Okresy wypłaty z oferty — te same co OKRESY w symulacja.ts. */
const OKRESY = ["24", "36", "48", "60"];
const STAWKA_MIN = 0.01;
const STAWKA_MAX = 0.05;
const MNOZNIK_MIN = 1;
const MNOZNIK_MAX = 2;

/** Przykłady jak w kalkulatorze: dochód 18 000 zł, B2B 80% i etat 65%. */
const PRZYKLADY = [
  { swiadczenie: 14400, opis: "dochód 18 000 zł, B2B / JDG — 80%" },
  { swiadczenie: 11700, opis: "dochód 18 000 zł, umowa o pracę — 65%" },
];
/** Świadczenie, przy którym strona kalkulatora pokazuje przedział domyślnie. */
const SWIADCZENIE_STRONY = 14400;

const DZIEN_MS = 86_400_000;
const LIMIT_CZASU_MS = 10_000;
/** Bez zmian: przypominamy się raz na tyle dni, żeby cisza nie znaczyła awarii. */
const DNI_POTWIERDZENIA = 30;
const DNI_TOKEN_OSTRZEZENIE = 30;
const DNI_TOKEN_PRZERWA = 7;
const DNI_DO_DECYZJI_PRZERWA = 30;

/** Znaczniki w `powod` — po nich dziennik pamięta, o czym już pisaliśmy. */
const ZNACZNIK_TOKENU = "ostrzeżenie: token GitHuba wygasa";
const ZNACZNIK_STRONY = "alert: strona nie pokazuje stawek z pliku";
const SEPARATOR_ZNACZNIKOW = " | ";

type Json = Record<string, unknown>;
type Stawka = { dol: number; srodek: number; gora: number };
type Ustawienia = { tryb: string; galaz: string; odbiorca: string; dane_od: string | null };
type Wpis = {
  uruchomiono: string;
  wynik: string;
  powod: string | null;
  mail_wyslany: boolean;
  na_stronie: boolean | null;
};
type Uwaga = { tekst: string; alarm: boolean; znacznik?: string };
type Sekcja = {
  tytul?: string;
  alarm?: string;
  akapity?: string[];
  linki?: { tekst: string; href: string }[];
  tabela?: string[][];
  pre?: string;
};
type Mail = { temat: string; html: string; tekst: string };
type Pr = { number: number; state: string; merged_at: string | null; body: string | null; html_url: string };
type Klient = ReturnType<typeof createClient>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// ─── Walidator pliku kalibracji ─────────────────────────────────────────────
// Ta sama reguła co sprawdzKalibracje() w apps/portal/src/lib/symulacja.ts.
// Zduplikowana świadomie: Deno nie importuje z portalu. Portal rzuca przy
// imporcie (build pada, Pages zostawia poprzednie wdrożenie); tu ta sama
// reguła zatrzymuje propozycję, zanim trafi do pull requesta.

const obiekt = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const liczba = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function dataPoprawna(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function bledyStawek(stawka: unknown): string[] {
  if (!obiekt(stawka)) return ["stawka: brak obiektu"];
  const bledy: string[] = [];
  for (const pole of ["dol", "srodek", "gora"]) {
    if (!liczba(stawka[pole])) bledy.push(`stawka.${pole}: wymagana skończona liczba`);
  }
  if (bledy.length) return bledy;
  const { dol, srodek, gora } = stawka as Stawka;
  if (!(STAWKA_MIN <= dol && dol <= srodek && srodek <= gora && gora <= STAWKA_MAX)) {
    bledy.push(`stawka: wymagane 0,01 ≤ dół ≤ środek ≤ góra ≤ 0,05 (jest ${dol} / ${srodek} / ${gora})`);
  }
  return bledy;
}

function bledyOkresow(okresy: unknown): string[] {
  if (!obiekt(okresy)) return ["okresy: brak obiektu"];
  const bledy: string[] = [];
  for (const k of Object.keys(okresy)) {
    const v = okresy[k];
    if (!OKRESY.includes(k)) bledy.push(`okresy: niedozwolony klucz „${k}" (dozwolone: ${OKRESY.join(", ")})`);
    else if (!liczba(v) || v < MNOZNIK_MIN || v > MNOZNIK_MAX) bledy.push(`okresy.${k}: wymagana liczba z przedziału [1; 2]`);
  }
  if (okresy["24"] !== 1) bledy.push('okresy["24"]: musi wynosić 1');
  if (!bledy.length) {
    const wartosci = OKRESY.filter((k) => k in okresy).map((k) => okresy[k] as number);
    for (let i = 1; i < wartosci.length; i++) {
      if (!(wartosci[i] > wartosci[i - 1])) {
        bledy.push("okresy: mnożniki muszą rosnąć razem z okresem");
        break;
      }
    }
  }
  return bledy;
}

/** Pusta lista = plik poprawny. */
function bledyKalibracji(k: unknown): string[] {
  if (!obiekt(k)) return ["plik nie jest obiektem JSON"];
  const bledy: string[] = [];
  if (!dataPoprawna(k.policzono)) bledy.push("policzono: wymagana data RRRR-MM-DD");
  if (!obiekt(k.zrodlo)) bledy.push("zrodlo: brak obiektu");
  bledy.push(...bledyStawek(k.stawka), ...bledyOkresow(k.okresy));
  return bledy;
}

// ─── Wynik SQL → kandydat do pliku ──────────────────────────────────────────

/**
 * `zrodlo` z wyniku SQL przepisujemy pole po polu, z białej listy. Ląduje
 * w publicznym repozytorium — cokolwiek spoza kontraktu (gdyby funkcja SQL
 * kiedyś zwróciła za dużo) nie ma jak tam trafić.
 */
function oczyscZrodlo(z: unknown): { zrodlo: Json | null; bledy: string[] } {
  if (!obiekt(z)) return { zrodlo: null, bledy: ["zrodlo: brak obiektu w wyniku SQL"] };
  const bledy: string[] = [];
  const tekst = (pole: string) => {
    const v = z[pole];
    if (typeof v === "string" && /^[\p{L}\p{N} .-]{1,40}$/u.test(v)) return v;
    bledy.push(`zrodlo.${pole}: niepoprawne`);
    return null;
  };
  const calkowita = (v: unknown, pole: string) => {
    if (Number.isInteger(v) && (v as number) >= 0) return v as number;
    bledy.push(`zrodlo.${pole}: wymagana liczba całkowita ≥ 0`);
    return null;
  };
  const okno = obiekt(z.okno) ? z.okno : {};
  if (!dataPoprawna(okno.od) || !dataPoprawna(okno.do)) bledy.push("zrodlo.okno: wymagane daty od i do");
  const par: Record<string, number> = {};
  if (z.par !== undefined && z.par !== null) {
    if (!obiekt(z.par)) bledy.push("zrodlo.par: brak obiektu");
    else {
      for (const k of OKRESY.slice(1)) {
        if (k in z.par) {
          const n = calkowita(z.par[k], `par.${k}`);
          if (n !== null) par[k] = n;
        }
      }
    }
  }
  const zrodlo = {
    metoda: tekst("metoda"),
    ubezpieczyciel: tekst("ubezpieczyciel"),
    okno: { od: okno.od ?? null, do: okno.do ?? null },
    osob: calkowita(z.osob, "osob"),
    ofert: calkowita(z.ofert, "ofert"),
    wariantow: calkowita(z.wariantow, "wariantow"),
    par,
  };
  return { zrodlo, bledy };
}

function opisStatusu(w: Json): string {
  const osob = obiekt(w.zrodlo) && Number.isInteger(w.zrodlo.osob) ? w.zrodlo.osob : "?";
  if (w.status === "za_malo_osob") return `status za_malo_osob: ${osob} osób w próbie, potrzeba co najmniej 8`;
  if (w.status === "anomalie") {
    const n = obiekt(w.raport) && Array.isArray(w.raport.anomalie) ? w.raport.anomalie.length : "?";
    return `status anomalie: ${n} do sprawdzenia — bez stawek, dopóki dane nie zostaną poprawione`;
  }
  return `status: ${bezDanych(String(w.status)).slice(0, 40)} (oczekiwany ok)`;
}

/**
 * Bramki (każda niespełniona = brak propozycji, wpis „odmowa", mail) i kandydat.
 *
 * Kandydat to obecny plik z podmienionymi `stawka`, `okresy` i `zrodlo`.
 * W `okresy` wolno zmieniać wyłącznie klucze, które już są w pliku: nowy
 * (48, 60) idzie do maila jako „do decyzji", a klucz z pliku, którego SQL nie
 * zwrócił (za mało par), zostaje stary — z uwagą w mailu.
 */
function ocen(wynik: unknown, obecny: unknown, dzis: string) {
  const bledy: string[] = [];
  const uwagi: Uwaga[] = [];
  const doDecyzji: { okres: string; mnoznik: number }[] = [];
  const pusty = { bledy, uwagi, doDecyzji, kandydat: null as Json | null, zmiana: false };

  if (!obiekt(wynik)) {
    bledy.push("wynik SQL nie jest obiektem");
    return pusty;
  }
  if (wynik.status !== "ok") bledy.push(opisStatusu(wynik));
  else {
    bledy.push(...bledyStawek(wynik.stawka).map((b) => `wynik SQL: ${b}`));
    const s = wynik.stawka as Stawka;
    if (!bledy.length && !(s.dol < s.gora)) bledy.push("wynik SQL: dolna granica musi być niższa od górnej");
    bledy.push(...bledyOkresow(wynik.okresy).map((b) => `wynik SQL: ${b}`));
  }
  const zr = oczyscZrodlo(wynik.zrodlo);
  if (wynik.status === "ok") bledy.push(...zr.bledy);
  const bledyObecnego = obecny === undefined ? ["niepoprawny JSON"] : bledyKalibracji(obecny);
  bledy.push(...bledyObecnego.map((b) => `obecny plik na gałęzi produkcyjnej: ${b}`));
  if (bledy.length) return pusty;

  const plik = obecny as Json;
  const s = wynik.stawka as Stawka;
  const stawka = { dol: s.dol, srodek: s.srodek, gora: s.gora };
  const okresyPliku = plik.okresy as Record<string, number>;
  const okresySql = wynik.okresy as Record<string, number>;
  const okresy: Record<string, number> = {};
  for (const k of OKRESY) {
    if (k in okresyPliku) {
      if (k in okresySql) okresy[k] = okresySql[k];
      else {
        okresy[k] = okresyPliku[k];
        uwagi.push({
          alarm: false,
          tekst: `Okres ${k} mies.: w danych za mało par (potrzeba ≥ 3 osób, rozrzut ≤ 1,05) — ` +
            `w pliku zostaje dotychczasowy mnożnik ${mnoz(okresyPliku[k])}.`,
        });
      }
    } else if (k in okresySql) doDecyzji.push({ okres: k, mnoznik: okresySql[k] });
  }

  const stara = plik.stawka as Stawka;
  const zmiana = stawka.dol !== stara.dol || stawka.srodek !== stara.srodek || stawka.gora !== stara.gora ||
    OKRESY.some((k) => okresy[k] !== okresyPliku[k]);
  const kandydat: Json = {
    policzono: zmiana ? dzis : plik.policzono,
    zrodlo: zr.zrodlo,
    stawka,
    okresy,
  };
  bledy.push(...bledyKalibracji(kandydat).map((b) => `kandydat: ${b}`));
  if (bledy.length) return pusty;
  return { bledy, uwagi, doDecyzji, kandydat, zmiana };
}

/**
 * Wynik SQL do dziennika (`wyliczone`): klucze z kontraktu, `zrodlo` z białej
 * listy, numery ofert bez członu z nazwiskiem. Dziennik nie trzyma danych osobowych.
 */
function doDziennika(w: unknown): Json | null {
  if (!obiekt(w)) return null;
  const r = obiekt(w.raport) ? w.raport : null;
  const raport = r && {
    surowe: r.surowe ?? null,
    okresy_kandydaci: r.okresy_kandydaci ?? null,
    pominiete: r.pominiete ?? null,
    anomalie: Array.isArray(r.anomalie)
      ? r.anomalie.map((a) => ({ oferta: numerOferty(pole(a, "oferta")), powod: bezDanych(String(pole(a, "powod") ?? "")).slice(0, 120) }))
      : null,
  };
  return {
    status: w.status ?? null,
    metoda: w.metoda ?? null,
    na_dzien: w.na_dzien ?? null,
    stawka: w.stawka ?? null,
    okresy: w.okresy ?? null,
    zrodlo: oczyscZrodlo(w.zrodlo).zrodlo,
    raport,
  };
}

/** Stała kolejność kluczy (tak budujemy obiekt), wcięcie 2 spacje, newline na końcu. */
const formatPliku = (k: Json) => JSON.stringify(k, null, 2) + "\n";

/** JSON z kluczami posortowanymi rekurencyjnie — podstawa skrótu propozycji. */
function kanoniczny(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(kanoniczny).join(",")}]`;
  if (obiekt(v)) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${kanoniczny(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

async function sha256(tekst: string): Promise<string> {
  const skrot = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst));
  return [...new Uint8Array(skrot)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Formatowanie ───────────────────────────────────────────────────────────

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Do logów i maili: bez adresów, identyfikatorów i ciągów wyglądających jak PESEL. */
function bezDanych(tekst: string): string {
  return tekst
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, "[adres]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .replace(/\d{11,}/g, "[numer]")
    .substring(0, 300);
}

/** Numer oferty bez członu z nazwiskiem: UD/2026/CE/00034/Młot → UD/2026/CE/00034. */
function numerOferty(v: unknown): string {
  const m = String(v ?? "").match(/^[A-Z]{2}\/\d{4}\/[A-Z0-9]{1,6}\/\d{1,8}/);
  return m ? m[0] : "—";
}

/** 14400 → „14 400" (twarda spacja, jak w kalkulatorze). */
const grupuj = (n: number, spacja = " ") => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, spacja);
const zl = (n: number) => `${grupuj(n)} zł`;

/** Ułamek → procent z polskim przecinkiem: 0,0202 → „2,02%", 0,03217 → „3,217%". */
function procent(v: unknown): string {
  if (!liczba(v)) return "—";
  const t = (v * 100).toFixed(4).replace(/0{1,2}$/, "");
  return `${t.replace(".", ",")}%`;
}
const mnoz = (v: unknown, miejsc = 2) => (liczba(v) ? v.toFixed(miejsc).replace(".", ",") : "—");

/** Ten sam wzór co symuluj() i zlZakres() w portalu (wariant 24 mies., bez klauzuli). */
function zakres(swiadczenie: number, stawka: unknown): string {
  if (bledyStawek(stawka).length) return "—";
  const s = stawka as Stawka;
  const od = Math.round(swiadczenie * s.dol);
  const do_ = Math.round(swiadczenie * s.gora);
  return od === do_ ? zl(od) : `${grupuj(od)}–${grupuj(do_)} zł`;
}

function dzisWarszawa(teraz: Date): string {
  const czesci = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(teraz);
  const p = (typ: string) => czesci.find((c) => c.type === typ)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}`;
}
const dataPl = (iso: string) => iso.split("-").reverse().join(".");

// ─── Dziennik ───────────────────────────────────────────────────────────────

/** Część `powod` przed znacznikami — po niej rozpoznajemy „ten sam" przebieg. */
const rdzen = (powod: string | null | undefined) => String(powod ?? "").split(SEPARATOR_ZNACZNIKOW)[0];

const powtorzenie = (historia: Wpis[], wynik: string, powod: string) =>
  historia[0]?.wynik === wynik && rdzen(historia[0]?.powod) === rdzen(powod);

function dniOd(iso: string, teraz: Date): number {
  return (teraz.getTime() - new Date(iso).getTime()) / DZIEN_MS;
}

const byloWDniach = (historia: Wpis[], znacznik: string, dni: number, teraz: Date) =>
  historia.some((h) => (h.powod ?? "").includes(znacznik) && dniOd(h.uruchomiono, teraz) < dni);

function dniOdOstatniegoMaila(historia: Wpis[], teraz: Date): number {
  const ostatni = historia.find((h) => h.mail_wyslany === true);
  return ostatni ? dniOd(ostatni.uruchomiono, teraz) : Infinity;
}

// ─── GitHub ─────────────────────────────────────────────────────────────────

const sciezkaGalezi = (galaz: string) => galaz.split("/").map(encodeURIComponent).join("/");

/**
 * Twarda lista zapisów. Każde żądanie inne niż GET przechodzi tędy, zanim
 * wyjdzie: wolno ustawić gałąź bota, zapisać JEDEN plik na gałęzi bota
 * i otworzyć albo opisać pull request z gałęzi bota do produkcyjnej.
 * Gałąź produkcyjna nie ma tu żadnej drogi zapisu.
 */
function zapisDozwolony(metoda: string, sciezka: string, cialo: Json | undefined, galaz: string): boolean {
  if (metoda === "GET") return true;
  if (galaz === GALAZ_BOTA || !cialo) return false;
  if (metoda === "POST" && sciezka === "/git/refs") return cialo.ref === `refs/heads/${GALAZ_BOTA}`;
  if (metoda === "PATCH" && sciezka === `/git/refs/heads/${GALAZ_BOTA}`) return true;
  if (metoda === "PUT" && sciezka === `/contents/${PLIK}`) return cialo.branch === GALAZ_BOTA;
  if (metoda === "POST" && sciezka === "/pulls") return cialo.head === GALAZ_BOTA && cialo.base === galaz;
  if (metoda === "PATCH" && /^\/pulls\/\d+$/.test(sciezka)) {
    return Object.keys(cialo).every((k) => k === "title" || k === "body");
  }
  return false;
}

function klientGitHuba(token: string | undefined, galaz: string) {
  let wygasa: string | null = null;

  async function zapytaj(metoda: string, sciezka: string, cialo?: Json, dozwolone: number[] = []) {
    if (!zapisDozwolony(metoda, sciezka, cialo, galaz)) {
      throw new Error(`zablokowany zapis do GitHuba: ${metoda} ${sciezka.split("?")[0]}`);
    }
    const naglowki: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "ud-kalibrator",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) naglowki.Authorization = `Bearer ${token}`;
    if (cialo) naglowki["Content-Type"] = "application/json";
    const res = await fetch(GITHUB_API + sciezka, {
      method: metoda,
      headers: naglowki,
      body: cialo ? JSON.stringify(cialo) : undefined,
      signal: AbortSignal.timeout(LIMIT_CZASU_MS),
    });
    wygasa ??= res.headers.get("github-authentication-token-expiration");
    const tekst = await res.text();
    let dane: unknown = null;
    try {
      dane = tekst ? JSON.parse(tekst) : null;
    } catch {
      dane = null;
    }
    if (!res.ok && !dozwolone.includes(res.status)) {
      const opis = obiekt(dane) && typeof dane.message === "string" ? ` (${bezDanych(dane.message).slice(0, 120)})` : "";
      const blad = new Error(`GitHub ${metoda} ${sciezka.split("?")[0]}: HTTP ${res.status}${opis}`);
      (blad as Error & { status?: number }).status = res.status;
      throw blad;
    }
    return { status: res.status, dane: dane as Json | null };
  }

  return { zapytaj, wygasa: () => wygasa, zTokenem: Boolean(token) };
}

type GitHub = ReturnType<typeof klientGitHuba>;

function zBase64(b64: string): string {
  const s = atob(b64.replace(/\s/g, ""));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
}

function doBase64(tekst: string): string {
  let s = "";
  for (const b of new TextEncoder().encode(tekst)) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Obecny plik z gałęzi produkcyjnej. Bez tokenu API GitHuba liczy limit na
 * adres IP — wspólny dla wielu funkcji brzegowych — więc przy odmowie 403/429
 * czytamy ten sam plik z raw.githubusercontent.com (repozytorium jest publiczne).
 */
async function pobierzPlik(gh: GitHub, galaz: string): Promise<{ tekst: string }> {
  try {
    const { dane } = await gh.zapytaj("GET", `/contents/${PLIK}?ref=${encodeURIComponent(galaz)}`);
    if (!obiekt(dane) || typeof dane.content !== "string") throw new Error("GitHub: odpowiedź bez treści pliku");
    return { tekst: zBase64(dane.content) };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (gh.zTokenem || (status !== 403 && status !== 429)) throw e;
    const res = await fetch(`${GITHUB_RAW}/${sciezkaGalezi(galaz)}/${PLIK}`, {
      headers: { "User-Agent": "ud-kalibrator" },
      signal: AbortSignal.timeout(LIMIT_CZASU_MS),
    });
    if (!res.ok) throw new Error(`GitHub raw: HTTP ${res.status} (API: HTTP ${status})`);
    return { tekst: await res.text() };
  }
}

async function listaPr(gh: GitHub): Promise<Pr[]> {
  const wlasciciel = REPO.split("/")[0];
  const { dane } = await gh.zapytaj(
    "GET",
    `/pulls?head=${encodeURIComponent(`${wlasciciel}:${GALAZ_BOTA}`)}&state=all&per_page=100`,
  );
  if (!Array.isArray(dane)) throw new Error("GitHub: lista pull requestów nie jest tablicą");
  return (dane as Pr[]).filter((p) => Number.isInteger(p?.number));
}

/**
 * Gałąź bota = HEAD gałęzi produkcyjnej, na niej jeden nowy plik, pull request
 * do gałęzi produkcyjnej (albo nowy opis istniejącego otwartego).
 */
async function zlozPropozycje(
  gh: GitHub,
  galaz: string,
  o: { obecnyTekst: string; kandydatTekst: string; tytul: string; opis: string; wiadomosc: string; otwarty?: Pr },
) {
  const head = await gh.zapytaj("GET", `/git/ref/heads/${sciezkaGalezi(galaz)}`);
  const sha = obiekt(head.dane) && obiekt(head.dane.object) ? String(head.dane.object.sha ?? "") : "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("GitHub: brak HEAD gałęzi produkcyjnej");

  // Plik w tym commicie musi być tym, który właśnie oceniliśmy — inaczej
  // ktoś zmienił go w trakcie przebiegu i propozycja liczyłaby się od czegoś innego.
  const wHead = await gh.zapytaj("GET", `/contents/${PLIK}?ref=${sha}`);
  if (!obiekt(wHead.dane) || typeof wHead.dane.content !== "string" || typeof wHead.dane.sha !== "string") {
    throw new Error("GitHub: odpowiedź bez treści pliku w HEAD");
  }
  if (zBase64(wHead.dane.content) !== o.obecnyTekst) {
    throw new Error("plik kalibracji na gałęzi produkcyjnej zmienił się w trakcie przebiegu");
  }

  const bot = await gh.zapytaj("GET", `/git/ref/heads/${GALAZ_BOTA}`, undefined, [404]);
  if (bot.status === 404) await gh.zapytaj("POST", "/git/refs", { ref: `refs/heads/${GALAZ_BOTA}`, sha });
  // force: true wolno — to gałąź bota, nikt na niej nie pracuje.
  else await gh.zapytaj("PATCH", `/git/refs/heads/${GALAZ_BOTA}`, { sha, force: true });

  await gh.zapytaj("PUT", `/contents/${PLIK}`, {
    message: o.wiadomosc,
    content: doBase64(o.kandydatTekst),
    sha: wHead.dane.sha,
    branch: GALAZ_BOTA,
  });

  const pr = o.otwarty
    ? await gh.zapytaj("PATCH", `/pulls/${o.otwarty.number}`, { title: o.tytul, body: o.opis })
    : await gh.zapytaj("POST", "/pulls", { title: o.tytul, head: GALAZ_BOTA, base: galaz, body: o.opis });
  const numer = obiekt(pr.dane) ? Number(pr.dane.number) : NaN;
  const url = obiekt(pr.dane) ? String(pr.dane.html_url ?? "") : "";
  if (!Number.isInteger(numer)) throw new Error("GitHub: pull request bez numeru");
  return { numer, url: url.startsWith("https://github.com/") ? url : `https://github.com/${REPO}/pull/${numer}`, zaktualizowany: Boolean(o.otwarty) };
}

function dniDoWygasniecia(naglowek: string | null, teraz: Date): { dni: number; data: string } | null {
  if (!naglowek) return null;
  let t = Date.parse(naglowek);
  if (Number.isNaN(t)) t = Date.parse(naglowek.trim().replace(" UTC", "Z").replace(" ", "T"));
  if (Number.isNaN(t)) return null;
  return { dni: (t - teraz.getTime()) / DZIEN_MS, data: dzisWarszawa(new Date(t)) };
}

// ─── Strona ─────────────────────────────────────────────────────────────────

/**
 * Czy strona pokazuje przedział z OBECNEGO pliku na gałęzi produkcyjnej.
 * Szukamy „od–do zł" dla 14 400 zł — tak, jak liczy go symuluj().
 * null = nie było czego porównać (plik niepoprawny).
 */
async function sprawdzStrone(obecny: unknown): Promise<boolean | null> {
  if (!obiekt(obecny) || bledyStawek(obecny.stawka).length) return null;
  const s = obecny.stawka as Stawka;
  const od = grupuj(Math.round(SWIADCZENIE_STRONY * s.dol), " ");
  const do_ = grupuj(Math.round(SWIADCZENIE_STRONY * s.gora), " ");
  const wzor = od === do_
    ? new RegExp(`(?<!\\d\\s?)${od}\\s*zł`)
    : new RegExp(`(?<!\\d\\s?)${od}\\s*[–-]\\s*${do_}\\s*zł`);
  try {
    const res = await fetch(STRONA_MD, {
      headers: { Accept: "text/markdown" },
      signal: AbortSignal.timeout(LIMIT_CZASU_MS),
    });
    if (!res.ok) return false;
    const tekst = (await res.text())
      .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
      .replace(/[   ]/g, " ");
    return wzor.test(tekst);
  } catch {
    return false;
  }
}

// ─── Poczta ─────────────────────────────────────────────────────────────────

function sekcjaHtml(s: Sekcja): string {
  const czesci: string[] = [];
  if (s.tytul) {
    czesci.push(`<p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#0f172a;">${esc(s.tytul)}</p>`);
  }
  if (s.alarm) {
    czesci.push(`<p style="margin:0 0 12px;padding:10px 12px;background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;font-size:14px;font-weight:700;">${esc(s.alarm)}</p>`);
  }
  for (const a of s.akapity ?? []) {
    czesci.push(`<p style="margin:0 0 10px;font-size:14px;line-height:1.55;color:#334155;">${esc(a)}</p>`);
  }
  for (const l of s.linki ?? []) {
    czesci.push(`<p style="margin:0 0 10px;font-size:14px;"><a href="${esc(l.href)}" style="color:#0f172a;font-weight:700;">${esc(l.tekst)}</a></p>`);
  }
  if (s.tabela?.length) {
    const [naglowek, ...wiersze] = s.tabela;
    const th = naglowek.map((k) => `<th style="padding:6px 10px;text-align:left;font-size:12px;color:#64748b;background:#f8f7f2;">${esc(k)}</th>`).join("");
    const tr = wiersze.map((w) =>
      `<tr>${w.map((k) => `<td style="padding:6px 10px;border-top:1px solid #f1f0eb;font-size:13px;color:#334155;">${esc(k)}</td>`).join("")}</tr>`
    ).join("");
    czesci.push(`<table cellpadding="0" cellspacing="0" style="border:1px solid #e5e2d8;margin:0 0 12px;border-collapse:collapse;"><tr>${th}</tr>${tr}</table>`);
  }
  if (s.pre) {
    czesci.push(`<pre style="margin:0 0 12px;padding:10px;background:#f8f7f2;border:1px solid #e5e2d8;font-size:12px;white-space:pre-wrap;">${esc(s.pre)}</pre>`);
  }
  return `<tr><td style="padding:16px 28px 4px;">${czesci.join("")}</td></tr>`;
}

function sekcjaTekst(s: Sekcja): string {
  const linie: string[] = [];
  if (s.tytul) linie.push(s.tytul.toUpperCase());
  if (s.alarm) linie.push(`!!! ${s.alarm}`);
  linie.push(...(s.akapity ?? []));
  for (const l of s.linki ?? []) linie.push(`${l.tekst}: ${l.href}`);
  for (const w of s.tabela ?? []) linie.push(w.join(" | "));
  if (s.pre) linie.push(s.pre);
  return linie.join("\n");
}

function zbudujMail(temat: string, sekcje: Sekcja[]): Mail {
  const tresc = sekcje.map(sekcjaHtml).join("");
  const html = `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f2;padding:28px 16px;">
  <tr><td align="center">
    <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;background:#fff;border:1px solid #e5e2d8;">
      <tr><td style="background:#0f172a;padding:20px 28px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#fff;">${esc(temat)}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#cbd5e1;">${esc("UtrataDochodu.pl — kalibrator stawek kalkulatora")}</p>
      </td></tr>
      ${tresc}
      <tr><td style="padding:12px 28px 22px;"></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const tekst = [temat, "", ...sekcje.map(sekcjaTekst).flatMap((t) => [t, ""])].join("\n");
  return { temat, html, tekst };
}

/** Resend: RESEND2_API_KEY z noreply@, zapasowo RESEND_API_KEY z info@. */
async function wyslijMail(odbiorca: string, mail: Mail): Promise<boolean> {
  const proby = [
    { klucz: Deno.env.get("RESEND2_API_KEY"), od: NADAWCA },
    { klucz: Deno.env.get("RESEND_API_KEY"), od: NADAWCA_ZAPASOWY },
  ].filter((p) => p.klucz);
  if (!proby.length) {
    await logError(ZRODLO_BLEDU, "Brak RESEND2_API_KEY i RESEND_API_KEY — mail kalibratora nie wyszedł", { temat: mail.temat });
    return false;
  }
  for (const p of proby) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${p.klucz}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: p.od, to: [odbiorca], subject: mail.temat, html: mail.html, text: mail.tekst }),
        signal: AbortSignal.timeout(LIMIT_CZASU_MS),
      });
      if (res.ok) return true;
      await logError(ZRODLO_BLEDU, `Resend odmówił wysyłki (HTTP ${res.status})`,
        { od: p.od, odpowiedz: bezDanych(await res.text()) });
    } catch (e) {
      await logError(ZRODLO_BLEDU, `Resend: ${bezDanych(String((e as { message?: string })?.message ?? e))}`, { od: p.od });
    }
  }
  return false;
}

// ─── Treść maili i pull requesta ────────────────────────────────────────────

type Kontekst = {
  ustawienia: Ustawienia;
  teraz: Date;
  obecny: unknown;
  obecnyTekst: string;
  wynikSql: unknown;
  kandydat: Json | null;
  zmiana: boolean;
  bledy: string[];
  uwagi: Uwaga[];
  doDecyzji: { okres: string; mnoznik: number }[];
  naStronie: boolean | null;
};

const pole = (o: unknown, k: string): unknown => (obiekt(o) ? o[k] : undefined);

function sekcjaStawek(obecny: unknown, nowe: unknown, etykieta: string, doDecyzji: string[] = []): Sekcja {
  const so = pole(obecny, "stawka");
  const sn = pole(nowe, "stawka");
  const oo = pole(obecny, "okresy");
  const on = pole(nowe, "okresy");
  const klucze = OKRESY.filter((k) => obiekt(oo) && k in oo || obiekt(on) && k in on);
  return {
    tytul: "Stawki (wariant 24-miesięczny, składka brutto)",
    tabela: [
      ["", "Obecnie (plik na gałęzi produkcyjnej)", etykieta],
      ["Stawka — dół", procent(pole(so, "dol")), procent(pole(sn, "dol"))],
      ["Stawka — środek", procent(pole(so, "srodek")), procent(pole(sn, "srodek"))],
      ["Stawka — góra", procent(pole(so, "gora")), procent(pole(sn, "gora"))],
      ...klucze.map((k) => [
        `Mnożnik ${k} mies.`,
        mnoz(pole(oo, k)),
        mnoz(pole(on, k)) + (doDecyzji.includes(k) ? " (do decyzji — nie trafia do pliku)" : ""),
      ]),
    ],
  };
}

function sekcjaKwot(obecny: unknown, nowe: unknown, etykieta: string): Sekcja {
  return {
    tytul: "Składka miesięczna w kalkulatorze",
    tabela: [
      ["Świadczenie", "Obecnie", etykieta],
      ...PRZYKLADY.map((p) => [
        `${zl(p.swiadczenie)} (${p.opis})`,
        zakres(p.swiadczenie, pole(obecny, "stawka")),
        zakres(p.swiadczenie, pole(nowe, "stawka")),
      ]),
    ],
    akapity: ["Kwoty liczone jak w kalkulatorze: zaokrąglone świadczenie × stawka, wariant 24-miesięczny, bez klauzuli HIV/WZW."],
  };
}

const ETYKIETY_POMINIETYCH: Record<string, string> = {
  hiv: "klauzula HIV/WZW",
  dodatki: "płatne dodatki",
  wyczekiwanie: "okres wyczekiwania ponad 21 dni",
  jednorazowe: "składka jednorazowa",
  trwala_lub_smierc: "trwała niezdolność albo śmierć",
  inny_ubezpieczyciel: "inny ubezpieczyciel",
  poza_oknem: "poza oknem (365 dni, 48 h karencji)",
};

function sekcjeRaportu(wynikSql: unknown): Sekcja[] {
  const zrodlo = pole(wynikSql, "zrodlo");
  const raport = pole(wynikSql, "raport");
  const surowe = pole(raport, "surowe");
  const okno = pole(zrodlo, "okno");
  const par = pole(zrodlo, "par");
  const n = (v: unknown) => (Number.isInteger(v) ? String(v) : "—");
  const d = (v: unknown) => (dataPoprawna(v) ? dataPl(v as string) : "—");

  const sekcje: Sekcja[] = [{
    tytul: "Próba",
    tabela: [
      ["Osób", "Ofert", "Wariantów", "Okno (data wysłania oferty)"],
      [n(pole(zrodlo, "osob")), n(pole(zrodlo, "ofert")), n(pole(zrodlo, "wariantow")), `${d(pole(okno, "od"))} – ${d(pole(okno, "do"))}`],
    ],
    akapity: [
      "Status funkcji SQL: " + bezDanych(String(pole(wynikSql, "status") ?? "—")).slice(0, 40) +
        "; pary do mnożników: " +
        (obiekt(par) && Object.keys(par).length
          ? OKRESY.filter((k) => k in par).map((k) => `${k} mies. — ${n(par[k])}`).join(", ")
          : "brak"),
    ],
  }, {
    tytul: "Stawki osób (przed zaokrągleniem)",
    tabela: [
      ["min", "p10", "mediana", "średnia", "p90", "max"],
      ["min", "p10", "mediana", "srednia", "p90", "max"].map((k) => procent(pole(surowe, k))),
    ],
  }];

  const kandydaci = pole(raport, "okresy_kandydaci");
  if (obiekt(kandydaci)) {
    sekcje.push({
      tytul: "Mnożniki okresów — kandydaci",
      tabela: [
        ["Okres", "Osób z parą", "Mediana", "Min", "Max"],
        ...OKRESY.filter((k) => k in kandydaci).map((k) => {
          const c = kandydaci[k];
          return [`${k} mies.`, n(pole(c, "osob")), mnoz(pole(c, "mediana"), 4), mnoz(pole(c, "min"), 4), mnoz(pole(c, "max"), 4)];
        }),
      ],
      akapity: ["Mnożnik trafia do wyniku dopiero przy ≥ 3 osobach z parą i rozrzucie ≤ 1,05. Bez ekstrapolacji."],
    });
  }

  const pominiete = pole(raport, "pominiete");
  if (obiekt(pominiete)) {
    sekcje.push({
      tytul: "Pominięte warianty",
      tabela: [
        ["Powód", "Wariantów"],
        ...Object.keys(pominiete)
          .filter((k) => /^[a-z_]{1,40}$/.test(k))
          .map((k) => [ETYKIETY_POMINIETYCH[k] ?? k, n(pominiete[k])]),
      ],
    });
  }

  const anomalie = pole(raport, "anomalie");
  if (Array.isArray(anomalie) && anomalie.length) {
    sekcje.push({
      tytul: `Anomalie (${anomalie.length})`,
      akapity: ["Wiersze, których funkcja SQL nie umie wiarygodnie policzyć. Nic nie jest pomijane po cichu — popraw ofertę w panelu albo zgłoś przypadek."],
      tabela: [
        ["Oferta", "Powód"],
        ...anomalie.slice(0, 50).map((a) => [numerOferty(pole(a, "oferta")), bezDanych(String(pole(a, "powod") ?? "")).slice(0, 120)]),
      ],
    });
  }
  return sekcje;
}

function sekcjaUwag(uwagi: Uwaga[]): Sekcja[] {
  return uwagi.length ? [{ tytul: "Uwagi", akapity: uwagi.map((u) => u.tekst) }] : [];
}

function opisStrony(naStronie: boolean | null, obecny: unknown): string {
  const przedzial = zakres(SWIADCZENIE_STRONY, pole(obecny, "stawka"));
  if (naStronie === true) return `Strona kalkulatora pokazuje przedział z pliku (${przedzial} przy ${zl(SWIADCZENIE_STRONY)}).`;
  if (naStronie === false) return `Strona kalkulatora NIE pokazuje przedziału z pliku (${przedzial} przy ${zl(SWIADCZENIE_STRONY)}).`;
  return "Strony kalkulatora nie sprawdzono — obecny plik nie przechodzi walidatora.";
}

function mailNaSucho(k: Kontekst): Mail {
  const wynik = obiekt(k.wynikSql) ? { stawka: k.wynikSql.stawka, okresy: k.wynikSql.okresy } : null;
  const werdykt: Sekcja = k.bledy.length
    ? { tytul: "Wynik", alarm: "Odmowa — w trybie propozycji nie powstałby pull request.", akapity: k.bledy }
    : k.zmiana
      ? { tytul: "Wynik", akapity: ["Stawki się zmieniły — w trybie propozycji powstałby pull request ze zmianą pliku kalibracji."] }
      : { tytul: "Wynik", akapity: ["Bez zmian — w trybie propozycji nie powstałby pull request."] };
  return zbudujMail(`Kalibracja — przebieg na sucho, ${dataPl(dzisWarszawa(k.teraz))}`, [
    werdykt,
    sekcjaStawek(k.obecny, wynik, "Wyliczone", k.doDecyzji.map((d) => d.okres)),
    sekcjaKwot(k.obecny, wynik, "Wyliczone"),
    ...sekcjaUwag(k.uwagi),
    { tytul: "Strona", akapity: [opisStrony(k.naStronie, k.obecny)] },
    ...sekcjeRaportu(k.wynikSql),
    {
      akapity: [
        "Tryb na sucho: kalibrator niczego nie zapisuje do GitHuba. Włączenie propozycji: " +
          "update public.ud_kalibracja_ustawienia set tryb = 'propozycja', zmieniono_at = now();",
      ],
    },
  ]);
}

function mailOdmowa(k: Kontekst, powody: string[]): Mail {
  const wynik = obiekt(k.wynikSql) ? { stawka: k.wynikSql.stawka, okresy: k.wynikSql.okresy } : null;
  return zbudujMail("Kalibracja: odmowa — stawki zostają bez zmian", [
    {
      tytul: "Dlaczego",
      alarm: "Kalibrator nie złożył propozycji zmiany stawek.",
      akapity: [...powody, "Kolejny przebieg z tym samym powodem nie wyśle drugiego maila."],
    },
    sekcjaStawek(k.obecny, wynik, "Wyliczone"),
    ...sekcjaUwag(k.uwagi),
    ...sekcjeRaportu(k.wynikSql),
  ]);
}

function mailBezZmian(k: Kontekst): Mail {
  return zbudujMail("Kalibracja: kalibrator działa, bez zmian", [
    {
      tytul: "Wynik",
      akapity: [
        `Stawki wyliczone z ofert są takie same jak w pliku. Kalibrator pisze bez zmian raz na ${DNI_POTWIERDZENIA} dni, żeby cisza nie oznaczała awarii.`,
        opisStrony(k.naStronie, k.obecny),
      ],
    },
    sekcjaStawek(k.obecny, k.kandydat, "Wyliczone"),
    sekcjaKwot(k.obecny, k.kandydat, "Wyliczone"),
    ...sekcjaUwag(k.uwagi),
    ...sekcjeRaportu(k.wynikSql),
  ]);
}

function mailUwagi(k: Kontekst): Mail {
  return zbudujMail("Kalibracja: uwagi", [
    ...sekcjaUwag(k.uwagi),
    { tytul: "Strona", akapity: [opisStrony(k.naStronie, k.obecny)] },
  ]);
}

function spadek(obecny: unknown, kandydat: Json | null): boolean {
  const s = pole(obecny, "stawka");
  const n = pole(kandydat, "stawka");
  return liczba(pole(s, "dol")) && liczba(pole(n, "dol")) && (pole(n, "dol") as number) < (pole(s, "dol") as number);
}

function mailPropozycja(k: Kontekst, pr: { numer: number; url: string; zaktualizowany: boolean }): Mail {
  const sekcje: Sekcja[] = [];
  if (spadek(k.obecny, k.kandydat)) {
    sekcje.push({ alarm: "SPADEK dolnej granicy — strona pokaże niższą najniższą składkę niż dotąd." });
  }
  sekcje.push(
    {
      tytul: pr.zaktualizowany ? `Zaktualizowany pull request #${pr.numer}` : `Nowy pull request #${pr.numer}`,
      akapity: [
        "Stawki wyliczone z ofert różnią się od pliku kalibracji. Scalenie pull requesta = nowe stawki na stronie po zbudowaniu. " +
          "Zamknięcie bez scalenia = kalibrator nie zaproponuje tych samych liczb ponownie.",
      ],
      linki: [
        { tekst: `Pull request #${pr.numer}`, href: pr.url },
        { tekst: "Podgląd kalkulatora z propozycją", href: PODGLAD },
      ],
    },
    sekcjaStawek(k.obecny, k.kandydat, "Propozycja", k.doDecyzji.map((d) => d.okres)),
    sekcjaKwot(k.obecny, k.kandydat, "Propozycja"),
    ...sekcjaUwag(k.uwagi),
    ...sekcjeRaportu(k.wynikSql),
    {
      tytul: "Poprzednia treść pliku (do wklejenia przy cofaniu)",
      akapity: [`${PLIK} na gałęzi ${k.ustawienia.galaz}:`],
      pre: k.obecnyTekst,
    },
  );
  return zbudujMail("Kalibracja: propozycja zmiany stawek", sekcje);
}

function mailBledu(komunikat: string): Mail {
  return zbudujMail("Kalibracja: błąd przebiegu", [{
    tytul: "Przebieg przerwany",
    alarm: komunikat,
    akapity: [
      "Stawki na stronie zostają bez zmian. Wpis jest w ud_errors (źródło kalibrator) i w dzienniku ud_kalibracja_przebiegi.",
      "Ten sam błąd w kolejnym przebiegu nie wyśle drugiego maila.",
    ],
  }]);
}

/** Pull request: repozytorium jest publiczne — same agregaty, żadnych numerów ofert. */
function opisPr(obecny: unknown, kandydat: Json, skrot: string, galaz: string) {
  const so = pole(obecny, "stawka");
  const sn = kandydat.stawka as Stawka;
  const oo = pole(obecny, "okresy");
  const on = kandydat.okresy as Record<string, number>;
  const z = kandydat.zrodlo as Json;
  const okno = pole(z, "okno");
  const par = pole(z, "par");
  const tytul = `Kalibracja stawek: ${procent(sn.dol)}–${procent(sn.gora)} (było ${procent(pole(so, "dol"))}–${procent(pole(so, "gora"))})`;
  const wiersze = [
    ["Stawka — dół", procent(pole(so, "dol")), procent(sn.dol)],
    ["Stawka — środek", procent(pole(so, "srodek")), procent(sn.srodek)],
    ["Stawka — góra", procent(pole(so, "gora")), procent(sn.gora)],
    ...OKRESY.filter((k) => k in on).map((k) => [`Mnożnik ${k} mies.`, mnoz(pole(oo, k)), mnoz(on[k])]),
  ];
  const kwoty = PRZYKLADY.map((p) =>
    `- ${zl(p.swiadczenie)} (${p.opis}): ${zakres(p.swiadczenie, pole(obecny, "stawka"))} → ${zakres(p.swiadczenie, sn)}`
  );
  const opis = [
    `Propozycja kalibratora stawek (\`supabase/functions/kalibrator\`). Zmienia wyłącznie \`${PLIK}\`.`,
    "",
    ...(spadek(obecny, kandydat) ? ["**SPADEK dolnej granicy** — strona pokaże niższą najniższą składkę niż dotąd.", ""] : []),
    "| | Obecnie | Propozycja |",
    "|---|---|---|",
    ...wiersze.map((w) => `| ${w.join(" | ")} |`),
    "",
    "Składka miesięczna w kalkulatorze (wariant 24-miesięczny, bez klauzuli HIV/WZW):",
    ...kwoty,
    "",
    `Próba: ${pole(z, "osob")} osób, ${pole(z, "ofert")} ofert, ${pole(z, "wariantow")} wariantów; ` +
      `pary do mnożników: ${obiekt(par) && Object.keys(par).length ? Object.keys(par).map((k) => `${k} mies. — ${par[k]}`).join(", ") : "brak"}. ` +
      `Okno: ${pole(okno, "od")} – ${pole(okno, "do")}. Metoda ${pole(z, "metoda")}, ${pole(z, "ubezpieczyciel")}, składka brutto.`,
    "",
    `Podgląd: ${PODGLAD}`,
    "",
    `Scalenie do \`${galaz}\` = nowe stawki na stronie po zbudowaniu. Zamknięcie bez scalenia = kalibrator nie zaproponuje tych samych liczb ponownie.`,
    "",
    `Skrót propozycji: \`${skrot}\``,
    `<!-- kalibrator:${skrot} -->`,
  ].join("\n");
  const wiadomosc = `Kalibracja stawek: dół ${procent(sn.dol)}, środek ${procent(sn.srodek)}, góra ${procent(sn.gora)}` +
    OKRESY.filter((k) => k !== "24" && k in on).map((k) => `, ${k} mies. ×${mnoz(on[k])}`).join("");
  return { tytul, opis, wiadomosc };
}

// ─── Ustawienia ─────────────────────────────────────────────────────────────

function sprawdzUstawienia(u: unknown): Ustawienia {
  if (!obiekt(u)) throw new Error("brak wiersza ustawień kalibracji");
  const { tryb, galaz, odbiorca, dane_od } = u;
  if (tryb !== "wylaczony" && tryb !== "na_sucho" && tryb !== "propozycja") {
    throw new Error(`ustawienia: nieznany tryb „${bezDanych(String(tryb)).slice(0, 20)}"`);
  }
  if (typeof galaz !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/.test(galaz) || galaz.includes("..") || galaz === GALAZ_BOTA) {
    throw new Error("ustawienia: niepoprawna gałąź produkcyjna");
  }
  if (typeof odbiorca !== "string" || !/^[^\s@<>,;"']+@[^\s@<>,;"']+\.[A-Za-z]{2,}$/.test(odbiorca)) {
    throw new Error("ustawienia: niepoprawny odbiorca");
  }
  if (dane_od !== null && dane_od !== undefined && !dataPoprawna(dane_od)) throw new Error("ustawienia: niepoprawne dane_od");
  return { tryb, galaz, odbiorca, dane_od: (dane_od as string | null) ?? null };
}

// ─── Wejście ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Tylko POST od crona. GET od robota nie robi nic.
  if (req.method !== "POST") return new Response("niedozwolona metoda", { status: 405 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Bramka: token z Vaulta, sprawdzany PRZED pierwszym odczytem danych.
  const token = req.headers.get("x-cron-token") ?? "";
  if (!token) return new Response("brak nagłówka x-cron-token", { status: 401 });
  const { data: zgoda, error: bladTokenu } = await supabase.rpc("edge_cron_token_matches", { token });
  if (bladTokenu) {
    await logError(ZRODLO_BLEDU, `Kalibrator: nie mogę sprawdzić tokenu (${bezDanych(String(bladTokenu.message))})`);
    return new Response("nie mogę sprawdzić tokenu", { status: 503 });
  }
  // Zły token — bez wpisu w ud_errors: cron bierze token z tego samego Vaulta,
  // więc zły to zawsze ktoś z zewnątrz, a wpis za każde żądanie zapychałby dziennik.
  if (zgoda !== true) return new Response("zły nagłówek x-cron-token", { status: 401 });

  const stan: { ustawienia?: Ustawienia } = {};
  try {
    return await przebieg(supabase, stan);
  } catch (e) {
    return await obsluzBlad(supabase, stan, e);
  }
});

async function przebieg(supabase: Klient, stan: { ustawienia?: Ustawienia }): Promise<Response> {
  const teraz = new Date();

  const { data: wiersz, error: bladUstawien } = await supabase
    .from("ud_kalibracja_ustawienia")
    .select("tryb, galaz, odbiorca, dane_od")
    .eq("id", true)
    .maybeSingle();
  if (bladUstawien) throw new Error(`odczyt ustawień: ${bladUstawien.message}`);
  const ustawienia = sprawdzUstawienia(wiersz);
  stan.ustawienia = ustawienia;

  if (ustawienia.tryb === "wylaczony") {
    await zapiszPrzebieg(supabase, { tryb: "wylaczony", wynik: "wylaczony", mail_wyslany: false });
    return json({ ok: true, wynik: "wylaczony" });
  }

  const { data: wpisy, error: bladHistorii } = await supabase
    .from("ud_kalibracja_przebiegi")
    .select("uruchomiono, wynik, powod, mail_wyslany, na_stronie")
    .gte("uruchomiono", new Date(teraz.getTime() - 31 * DZIEN_MS).toISOString())
    .order("uruchomiono", { ascending: false })
    .limit(500);
  if (bladHistorii) throw new Error(`odczyt dziennika: ${bladHistorii.message}`);
  const historia = (wpisy ?? []) as Wpis[];

  const { data: wynikSql, error: bladSql } = await supabase.rpc("ud_kalibracja_stawek", { p_dane_od: ustawienia.dane_od });
  if (bladSql) throw new Error(`ud_kalibracja_stawek: ${bladSql.message}`);

  const tokenGh = Deno.env.get("GITHUB_KALIBRATOR_TOKEN") || undefined;
  const gh = klientGitHuba(tokenGh, ustawienia.galaz);
  const { tekst: obecnyTekst } = await pobierzPlik(gh, ustawienia.galaz);
  let obecny: unknown;
  try {
    obecny = JSON.parse(obecnyTekst);
  } catch {
    obecny = undefined;
  }

  const naStronie = await sprawdzStrone(obecny);
  const ocena = ocen(wynikSql, obecny, dzisWarszawa(teraz));
  const bledy = [...ocena.bledy];

  // Uwagi z alarmem wymuszają mail, nawet gdy przebieg sam z siebie by milczał.
  const uwagi: Uwaga[] = [...ocena.uwagi];
  for (const d of ocena.doDecyzji) {
    const znacznik = `do decyzji: okres ${d.okres} ×${mnoz(d.mnoznik)}`;
    if (byloWDniach(historia, znacznik, DNI_DO_DECYZJI_PRZERWA, teraz)) continue;
    uwagi.push({
      alarm: true,
      znacznik,
      tekst: `Do decyzji: dane dają mnożnik ${mnoz(d.mnoznik)} dla okresu ${d.okres} mies. (≥ 3 osoby z parą). ` +
        "Kalibrator nie dopisuje nowych okresów do pliku — dopisanie to decyzja właściciela.",
    });
  }
  const wygasa = dniDoWygasniecia(gh.wygasa(), teraz);
  if (wygasa && wygasa.dni <= DNI_TOKEN_OSTRZEZENIE && !byloWDniach(historia, ZNACZNIK_TOKENU, DNI_TOKEN_PRZERWA, teraz)) {
    uwagi.push({
      alarm: true,
      znacznik: ZNACZNIK_TOKENU,
      tekst: `Token GitHuba (GITHUB_KALIBRATOR_TOKEN) wygasa ${dataPl(wygasa.data)}` +
        (wygasa.dni > 0 ? ` — za ${Math.ceil(wygasa.dni)} dni.` : " — już wygasł.") +
        " Nowy: fine-grained, tylko aurabroker/ud, Contents i Pull requests: write; podmiana w Edge Functions → Secrets.",
    });
  }
  const sprawdzone = historia.filter((h) => typeof h.na_stronie === "boolean");
  if (naStronie === false && sprawdzone[0]?.na_stronie === false && sprawdzone[1]?.na_stronie !== false) {
    uwagi.push({
      alarm: true,
      znacznik: ZNACZNIK_STRONY,
      tekst: `Strona ${STRONA_MD} drugi przebieg z rzędu nie pokazuje przedziału ${zakres(SWIADCZENIE_STRONY, pole(obecny, "stawka"))} ` +
        `dla ${zl(SWIADCZENIE_STRONY)}, policzonego z pliku na gałęzi ${ustawienia.galaz}. Sprawdź wdrożenie w Cloudflare Pages.`,
    });
  }

  const k: Kontekst = {
    ustawienia, teraz, obecny, obecnyTekst, wynikSql,
    kandydat: ocena.kandydat, zmiana: ocena.zmiana, bledy, uwagi, doDecyzji: ocena.doDecyzji, naStronie,
  };

  let wynik: string;
  let powod: string;
  let mail: Mail | null = null;
  let prNumer: number | null = null;
  let skrot: string | null = null;

  if (ustawienia.tryb === "na_sucho") {
    // Codzienny mail, bez względu na wynik. Żadnych zapisów do GitHuba.
    wynik = bledy.length ? "odmowa" : "na_sucho";
    powod = bledy.length ? bledy.join("; ") : ocena.zmiana ? "na sucho: stawki się zmieniły" : "na sucho: bez zmian";
    mail = mailNaSucho(k);
  } else if (bledy.length) {
    wynik = "odmowa";
    powod = bledy.join("; ");
    if (!powtorzenie(historia, wynik, powod)) mail = mailOdmowa(k, bledy);
  } else if (!ocena.zmiana) {
    wynik = "bez_zmian";
    powod = "bez zmian";
    if (dniOdOstatniegoMaila(historia, teraz) >= DNI_POTWIERDZENIA) {
      mail = mailBezZmian(k);
      powod = "bez zmian — comiesięczne potwierdzenie";
    }
  } else if (!tokenGh) {
    wynik = "odmowa";
    powod = "brak GITHUB_KALIBRATOR_TOKEN — propozycji zmiany nie da się złożyć";
    if (!powtorzenie(historia, wynik, powod)) mail = mailOdmowa(k, [powod]);
  } else {
    const kandydat = ocena.kandydat as Json;
    skrot = await sha256(kanoniczny({ stawka: kandydat.stawka, okresy: kandydat.okresy }));
    const prs = await listaPr(gh);
    const zTymSkrotem = prs.filter((p) => String(p.body ?? "").includes(skrot as string));
    const czeka = zTymSkrotem.find((p) => p.state === "open");
    const odrzucony = zTymSkrotem.find((p) => p.state === "closed" && !p.merged_at);
    if (czeka) {
      wynik = "propozycja";
      prNumer = czeka.number;
      powod = `PR #${czeka.number} z tą propozycją już czeka na decyzję`;
    } else if (odrzucony) {
      // Właściciel zamknął ten PR bez scalenia — te same liczby nie wracają.
      wynik = "odmowa";
      prNumer = odrzucony.number;
      powod = `propozycja odrzucona przez właściciela (PR #${odrzucony.number} zamknięty bez scalenia) — bez ponawiania`;
    } else {
      const { tytul, opis, wiadomosc } = opisPr(obecny, kandydat, skrot, ustawienia.galaz);
      const pr = await zlozPropozycje(gh, ustawienia.galaz, {
        obecnyTekst,
        kandydatTekst: formatPliku(kandydat),
        tytul,
        opis,
        wiadomosc,
        otwarty: prs.find((p) => p.state === "open"),
      });
      wynik = "propozycja";
      prNumer = pr.numer;
      powod = pr.zaktualizowany ? `PR #${pr.numer} zaktualizowany` : `PR #${pr.numer} utworzony`;
      mail = mailPropozycja(k, pr);
    }
  }

  const alarmy = uwagi.filter((u) => u.alarm);
  if (!mail && alarmy.length) mail = mailUwagi(k);
  const wyslany = mail ? await wyslijMail(ustawienia.odbiorca, mail) : false;
  // Znacznik trafia do dziennika tylko wtedy, gdy mail z uwagą naprawdę wyszedł.
  if (wyslany) {
    const znaczniki = alarmy.map((u) => u.znacznik).filter((z): z is string => Boolean(z));
    if (znaczniki.length) powod += SEPARATOR_ZNACZNIKOW + znaczniki.join(SEPARATOR_ZNACZNIKOW);
  }

  await zapiszPrzebieg(supabase, {
    tryb: ustawienia.tryb,
    wynik,
    wyliczone: doDziennika(wynikSql),
    powod,
    pr_numer: prNumer,
    propozycja_hash: skrot,
    mail_wyslany: wyslany,
    na_stronie: naStronie,
  });
  return json({ ok: true, wynik, zmiana: ocena.zmiana, pr_numer: prNumer, na_stronie: naStronie, mail: wyslany });
}

async function zapiszPrzebieg(supabase: Klient, wpis: Json) {
  const { error } = await supabase.from("ud_kalibracja_przebiegi").insert(wpis);
  if (error) throw new Error(`zapis dziennika: ${error.message}`);
}

/**
 * Każdy wyjątek: wpis „blad" w dzienniku, ud_errors i mail — ale ten sam błąd
 * dzień po dniu nie wysyła maila drugi raz (porównanie z ostatnim wpisem).
 */
async function obsluzBlad(supabase: Klient, stan: { ustawienia?: Ustawienia }, e: unknown): Promise<Response> {
  const komunikat = bezDanych(String((e as { message?: string })?.message ?? e));
  await logError(ZRODLO_BLEDU, `Kalibrator: ${komunikat}`);
  let ostatni: { wynik?: string; powod?: string | null } | undefined;
  try {
    const { data } = await supabase
      .from("ud_kalibracja_przebiegi")
      .select("wynik, powod")
      .order("uruchomiono", { ascending: false })
      .limit(1);
    ostatni = (data ?? [])[0] as typeof ostatni;
  } catch {
    ostatni = undefined;
  }
  const powtorka = ostatni?.wynik === "blad" && rdzen(ostatni?.powod) === komunikat;
  let wyslany = false;
  if (!powtorka) {
    try {
      wyslany = await wyslijMail(stan.ustawienia?.odbiorca ?? ODBIORCA_DOMYSLNY, mailBledu(komunikat));
    } catch {
      wyslany = false;
    }
  }
  try {
    const { error } = await supabase.from("ud_kalibracja_przebiegi").insert({
      tryb: stan.ustawienia?.tryb ?? "nieznany",
      wynik: "blad",
      powod: komunikat,
      mail_wyslany: wyslany,
    });
    if (error) await logError(ZRODLO_BLEDU, `Kalibrator: nie mogę zapisać dziennika (${bezDanych(String(error.message))})`);
  } catch {
    // dziennik niedostępny — ud_errors już ma wpis
  }
  return json({ ok: false, wynik: "blad" }, 500);
}
