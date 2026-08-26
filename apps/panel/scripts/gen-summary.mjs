import { readFile, writeFile } from 'node:fs/promises';
import { parseOfferPdf } from '../src/lib/pdf/index.js';
import { OFFER_CONDITIONS_HTML } from '../src/lib/server/offerConditions.js';

const nf = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n) => (n == null || n === '' ? '—' : nf.format(typeof n === 'string' ? parseFloat(n) : n) + ' zł');
const yesNo = (b) => (b === true ? 'Tak' : b === false ? 'Nie' : '—');
const insurerLabel = (t) => ({ leadenhall: 'Leadenhall Insurance SA', ceu: 'CEU — LOI Premium' }[t] || t);
const insurerRow = () => 'Lloyd’s';
const tempIncap = (d) => {
  const covered = d.temp_incapacity_covered === true || d.temp_monthly_benefit != null || d.temp_sum_insured != null;
  return covered ? { green: true, text: 'TAK' } : yesNo(d.temp_incapacity_covered);
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emplLabel = (c) => ({ uop: 'Umowa o pracę', b2b: 'B2B / działalność gospodarcza' }[String(c||'').toLowerCase()] || c || '—');
const isUop = (c) => /^uop$/i.test(String(c||'').trim()) || /umowa o prac/i.test(String(c||''));

const ROWS = [
  ['Ubezpieczyciel', () => insurerRow()],
  ['Numer oferty (ubezpieczyciel)', (d) => d.offer_number || '—'],
  ['Okres ubezpieczenia', (d) => d.insurance_period || '—'],
  // Kwota z Pozycji A (parsed_raw); gdy ryzyko nieobjęte — Tak/Nie/—
  ['Śmierć / inwalidztwo (NW)', (d) => (d.parsed_raw?.death_sum_insured != null ? money(d.parsed_raw.death_sum_insured) : yesNo(d.death_covered))],
  ['Okresowa niezdolność do pracy', (d) => tempIncap(d)],
  ['— świadczenie miesięczne', (d) => money(d.temp_monthly_benefit)],
  ['Trwała niezdolność do pracy', (d) => (d.perm_sum_insured != null ? money(d.perm_sum_insured) : yesNo(d.perm_incapacity_covered))],
  ['Okres odszkodowawczy', (d) => d.indemnity_period || '—'],
  ['Okres wyczekiwania (wypadek)', (d) => (d.wait_accident != null ? d.wait_accident + ' dni' : '—')],
  ['Okres wyczekiwania (choroba)', (d) => (d.wait_illness != null ? d.wait_illness + ' dni' : '—')]
];

function buildHtml(documents, clientName, employmentType, offerNumber) {
  const today = new Date().toLocaleDateString('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' });
  const pct = isUop(employmentType) ? 65 : 80;
  const clause = `Kwota świadczenia miesięcznego nie może przekroczyć ${pct}% kwoty stanowiącej 1/12 Ubezpieczonego przychodu za okres 12 miesięcy bezpośrednio poprzedzających zawarcie Umowy ubezpieczenia.`;
  const cols = documents.map((d) => `<th>${esc(insurerLabel(d.insurer_type))}</th>`).join('');
  const cell = (v) => (v && v.green ? `<span style="color:#15803d;font-weight:700">${esc(v.text)}</span>` : esc(v));
  const rows = ROWS.map(([l, fn]) => `<tr><td class="lbl">${esc(l)}</td>${documents.map((d) => `<td>${cell(fn(d))}</td>`).join('')}</tr>`).join('');
  const premium = `<tr class="premium"><td class="lbl">Składka roczna (łącznie)</td>${documents.map((d)=>`<td><strong>${esc(money(d.premium_total))}</strong></td>`).join('')}</tr><tr class="premium"><td class="lbl">Rata miesięczna</td>${documents.map((d)=> d.premium_monthly != null ? `<td><span style="text-decoration:underline;font-weight:700">${esc(money(d.premium_monthly))}</span></td>` : '<td>—</td>').join('')}</tr>`;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#1e293b;margin:0;padding:28px;font-size:12px}
    .brand{font-size:22px;font-weight:800}.brand span{color:#38bdf8}.title{font-size:16px;font-weight:800;margin-top:4px}
    .rec{width:100%;border-collapse:collapse;margin:14px 0 6px}.rec td{border:1px solid #cbd5e1;padding:6px 10px}.rec td.k{background:#f1f5f9;font-weight:700;width:210px}
    .clause{margin:8px 0 16px;padding:9px 12px;background:#eff6ff;border-left:4px solid #2563eb}
    table.cmp{width:100%;border-collapse:collapse;font-size:11.5px}table.cmp th,table.cmp td{border:1px solid #cbd5e1;padding:6px 9px;text-align:left}
    table.cmp thead th{background:#1e293b;color:#fff}table.cmp thead th:first-child{background:#0f172a}table.cmp td.lbl{background:#f8fafc;font-weight:600;width:230px}
    .oc{margin-top:18px;font-size:10.5px;line-height:1.45}.oc h2{font-size:14px;border-bottom:2px solid #1e293b;padding-bottom:3px;margin:14px 0 8px}.oc h3{font-size:12px;margin:12px 0 5px}
    .oc ul{margin:4px 0 8px;padding-left:16px}.oc-2col{width:100%;border-collapse:collapse}.oc-2col td{vertical-align:top;width:50%;border:1px solid #e2e8f0;padding:8px 10px}.oc-company{margin-top:14px;font-size:9px;color:#64748b}
  </style></head><body>
    <div class="brand">Utrata<span>Dochodu</span></div>
    <div class="title">Rekomendacja ofertowa — porównanie ofert ubezpieczenia utraty dochodu</div>
    <table class="rec">
      <tr><td class="k">Oferta przygotowana dla</td><td>${esc(clientName)}</td></tr>
      <tr><td class="k">Forma zatrudnienia</td><td>${esc(emplLabel(employmentType))}</td></tr>
      <tr><td class="k">Oferta nr</td><td>${esc(offerNumber)}</td></tr>
      <tr><td class="k">Data</td><td>${esc(today)}</td></tr>
    </table>
    <div class="clause">${esc(clause)}</div>
    <table class="cmp"><thead><tr><th>przedstawiciel Lloyd's</th>${cols}</tr></thead><tbody>${rows}${premium}</tbody></table>
    ${OFFER_CONDITIONS_HTML}
  </body></html>`;
}

const lh = await parseOfferPdf(new Uint8Array(await readFile(process.argv[2])));
const ceu = await parseOfferPdf(new Uint8Array(await readFile(process.argv[3])));
const empl = process.argv[5] || 'uop';
const html = buildHtml([lh.offer, ceu.offer], 'Jan Kowalski', empl, 'UD/2026/AD/00042/Kowalski');
await writeFile(process.argv[4], html);
console.log('HTML zapisany:', process.argv[4], '| forma:', empl);
