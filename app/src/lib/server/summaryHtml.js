/**
 * summaryHtml.js — brandowany HTML podsumowania oferty (→ PDFShift → PDF).
 */
import { money, yesNo, insurerLabel } from '$lib/format.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const ROWS = [
  ['Ubezpieczyciel', (d) => insurerLabel(d.insurer_type)],
  ['Numer oferty', (d) => d.offer_number || '—'],
  ['Okres ubezpieczenia', (d) => d.insurance_period || '—'],
  ['Śmierć / inwalidztwo (NW)', (d) => yesNo(d.death_covered)],
  ['Okresowa niezdolność', (d) => yesNo(d.temp_incapacity_covered)],
  ['— świadczenie miesięczne', (d) => money(d.temp_monthly_benefit)],
  ['— suma ubezpieczenia', (d) => money(d.temp_sum_insured)],
  ['Trwała niezdolność', (d) => yesNo(d.perm_incapacity_covered)],
  ['— suma ubezpieczenia', (d) => money(d.perm_sum_insured)],
  ['Okres odszkodowawczy', (d) => d.indemnity_period || '—'],
  ['Wyczekiwanie (wypadek)', (d) => (d.wait_accident != null ? d.wait_accident + ' dni' : '—')],
  ['Wyczekiwanie (choroba)', (d) => (d.wait_illness != null ? d.wait_illness + ' dni' : '—')],
  ['Składka roczna (łącznie)', (d) => money(d.premium_total)],
  ['Rata miesięczna', (d) => money(d.premium_monthly)]
];

/**
 * @param {{ clientName?: string, offerName?: string, documents: any[] }} p
 * @returns {string} kompletny dokument HTML
 */
export function buildOfferSummaryHtml({ clientName, offerName, documents = [] }) {
  const today = new Date().toLocaleDateString('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' });
  const cols = documents.map((d) => `<th>${esc(insurerLabel(d.insurer_type))}</th>`).join('');
  const rows = ROWS.map(
    ([label, fn]) => `<tr><td class="lbl">${esc(label)}</td>${documents.map((d) => `<td>${esc(fn(d))}</td>`).join('')}</tr>`
  ).join('');

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
    * { box-sizing:border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1e293b; margin:0; padding:32px; }
    .brand { font-size:22px; font-weight:800; color:#0f172a; }
    .brand span { color:#38bdf8; }
    .title { font-size:15px; color:#475569; margin-top:2px; }
    .meta { margin:18px 0 22px; font-size:13px; color:#64748b; }
    .meta strong { color:#1e293b; }
    table { width:100%; border-collapse:collapse; font-size:12.5px; }
    th, td { border:1px solid #e2e8f0; padding:8px 10px; text-align:left; }
    thead th { background:#1e293b; color:#fff; font-weight:700; }
    thead th:first-child { background:#0f172a; }
    td.lbl { font-weight:600; color:#334155; background:#f8fafc; width:230px; }
    .foot { margin-top:24px; font-size:11px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:10px; }
  </style></head><body>
    <div class="brand">Utrata<span>Dochodu</span></div>
    <div class="title">Rekomendacja ofertowa — porównanie ofert ubezpieczenia utraty dochodu</div>
    <div class="meta">
      ${clientName ? `Przygotowana dla: <strong>${esc(clientName)}</strong><br>` : ''}
      ${offerName ? `Oferta: <strong>${esc(offerName)}</strong><br>` : ''}
      Data: <strong>${esc(today)}</strong>
    </div>
    <table>
      <thead><tr><th>Parametr</th>${cols}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">
      Dokument informacyjny. Wiążące są Ogólne Warunki Ubezpieczenia (OWU) oraz oferty ubezpieczycieli.
      Aura Expert sp. z o.o. · Panel Ofertowania UtrataDochodu.
    </div>
  </body></html>`;
}
