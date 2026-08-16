/**
 * summaryHtml.js — brandowany HTML podsumowania oferty (→ PDFShift → PDF).
 */
import { money, yesNo, insurerLabel, insurerRow } from '$lib/format.js';
import { OFFER_CONDITIONS_HTML } from './offerConditions.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Forma zatrudnienia: kod -> etykieta (albo surowy tekst). */
function employmentLabel(code) {
  const c = String(code || '').trim();
  const map = {
    uop: 'Umowa o pracę',
    b2b: 'B2B / działalność gospodarcza',
    uz: 'Umowa zlecenie',
    uod: 'Umowa o dzieło'
  };
  return map[c.toLowerCase()] || c || '—';
}

/** Czy to umowa o pracę (uop). */
function isUop(code) {
  return /^uop$/i.test(String(code || '').trim()) || /umowa o prac/i.test(String(code || ''));
}

/** Okresowa niezdolność „z oferty": gdy pokrycie faktycznie jest — TAK na zielono zamiast „—". */
function tempIncap(d) {
  const covered = d.temp_incapacity_covered === true || d.temp_monthly_benefit != null || d.temp_sum_insured != null;
  if (covered) return { green: true, text: 'TAK' };
  return yesNo(d.temp_incapacity_covered);
}

const ROWS = [
  ['Ubezpieczyciel', () => insurerRow()],
  ['Numer oferty (ubezpieczyciel)', (d) => d.offer_number || '—'],
  ['Okres ubezpieczenia', (d) => d.insurance_period || '—'],
  // Kwota z Pozycji A (parsed_raw); gdy ryzyko nieobjęte — Tak/Nie/—
  ['Śmierć / inwalidztwo (NW)', (d) => (d.parsed_raw?.death_sum_insured != null ? money(d.parsed_raw.death_sum_insured) : yesNo(d.death_covered))],
  ['Okresowa niezdolność do pracy', (d) => tempIncap(d)],
  ['— świadczenie miesięczne', (d) => money(d.temp_monthly_benefit)],
  // Kwota z Pozycji C; gdy oferta nie obejmuje tego ryzyka — Tak/Nie/—
  ['Trwała niezdolność do pracy', (d) => (d.perm_sum_insured != null ? money(d.perm_sum_insured) : yesNo(d.perm_incapacity_covered))],
  ['Okres odszkodowawczy', (d) => d.indemnity_period || '—'],
  ['Okres wyczekiwania (wypadek)', (d) => (d.wait_accident != null ? d.wait_accident + ' dni' : '—')],
  ['Okres wyczekiwania (choroba)', (d) => (d.wait_illness != null ? d.wait_illness + ' dni' : '—')]
];

/**
 * @param {{ clientName?: string, offerName?: string, documents: any[], logoUrl?: string,
 *   footerText?: string, employmentType?: string, offerNumber?: string }} p
 * @returns {string} kompletny dokument HTML
 */
export function buildOfferSummaryHtml({
  clientName, offerName, documents = [], logoUrl = '', footerText = '', employmentType = '', offerNumber = ''
}) {
  const today = new Date().toLocaleDateString('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' });
  const brand = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="Logo" style="height:52px;width:auto;" />`
    : `<div class="brand">Utrata<span>Dochodu</span></div>`;

  const pct = isUop(employmentType) ? 65 : 80;
  const clause = `Kwota świadczenia miesięcznego nie może przekroczyć ${pct}% kwoty stanowiącej 1/12 Ubezpieczonego przychodu za okres 12 miesięcy bezpośrednio poprzedzających zawarcie Umowy ubezpieczenia.`;

  const cols = documents.map((d) => `<th>${esc(insurerLabel(d.insurer_type))}</th>`).join('');
  const cell = (v) => (v && v.green ? `<span style="color:#15803d;font-weight:700">${esc(v.text)}</span>` : esc(v));
  const rows = ROWS.map(
    ([label, fn]) => `<tr><td class="lbl">${esc(label)}</td>${documents.map((d) => `<td>${cell(fn(d))}</td>`).join('')}</tr>`
  ).join('');
  const premiumRows = `
    <tr class="premium"><td class="lbl">Składka roczna (łącznie)</td>${documents.map((d) => `<td><strong>${esc(money(d.premium_total))}</strong></td>`).join('')}</tr>
    <tr class="premium"><td class="lbl">Rata miesięczna</td>${documents
      .map((d) =>
        d.premium_monthly != null
          ? `<td><span style="text-decoration:underline;font-weight:700">${esc(money(d.premium_monthly))}</span></td>`
          : '<td>—</td>'
      )
      .join('')}</tr>`;

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
    * { box-sizing:border-box; }
    body { font-family:'Helvetica Neue', Arial, sans-serif; color:#1e293b; margin:0; padding:28px; font-size:12px; }
    .brand { font-size:22px; font-weight:800; color:#0f172a; }
    .brand span { color:#38bdf8; }
    .title { font-size:16px; font-weight:800; color:#0f172a; margin-top:4px; }
    .rec { width:100%; border-collapse:collapse; margin:14px 0 6px; font-size:12px; }
    .rec td { border:1px solid #cbd5e1; padding:6px 10px; }
    .rec td.k { background:#f1f5f9; font-weight:700; width:210px; color:#334155; }
    .clause { margin:8px 0 16px; padding:9px 12px; background:#eff6ff; border-left:4px solid #2563eb; font-size:12px; }
    table.cmp { width:100%; border-collapse:collapse; font-size:11.5px; margin-bottom:6px; }
    table.cmp th, table.cmp td { border:1px solid #cbd5e1; padding:6px 9px; text-align:left; }
    table.cmp thead th { background:#1e293b; color:#fff; font-weight:700; }
    table.cmp thead th:first-child { background:#0f172a; }
    table.cmp td.lbl { background:#f8fafc; font-weight:600; color:#334155; width:230px; }
    table.cmp tr.premium td { border-top:2px solid #94a3b8; }
    .oc { margin-top:18px; font-size:10.5px; line-height:1.45; }
    .oc h2 { font-size:14px; color:#0f172a; border-bottom:2px solid #1e293b; padding-bottom:3px; margin:14px 0 8px; }
    .oc h3 { font-size:12px; color:#0f172a; margin:12px 0 5px; }
    .oc ul { margin:4px 0 8px; padding-left:16px; }
    .oc li { margin-bottom:3px; }
    .oc-2col { width:100%; border-collapse:collapse; }
    .oc-2col td { vertical-align:top; width:50%; border:1px solid #e2e8f0; padding:8px 10px; }
    .oc-company { margin-top:14px; font-size:9px; color:#64748b; border-top:1px solid #e2e8f0; padding-top:8px; }
    .foot { margin-top:16px; font-size:10px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:8px; }
  </style></head><body>
    ${brand}
    <div class="title">Rekomendacja ofertowa — porównanie ofert ubezpieczenia utraty dochodu</div>

    <table class="rec">
      <tr><td class="k">Oferta przygotowana dla</td><td>${esc(clientName) || '—'}</td></tr>
      <tr><td class="k">Forma zatrudnienia</td><td>${esc(employmentLabel(employmentType))}</td></tr>
      <tr><td class="k">Oferta nr</td><td>${esc(offerNumber) || '—'}</td></tr>
      <tr><td class="k">Data</td><td>${esc(today)}</td></tr>
    </table>

    <div class="clause">${esc(clause)}</div>

    <table class="cmp">
      <thead><tr><th>przedstawiciel Lloyd's</th>${cols}</tr></thead>
      <tbody>${rows}${premiumRows}</tbody>
    </table>

    ${OFFER_CONDITIONS_HTML}

    <div class="foot">${esc(footerText || 'Dokument informacyjny. Wiążące są Ogólne Warunki Ubezpieczenia (OWU) oraz oferty ubezpieczycieli.')}</div>
  </body></html>`;
}
