/**
 * strona.js — strona statusu.
 *
 * Bez frameworka i bez zewnętrznych zasobów: ma się wyświetlić także wtedy,
 * gdy pada to, co monitorujemy. Paleta z systemu portalu, żeby nie wyglądała
 * jak cudza strona.
 */

const esc = (t) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const czasPl = (ms) =>
  new Date(ms).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });

/** „3 godz. 12 min" — ludzie czytają czas trwania, nie znaczniki czasu. */
export function trwanie(odMs, teraz = Date.now()) {
  const minut = Math.max(0, Math.round((teraz - odMs) / 60_000));
  if (minut < 60) return `${minut} min`;
  const godzin = Math.floor(minut / 60);
  if (godzin < 24) return `${godzin} godz. ${minut % 60} min`;
  return `${Math.floor(godzin / 24)} dni ${godzin % 24} godz.`;
}

export function html({ stan, podsumowanie, awarie, okno }) {
  const wszystkoOk = stan.every((s) => s.ok === 1);
  const dostepnosc = new Map(
    podsumowanie.map((p) => [p.sonda, {
      procent: p.pomiarow ? (100 * p.udanych) / p.pomiarow : null,
      srednia: p.srednia_ms,
      max: p.max_ms,
    }]),
  );

  const wiersze = stan.map((s) => {
    const d = dostepnosc.get(s.sonda);
    const procent = d?.procent == null ? '—' : `${d.procent.toFixed(d.procent === 100 ? 0 : 1)}%`;
    return `<tr class="${s.ok ? '' : 'zle'}">
      <td><span class="kropka ${s.ok ? 'ok' : 'awaria'}" aria-hidden="true"></span>
          <span class="nazwa">${esc(s.sonda)}</span></td>
      <td>${s.ok ? 'Działa' : 'Awaria'}</td>
      <td class="mono">${esc(trwanie(s.od))}</td>
      <td class="mono">${procent}</td>
      <td class="mono">${d?.srednia == null ? '—' : `${d.srednia} ms`}</td>
      <td class="szcz">${esc(s.szczegoly ?? '')}</td>
    </tr>`;
  }).join('');

  const lista = awarie.length === 0
    ? '<p class="pusto">Brak niepowodzeń w zapisanej historii.</p>'
    : `<ul>${awarie.map((a) => `<li><span class="mono">${esc(czasPl(a.czas))}</span>
         <strong>${esc(a.sonda)}</strong>
         ${a.kod ? `<span class="mono">${a.kod}</span>` : ''}
         <span class="szcz">${esc(a.szczegoly ?? '')}</span></li>`).join('')}</ul>`;

  return `<!doctype html>
<html lang="pl"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${wszystkoOk ? 'Wszystko działa' : 'Awaria'} — status UtrataDochodu.pl</title>
<style>
  :root{--tlo:#fff;--jasne:#F4FBFE;--linia:#D3E9F4;--mocna:#BEDFF0;
        --tekst:#0F2E40;--drugi:#4E6D7D;--trzeci:#8AA3AF;--ok:#0E96D0;--zle:#D6453D}
  *{box-sizing:border-box}
  body{margin:0;background:var(--tlo);color:var(--tekst);
       font:15px/1.6 "Public Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .srodek{max-width:1100px;margin:0 auto;padding:32px 20px 64px}
  header{background:var(--jasne);border-bottom:1px solid var(--linia)}
  h1{font-size:clamp(1.6rem,4vw,2.4rem);line-height:1.1;margin:0 0 8px;letter-spacing:-.015em}
  h2{font-size:1.1rem;margin:40px 0 14px}
  .pod{color:var(--drugi);margin:0}
  .mono{font-family:ui-monospace,"IBM Plex Mono",monospace;font-size:13px;white-space:nowrap}
  table{width:100%;border-collapse:collapse;border:1px solid var(--linia)}
  th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--linia);vertical-align:top}
  thead th{background:var(--jasne);border-bottom:1px solid var(--mocna);
           font:600 11px/1.4 ui-monospace,monospace;letter-spacing:.11em;text-transform:uppercase;color:var(--drugi)}
  tbody tr:last-child td{border-bottom:0}
  tr.zle{background:#FDF4F3}
  .nazwa{font-weight:600}
  .kropka{display:inline-block;width:9px;height:9px;margin-right:9px;vertical-align:1px}
  .kropka.ok{background:var(--ok)} .kropka.awaria{background:var(--zle)}
  .szcz{color:var(--drugi);font-size:13.5px}
  ul{list-style:none;margin:0;padding:0;border:1px solid var(--linia)}
  li{padding:10px 14px;border-bottom:1px solid var(--linia);font-size:14px}
  li:last-child{border-bottom:0}
  li .mono{color:var(--trzeci);margin-right:10px}
  .pusto{color:var(--trzeci);border:1px dashed var(--mocna);padding:24px;text-align:center;margin:0}
  .stopka{color:var(--trzeci);font-size:13px;margin-top:36px}
  .przewin{overflow-x:auto}
</style></head>
<body>
<header><div class="srodek" style="padding-bottom:28px">
  <h1>${wszystkoOk ? 'Wszystko działa' : 'Wykryto awarię'}</h1>
  <p class="pod">${stan.length} sond · dostępność liczona z ostatnich ${okno} godz. ·
     odświeżono ${esc(czasPl(Date.now()))}</p>
</div></header>

<div class="srodek">
  <h2 style="margin-top:28px">Sondy</h2>
  <div class="przewin"><table>
    <thead><tr><th>Sonda</th><th>Stan</th><th>Od</th><th>Dostępność</th><th>Śr. czas</th><th>Ostatnia uwaga</th></tr></thead>
    <tbody>${wiersze || '<tr><td colspan="6" class="szcz">Brak pomiarów — monitor jeszcze nie wystartował.</td></tr>'}</tbody>
  </table></div>

  <h2>Ostatnie niepowodzenia</h2>
  ${lista}

  <p class="stopka">Monitoring UtrataDochodu.pl. Dane w Cloudflare D1, świadomie poza
     infrastrukturą, którą sprawdzamy.</p>
</div>
</body></html>`;
}
