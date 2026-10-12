/**
 * newsletter.mjs — buduje wydanie newslettera z newsletter/<wydanie>.json.
 *
 *   node scripts/newsletter.mjs 2026-10
 *
 * Wynik to newsletter/<wydanie>.html — jeden plik do wklejenia w Resend
 * (Broadcasts). Tytuły, adresy i zdjęcia artykułów bierze z artykuly.json,
 * dane spółki z firma.ts, więc w pliku wydania zostaje tylko to, czego nie ma
 * nigdzie indziej: zajawki, temat i kolejność.
 *
 * Dlaczego HTML jest taki staroświecki (tabele, style w atrybutach, Georgia
 * i Arial): Outlook na Windowsie renderuje pocztę silnikiem Worda, a Gmail
 * wycina większość arkusza. Media query w <style> działa w Gmailu, Apple Mail
 * i aplikacjach mobilnych; Outlook go ignoruje, ale tam i tak jest ekran
 * komputera.
 *
 * Zdjęcia idą jako JPEG z public/email/, a nie WebP z kubełka: Outlook na
 * Windowsie WebP-a nie pokazuje. Adresy muszą żyć wiecznie — wysłany mail
 * wskazuje je latami — dlatego nie /_astro/ (nazwa zmienia się z każdym
 * buildem) i dlatego nie wolno ich potem kasować ani przemianowywać.
 * Pilnuje tego test/newsletter.spec.js.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FIRMA, SERWIS } from '../src/lib/firma.ts';

// Wbudowany fetch Node'a nie czyta HTTPS_PROXY; NODE_USE_ENV_PROXY działa
// tylko od startu procesu (ten sam wzorzec co w obciazenie-formularza.mjs).
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const { status } = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(status ?? 1);
}

const PORTAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const wydanie = process.argv[2];
if (!wydanie) {
  console.error('Podaj wydanie, np.: node scripts/newsletter.mjs 2026-10');
  process.exit(1);
}

const dane = JSON.parse(readFileSync(join(PORTAL, `newsletter/${wydanie}.json`), 'utf8'));
const { artykuly } = JSON.parse(readFileSync(join(PORTAL, 'src/dane/artykuly.json'), 'utf8'));

/** Paleta serwisu (global.css), dobrana pod kontrast na bieli. */
const K = {
  tekst: '#0F2E40',
  drugi: '#4E6D7D',
  akcentTekst: '#0A6A96',
  akcent: '#1BAEE5',
  linia: '#D3E9F4',
  tlo: '#F4FBFE',
  tloCyjan: '#EDF7FC',
};
const SZERYF = "Georgia, 'Times New Roman', serif";
const BEZSZERYF = 'Arial, Helvetica, sans-serif';

const esc = (t) => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Jednoliterowe spójniki i przyimki nie zostają na końcu wiersza. */
const tekst = (t) => esc(t).replace(/(^|\s)([aiouwzAIOUWZ])\s/g, '$1$2&nbsp;');

/**
 * UTM-y: źródło „newsletter", kanał „email", kampania z wydania, a w
 * utm_content miejsce w mailu — wtedy w GA4 widać, czy klikano zdjęcie
 * artykułu wiodącego, czy kalkulator.
 */
function zUtm(adres, miejsce) {
  const u = new URL(adres);
  u.searchParams.set('utm_source', 'newsletter');
  u.searchParams.set('utm_medium', 'email');
  u.searchParams.set('utm_campaign', dane.kampania);
  u.searchParams.set('utm_content', miejsce);
  return u.toString().replace(/&/g, '&amp;');
}

const artykul = (slug) => {
  const a = artykuly.find((x) => x.slug === slug);
  if (!a) throw new Error(`Nie ma artykułu „${slug}" w artykuly.json`);
  return a;
};

/**
 * JPEG do maila z wariantu 1600 px w kubełku. Robiony raz: istniejący plik
 * zostaje, bo mógł już wyjść w wysłanym mailu.
 */
async function obrazDoMaila(a) {
  const katalog = join(PORTAL, 'public/email/artykuly');
  mkdirSync(katalog, { recursive: true });
  const wyniki = {};
  for (const szer of [1200, 600]) {
    const plik = join(katalog, `${a.slug}-${szer}.jpg`);
    if (!existsSync(plik)) {
      if (!a.obrazDuzy) throw new Error(`„${a.slug}" nie ma okładki`);
      const odp = await fetch(a.obrazDuzy);
      if (!odp.ok) throw new Error(`${a.obrazDuzy}: ${odp.status}`);
      await sharp(Buffer.from(await odp.arrayBuffer()))
        .resize({ width: szer, height: Math.round((szer * 2) / 3), fit: 'cover', position: 'attention' })
        .jpeg({ quality: szer > 600 ? 74 : 78, mozjpeg: true, progressive: true })
        .toFile(plik);
      console.log('zapisano', plik.replace(PORTAL + '/', ''));
    }
    wyniki[szer] = `${SERWIS.url}/email/artykuly/${a.slug}-${szer}.jpg`;
  }
  return wyniki;
}

const przycisk = (adres, napis) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${K.akcentTekst}" style="border-radius:4px;">
<a href="${adres}" style="display:inline-block;padding:13px 26px;font-family:${BEZSZERYF};font-size:16px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;border-radius:4px;">${tekst(napis)}</a>
</td></tr></table>`;

const wiodacy = artykul(dane.wiodacy.slug);
const dalej = dane.dalej.map((d) => ({ ...d, a: artykul(d.slug) }));
const obrazWiodacy = await obrazDoMaila(wiodacy);
for (const d of dalej) d.obraz = await obrazDoMaila(d.a);

const adresArtykulu = (a, miejsce) => zUtm(`${SERWIS.url}/blog/${a.slug}/`, miejsce);
const adresWiodacy = adresArtykulu(wiodacy, 'temat-numeru');

const kolumna = (d, i) => {
  const adres = adresArtykulu(d.a, `artykul-${i + 2}`);
  return `
<td class="kolumna" width="264" valign="top" style="width:264px;padding:0 ${i === 0 ? '12px 0 0' : '0 0 12px'};">
  <a href="${adres}"><img src="${d.obraz[600]}" width="264" height="176" alt="${esc(d.a.tytul)}" class="obraz-pelny" style="display:block;width:264px;height:auto;border-radius:4px;"></a>
  <h3 style="margin:16px 0 8px;font-family:${SZERYF};font-size:19px;line-height:25px;font-weight:normal;color:${K.tekst};">
    <a href="${adres}" style="color:${K.tekst};text-decoration:none;">${tekst(d.a.tytul)}</a></h3>
  <p style="margin:0 0 10px;font-family:${BEZSZERYF};font-size:15px;line-height:23px;color:${K.drugi};">${tekst(d.zajawka)}</p>
  <a href="${adres}" style="font-family:${BEZSZERYF};font-size:15px;font-weight:bold;color:${K.akcentTekst};text-decoration:none;">Czytaj dalej&nbsp;&rarr;</a>
</td>`;
};

const a = FIRMA.adres;
/** Numer telefonu nie może się łamać w środku. */
const telefon = FIRMA.telefonWyswietlany.replace(/ /g, '&nbsp;');
const html = `<!doctype html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(dane.temat)}</title>
<style>
  body { margin: 0; padding: 0; }
  img { border: 0; outline: none; text-decoration: none; }
  @media (max-width: 620px) {
    .kontener { width: 100% !important; }
    .wnetrze { padding-left: 20px !important; padding-right: 20px !important; }
    .kolumna { display: block !important; width: 100% !important; padding: 0 0 28px 0 !important; }
    .obraz-pelny { width: 100% !important; height: auto !important; }
    .tytul-wiodacy { font-size: 24px !important; line-height: 30px !important; }
    .logo { width: 170px !important; height: auto !important; }
    .data { letter-spacing: 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${K.tlo};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${K.tlo};">${esc(dane.preheader)}${'&#8199;&#847;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${K.tlo}" style="background-color:${K.tlo};">
<tr><td align="center" style="padding:24px 10px;">

<table role="presentation" class="kontener" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid ${K.linia};">

<!-- Nagłówek -->
<tr><td class="wnetrze" style="padding:22px 24px 18px;border-top:4px solid ${K.akcent};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle"><a href="${zUtm(`${SERWIS.url}/`, 'logo')}"><img src="${SERWIS.url}/email/logo-utratadochodu.png" width="207" height="44" alt="UtrataDochodu.pl" class="logo" style="display:block;width:207px;height:44px;"></a></td>
    <td valign="middle" align="right" class="data" style="white-space:nowrap;font-family:${BEZSZERYF};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${K.drugi};">${esc(dane.miesiac)}</td>
  </tr></table>
</td></tr>

<!-- Wstęp -->
<tr><td class="wnetrze" style="padding:8px 24px 4px;font-family:${BEZSZERYF};font-size:16px;line-height:25px;color:${K.drugi};">
  <p style="margin:0 0 6px;color:${K.tekst};">Dzień dobry,</p>
  <p style="margin:0;">${tekst(dane.wstep)}</p>
</td></tr>

<!-- Temat numeru -->
<tr><td class="wnetrze" style="padding:26px 24px 30px;">
  <p style="margin:0 0 12px;font-family:${BEZSZERYF};font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${K.akcentTekst};">Temat numeru</p>
  <a href="${adresWiodacy}"><img src="${obrazWiodacy[1200]}" width="552" height="368" alt="${esc(wiodacy.tytul)}" class="obraz-pelny" style="display:block;width:552px;height:auto;border-radius:4px;"></a>
  <h1 class="tytul-wiodacy" style="margin:22px 0 12px;font-family:${SZERYF};font-size:28px;line-height:35px;font-weight:normal;color:${K.tekst};">
    <a href="${adresWiodacy}" style="color:${K.tekst};text-decoration:none;">${tekst(wiodacy.tytul)}</a></h1>
  ${dane.wiodacy.zajawka.map((z) => `<p style="margin:0 0 14px;font-family:${BEZSZERYF};font-size:16px;line-height:25px;color:${K.drugi};">${tekst(z)}</p>`).join('\n  ')}
  <div style="height:8px;line-height:8px;font-size:8px;">&nbsp;</div>
  ${przycisk(adresWiodacy, dane.wiodacy.przycisk)}
</td></tr>

<!-- Warto przeczytać -->
<tr><td class="wnetrze" style="padding:28px 24px 8px;border-top:1px solid ${K.linia};">
  <h2 style="margin:0 0 18px;font-family:${SZERYF};font-size:22px;line-height:28px;font-weight:normal;color:${K.tekst};">Warto przeczytać</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${dalej.map(kolumna).join('')}
  </tr></table>
</td></tr>

<!-- Kalkulator -->
<tr><td class="wnetrze" style="padding:12px 24px 30px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${K.tloCyjan}" style="background-color:${K.tloCyjan};border-left:3px solid ${K.akcent};">
  <tr><td style="padding:22px 22px 24px;">
    <h2 style="margin:0 0 8px;font-family:${SZERYF};font-size:20px;line-height:26px;font-weight:normal;color:${K.tekst};">${tekst(dane.kalkulator.tytul)}</h2>
    <p style="margin:0 0 16px;font-family:${BEZSZERYF};font-size:15px;line-height:23px;color:${K.drugi};">${tekst(dane.kalkulator.tekst)}</p>
    ${przycisk(zUtm(`${SERWIS.url}/kalkulator/`, 'kalkulator'), dane.kalkulator.przycisk)}
    <p style="margin:14px 0 0;font-family:${BEZSZERYF};font-size:14px;line-height:21px;color:${K.drugi};">Wolisz porozmawiać? Zadzwoń: <a href="tel:${FIRMA.telefon}" style="color:${K.akcentTekst};font-weight:bold;text-decoration:none;">${telefon}</a></p>
  </td></tr></table>
</td></tr>

<!-- Stopka -->
<tr><td class="wnetrze" bgcolor="${K.tlo}" style="padding:24px 24px 28px;background-color:${K.tlo};border-top:1px solid ${K.linia};font-family:${BEZSZERYF};font-size:13px;line-height:20px;color:${K.drugi};">
  <p style="margin:0 0 14px;">Serwis internetowy ${esc(FIRMA.marka)} prowadzi ${esc(FIRMA.nazwa)}, ${esc(a.ulica)}, ${esc(a.kod)} ${esc(a.miasto)}. KRS ${FIRMA.krs}, NIP ${FIRMA.nip}. Agent ubezpieczeniowy wpisany do Rejestru Pośredników Ubezpieczeniowych KNF pod numerem ${esc(FIRMA.rpu)}.</p>
  <p style="margin:0;">Pytania? Odpowiedz na tego maila albo zadzwoń: ${telefon}. Możesz <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${K.akcentTekst};text-decoration:underline;">się wypisać z&nbsp;newslettera</a>, ale&nbsp;po&nbsp;co?</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
`;

const wyjscie = join(PORTAL, `newsletter/${wydanie}.html`);
writeFileSync(wyjscie, html);
console.log(`gotowe: newsletter/${wydanie}.html (${Buffer.byteLength(html)} B)`);
console.log(`temat: ${dane.temat}`);
