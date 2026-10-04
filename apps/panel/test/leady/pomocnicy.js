/**
 * Pomocniki testów przeglądarkowych tablicy leadów.
 */
import { expect } from '@playwright/test';

export const adres = () => process.env.LEADY_URL;

export async function reset(request) {
  const r = await request.post(`${adres()}/__test/reset`);
  expect(r.ok()).toBeTruthy();
}

/** Dowolne SQL na bazie testowej; zwraca tekst pierwszej kolumny ostatniego wiersza. */
export async function sql(request, zapytanie) {
  const r = await request.post(`${adres()}/__test/sql`, { data: { sql: zapytanie } });
  const body = await r.json();
  expect(r.ok(), JSON.stringify(body)).toBeTruthy();
  return body.wynik;
}

/** Następne N żądań pod daną ścieżką API zakończy się awarią (tryb: zgubOdpowiedz | zerwij | odpowiedz | opoznienie). */
export async function awaria(request, ustawienia) {
  const r = await request.post(`${adres()}/__test/awaria`, { data: ustawienia });
  expect(r.ok()).toBeTruthy();
}

export async function wyczyscAwarie(request) {
  const r = await request.post(`${adres()}/__test/awaria`, { data: { wyczysc: true } });
  expect(r.ok()).toBeTruthy();
}

export async function wywolania(request) {
  const r = await request.get(`${adres()}/__test/wywolania`);
  return (await r.json()).wywolania;
}

/** Otwiera tablicę jako dany użytkownik (adm | ula | olek | ines | brak). Domyślnie administrator: widzi wszystkie leady (od 02.10.2026 agent tylko swoje). */
export async function otworz(page, { u = 'adm', zapytanie = '' } = {}) {
  await page.goto(`${adres()}/test/leady/harness.html?u=${u}${zapytanie ? `&${zapytanie}` : ''}`);
  await page.waitForSelector('html[data-gotowe]');
}

export const karta = (page, nazwa) => page.locator('[data-karta-id]', { has: page.getByRole('button', { name: new RegExp(`^${nazwa}`) }) });
export const kolumna = (page, klucz) => page.locator(`section[data-etap-klucz="${klucz}"]`);
export const zwiniety = (page, nazwa) => page.locator('[data-zw-id]', { hasText: nazwa });
export const leadId = (request, nazwa) => sql(request, `select tt.lead('${nazwa}')`);
export const etapId = (request, klucz) => sql(request, `select tt.etap('${klucz}')`);
export const etapLeada = (request, nazwa) => sql(request, `select tt.etap_leada(tt.lead('${nazwa}'))`);
export const wersjaLeada = async (request, nazwa) => Number(await sql(request, `select tt.wersja(tt.lead('${nazwa}'))`));
export const liczbaHistorii = async (request, nazwa) => Number(await sql(request, `select tt.hist(tt.lead('${nazwa}'))`));

/** Nazwy kart w kolumnie, od góry. */
export async function nazwyKart(page, klucz) {
  return kolumna(page, klucz).locator('[data-karta-id] .nazwa').allInnerTexts();
}

/**
 * Przeciąganie myszą: z punktu w karcie (domyślnie tekst „kontekst" — element
 * nieinteraktywny) na środek celu, krokami, żeby przeglądarka wygenerowała
 * normalne zdarzenia pointermove.
 */
export async function przeciagnij(page, zrodlo, cel, { kroki = 14, puszczaj = true, punkt = null } = {}) {
  await zrodlo.scrollIntoViewIfNeeded();
  const z = await (zrodlo.locator('.kontekst').first()).boundingBox();
  const c = await cel.boundingBox();
  const start = { x: z.x + 12, y: z.y + z.height / 2 };
  const koniec = punkt ?? { x: c.x + c.width / 2, y: c.y + Math.min(c.height / 2, 160) };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 3, start.y + 3);       // poniżej progu: jeszcze nie przeciąganie
  await page.mouse.move(koniec.x, koniec.y, { steps: kroki });
  if (puszczaj) await page.mouse.up();
  return { start, koniec };
}

export const status = (page) => page.locator('[data-komunikat-status]');
export const alert = (page) => page.locator('[data-komunikat-alert]');
export const toast = (page) => page.locator('[data-toast]');

/**
 * Przeciąganie na kolumnę poza widocznym obszarem: wskaźnik idzie do prawej
 * krawędzi tablicy i czeka, aż autoprzewijanie przywiezie cel — dokładnie tak,
 * jak zrobiłby to człowiek. Nie dotykamy scrollLeft ręcznie.
 */
export async function przeciagnijZPrzewijaniem(page, zrodlo, celKlucz, { puszczaj = true } = {}) {
  await zrodlo.scrollIntoViewIfNeeded();
  const z = await zrodlo.locator('.kontekst').first().boundingBox();
  const start = { x: z.x + 12, y: z.y + z.height / 2 };
  const obszar = await page.locator('[data-przewijanie-poziome]').boundingBox();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 4);
  await page.mouse.move(obszar.x + obszar.width - 24, obszar.y + 220, { steps: 12 });
  const cel = page.locator(`section[data-etap-klucz="${celKlucz}"]`);
  await expect.poll(async () => {
    const b = await cel.boundingBox();
    return b ? b.x + b.width / 2 < obszar.x + obszar.width - 30 : false;
  }, { timeout: 15_000, intervals: [100] }).toBe(true);
  const b = await cel.boundingBox();
  await page.mouse.move(b.x + b.width / 2, obszar.y + 260, { steps: 8 });
  if (puszczaj) await page.mouse.up();
}
