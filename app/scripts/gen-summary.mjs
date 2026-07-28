import { readFile, writeFile } from 'node:fs/promises';
import { parseOfferPdf } from '../src/lib/pdf/index.js';

const nf = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n) => (n == null || n === '' ? '—' : nf.format(typeof n === 'string' ? parseFloat(n) : n) + ' zł');
const yesNo = (b) => (b === true ? 'Tak' : b === false ? 'Nie' : '—');
const insurerLabel = (t) => ({ leadenhall: 'Leadenhall (Lloyd’s)', ceu: 'CEU — LOI Premium' }[t] || t);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ROWS = [
  ['Ubezpieczyciel', (d) => insurerLabel(d.insurer_type)],
  ['Numer oferty', (d) => d.offer_number || '—'],
  ['Okres ubezpieczenia', (d) => d.insurance_period || '—'],
  ['Śmierć / inwalidztwo (NW)', (d) => yesNo(d.death_covered)],
  ['Okresowa niezdolność do pracy', (d) => yesNo(d.temp_incapacity_covered)],
  ['— świadczenie miesięczne', (d) => money(d.temp_monthly_benefit)],
  ['— suma ubezpieczenia', (d) => money(d.temp_sum_insured)],
  ['— limit dzienny', (d) => money(d.temp_daily_cap)],
  ['Trwała niezdolność do pracy', (d) => yesNo(d.perm_incapacity_covered)],
  ['— suma ubezpieczenia', (d) => money(d.perm_sum_insured)],
  ['Okres odszkodowawczy', (d) => d.indemnity_period || '—'],
  ['Wyczekiwanie (wypadek)', (d) => (d.wait_accident != null ? d.wait_accident + ' dni' : '—')],
  ['Wyczekiwanie (choroba)', (d) => (d.wait_illness != null ? d.wait_illness + ' dni' : '—')],
  ['Składka roczna (łącznie)', (d) => money(d.premium_total)],
  ['Rata miesięczna', (d) => money(d.premium_monthly)]
];

function buildHtml(documents, clientName) {
  const today = new Date().toLocaleDateString('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' });
  const cols = documents.map((d) => `<th>${esc(insurerLabel(d.insurer_type))}</th>`).join('');
  const rows = ROWS.map(([l, fn]) => `<tr><td class="lbl">${esc(l)}</td>${documents.map((d) => `<td>${esc(fn(d))}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1e293b;margin:0;padding:32px}
    .brand{font-size:22px;font-weight:800;color:#0f172a}.brand span{color:#38bdf8}
    .title{font-size:15px;color:#475569;margin-top:2px}.meta{margin:18px 0 22px;font-size:13px;color:#64748b}.meta strong{color:#1e293b}
    table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left}
    thead th{background:#1e293b;color:#fff;font-weight:700}thead th:first-child{background:#0f172a}
    td.lbl{font-weight:600;color:#334155;background:#f8fafc;width:230px}
    .foot{margin-top:24px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px}
  </style></head><body>
    <div class="brand">Utrata<span>Dochodu</span></div>
    <div class="title">Rekomendacja ofertowa — porównanie ofert ubezpieczenia utraty dochodu</div>
    <div class="meta">Przygotowana dla: <strong>${esc(clientName)}</strong><br>Data: <strong>${esc(today)}</strong></div>
    <table><thead><tr><th>Parametr</th>${cols}</tr></thead><tbody>${rows}</tbody></table>
    <div class="foot">Dokument informacyjny. Wiążące są OWU oraz oferty ubezpieczycieli. Aura Expert sp. z o.o. · Panel Ofertowania UtrataDochodu.</div>
  </body></html>`;
}

const lh = await parseOfferPdf(new Uint8Array(await readFile(process.argv[2])));
const ceu = await parseOfferPdf(new Uint8Array(await readFile(process.argv[3])));
const html = buildHtml([lh.offer, ceu.offer], 'Jan Kowalski (przykład)');
await writeFile(process.argv[4], html);
console.log('HTML zapisany:', process.argv[4]);
