/* Status page — jeden plik HTML generowany przez Workera.
   Bez zewnętrznych zasobów: ma działać także wtedy, gdy pół internetu leży. */

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const czasPl = iso => iso
  ? new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
  : '—';

function pasek(historia) {
  /* 60 najnowszych prób, od najstarszej do najnowszej */
  const h = historia.slice(0, 60).reverse();
  if (!h.length) return '<span class="brak">brak danych</span>';
  return h.map(w => `<i class="${w.ok ? 'ok' : 'zle'}" title="${czasPl(w.czas)} — ${w.ok ? `${w.ms} ms` : esc(w.blad)}"></i>`).join('');
}

export function stronaHtml(sprawdzenia, dane, zdarzenia) {
  const wiersze = sprawdzenia.map(def => {
    const d = dane[def.id];
    const stan = d?.stan;
    const status = stan?.status || 'unknown';
    const staty = d?.staty;
    const dostepnosc = staty && staty.razem ? ((staty.udane / staty.razem) * 100).toFixed(2) : null;
    return `
      <tr class="${status}">
        <td>
          <span class="kropka ${status}"></span>
          <strong>${esc(def.nazwa)}</strong>
          ${def.krytyczny ? '<span class="tag">krytyczne</span>' : ''}
          <div class="szczegol">${esc(stan?.ostatni_wynik || '—')}</div>
        </td>
        <td class="pasek">${pasek(d?.historia || [])}</td>
        <td class="liczba">${dostepnosc ? dostepnosc + '%' : '—'}</td>
        <td class="liczba">${staty?.sredniMs ? Math.round(staty.sredniMs) + ' ms' : '—'}</td>
        <td class="liczba">${czasPl(stan?.ostatnie_sprawdzenie)}</td>
      </tr>`;
  }).join('');

  const awarie = sprawdzenia.filter(def => dane[def.id]?.stan?.status === 'down');
  const naglowek = awarie.length
    ? `<div class="baner zle">${awarie.length === 1 ? 'Trwa awaria' : `Trwają ${awarie.length} awarie`}: ${awarie.map(a => esc(a.nazwa)).join(', ')}</div>`
    : '<div class="baner ok">Wszystko działa</div>';

  const listaZdarzen = zdarzenia.length
    ? zdarzenia.map(z => `<li><span class="czas">${czasPl(z.czas)}</span> <b>${esc(z.rodzaj)}</b> ${esc(z.sprawdzenie || '')} — ${esc(z.tresc).slice(0, 200)}</li>`).join('')
    : '<li class="brak">Brak zdarzeń z ostatnich 30 dni.</li>';

  return `<!doctype html><html lang="pl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Monitor — UtrataDochodu</title>
<style>
  :root{--tlo:#f8fafc;--karta:#fff;--tekst:#0f172a;--szary:#64748b;--linia:#e2e8f0;--ok:#16a34a;--zle:#dc2626;--nieznane:#94a3b8}
  @media (prefers-color-scheme:dark){:root{--tlo:#0f172a;--karta:#1e293b;--tekst:#f1f5f9;--szary:#94a3b8;--linia:#334155}}
  *{box-sizing:border-box}
  body{margin:0;padding:24px 16px;background:var(--tlo);color:var(--tekst);
       font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5}
  .kontener{max-width:1000px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px}
  .podtytul{color:var(--szary);font-size:13px;margin-bottom:20px}
  .baner{padding:14px 18px;border-radius:12px;font-weight:700;margin-bottom:20px}
  .baner.ok{background:rgba(22,163,74,.12);color:var(--ok)}
  .baner.zle{background:rgba(220,38,38,.12);color:var(--zle)}
  table{width:100%;border-collapse:collapse;background:var(--karta);border-radius:12px;overflow:hidden}
  th,td{padding:12px 14px;text-align:left;border-bottom:1px solid var(--linia);vertical-align:middle}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--szary);font-weight:700}
  tr:last-child td{border-bottom:0}
  .kropka{display:inline-block;width:9px;height:9px;border-radius:9999px;margin-right:8px;background:var(--nieznane)}
  .kropka.up{background:var(--ok)} .kropka.down{background:var(--zle)}
  .tag{font-size:10px;background:rgba(220,38,38,.12);color:var(--zle);padding:2px 6px;border-radius:5px;margin-left:6px;font-weight:700}
  .szczegol{color:var(--szary);font-size:12px;margin-top:3px;margin-left:17px}
  .pasek{white-space:nowrap;min-width:200px}
  .pasek i{display:inline-block;width:3px;height:22px;margin-right:1px;border-radius:1px;background:var(--ok)}
  .pasek i.zle{background:var(--zle)}
  .liczba{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--szary)}
  .brak{color:var(--szary)}
  h2{font-size:14px;margin:28px 0 10px}
  ul{list-style:none;padding:0;margin:0;background:var(--karta);border-radius:12px}
  li{padding:10px 14px;border-bottom:1px solid var(--linia);font-size:13px}
  li:last-child{border-bottom:0}
  .czas{color:var(--szary);font-variant-numeric:tabular-nums;margin-right:8px}
  footer{color:var(--szary);font-size:12px;margin-top:24px;text-align:center}
  @media(max-width:720px){.pasek,th.pasek{display:none}}
</style></head><body><div class="kontener">
<h1>Monitor aplikacji</h1>
<div class="podtytul">Odświeżane automatycznie co 60 sekund. Dane z ostatnich 24 godzin.</div>
${naglowek}
<table>
  <thead><tr><th>Sprawdzenie</th><th class="pasek">Ostatnia godzina</th><th class="liczba">Dostępność 24h</th><th class="liczba">Śr. czas</th><th class="liczba">Ostatnio</th></tr></thead>
  <tbody>${wiersze}</tbody>
</table>
<h2>Zdarzenia</h2>
<ul>${listaZdarzen}</ul>
<footer>Wygenerowano ${czasPl(new Date().toISOString())} • monitor działa na Cloudflare Workers</footer>
</div>
<script>setTimeout(function(){location.reload()},60000)</script>
</body></html>`;
}
