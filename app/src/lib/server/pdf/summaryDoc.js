/**
 * summaryDoc.js — definicja dokumentu pdfmake dla podsumowania oferty.
 * Odpowiednik summaryHtml.js, ale bez HTML i bez zewnętrznego API.
 */
import { money, yesNo, insurerLabel, insurerRow } from '$lib/format.js';
import { conditionsContent } from './conditionsDoc.js';

const SLATE_900 = '#0f172a';
const SLATE_800 = '#1e293b';
const SLATE_300 = '#cbd5e1';
const SLATE_200 = '#e2e8f0';
const SLATE_50 = '#f8fafc';
const GREEN = '#15803d';

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

function isUop(code) {
  return /^uop$/i.test(String(code || '').trim()) || /umowa o prac/i.test(String(code || ''));
}

/** Okresowa niezdolność: gdy pokrycie faktycznie jest — TAK na zielono. */
function tempIncap(d) {
  const covered = d.temp_incapacity_covered === true || d.temp_monthly_benefit != null || d.temp_sum_insured != null;
  return covered ? { text: 'TAK', color: GREEN, bold: true } : { text: yesNo(d.temp_incapacity_covered) };
}

const ROWS = [
  ['Ubezpieczyciel', () => ({ text: insurerRow() })],
  ['Numer oferty (ubezpieczyciel)', (d) => ({ text: d.offer_number || '—' })],
  ['Okres ubezpieczenia', (d) => ({ text: d.insurance_period || '—' })],
  ['Śmierć / inwalidztwo (NW)', (d) => ({
    text: d.parsed_raw?.death_sum_insured != null ? money(d.parsed_raw.death_sum_insured) : yesNo(d.death_covered)
  })],
  ['Okresowa niezdolność do pracy', (d) => tempIncap(d)],
  ['— świadczenie miesięczne', (d) => ({ text: money(d.temp_monthly_benefit) })],
  ['Trwała niezdolność do pracy', (d) => ({
    text: d.perm_sum_insured != null ? money(d.perm_sum_insured) : yesNo(d.perm_incapacity_covered)
  })],
  ['Okres odszkodowawczy', (d) => ({ text: d.indemnity_period || '—' })],
  ['Okres wyczekiwania (wypadek)', (d) => ({ text: d.wait_accident != null ? d.wait_accident + ' dni' : '—' })],
  ['Okres wyczekiwania (choroba)', (d) => ({ text: d.wait_illness != null ? d.wait_illness + ' dni' : '—' })]
];

/** Nagłówek: logo (jeśli udało się pobrać) albo napis UtrataDochodu. */
function brandNode(logo) {
  if (logo?.kind === 'image') return { image: logo.data, height: 42, fit: [180, 42], margin: [0, 0, 0, 2] };
  if (logo?.kind === 'svg') return { svg: logo.data, height: 42, margin: [0, 0, 0, 2] };
  return {
    text: [
      { text: 'Utrata', color: SLATE_900 },
      { text: 'Dochodu', color: '#38bdf8' }
    ],
    fontSize: 20,
    bold: true,
    margin: [0, 0, 0, 2]
  };
}

/**
 * @param {{ clientName?: string, documents: any[], employmentType?: string,
 *   offerNumber?: string, footerText?: string, logo?: {kind:string, data:any}|null }} p
 * @returns {object} docDefinition dla pdfmake
 */
export function buildSummaryDocDefinition(p) {
  const documents = p.documents || [];
  const today = new Date().toLocaleDateString('pl-PL', { day: '2-digit', month: 'long', year: 'numeric' });
  const pct = isUop(p.employmentType) ? 65 : 80;
  const clause =
    `Kwota świadczenia miesięcznego nie może przekroczyć ${pct}% kwoty stanowiącej 1/12 Ubezpieczonego ` +
    'przychodu za okres 12 miesięcy bezpośrednio poprzedzających zawarcie Umowy ubezpieczenia.';

  // Tabela rekomendacji
  const recRow = (k, v) => [
    { text: k, style: 'recKey' },
    { text: v || '—', style: 'recVal' }
  ];
  const recTable = {
    table: {
      widths: [150, '*'],
      body: [
        recRow('Oferta przygotowana dla', p.clientName),
        recRow('Forma zatrudnienia', employmentLabel(p.employmentType)),
        recRow('Oferta nr', p.offerNumber),
        recRow('Data', today)
      ]
    },
    layout: 'recBox',
    margin: [0, 10, 0, 6]
  };

  // Tabela porównania
  const header = [
    { text: "przedstawiciel Lloyd's", style: 'cmpHeadFirst' },
    ...documents.map((d) => ({ text: insurerLabel(d.insurer_type), style: 'cmpHead' }))
  ];
  const body = [header];
  for (const [label, fn] of ROWS) {
    body.push([{ text: label, style: 'cmpLabel' }, ...documents.map((d) => ({ ...fn(d), style: 'cmpCell' }))]);
  }
  body.push([
    { text: 'Składka roczna (łącznie)', style: 'cmpLabel' },
    ...documents.map((d) => ({ text: money(d.premium_total), bold: true, style: 'cmpCell' }))
  ]);
  body.push([
    { text: 'Rata miesięczna', style: 'cmpLabel' },
    ...documents.map((d) =>
      d.premium_monthly != null
        ? { text: money(d.premium_monthly), bold: true, decoration: 'underline', style: 'cmpCell' }
        : { text: '—', style: 'cmpCell' }
    )
  ]);

  const cmpTable = {
    table: { headerRows: 1, widths: [150, ...documents.map(() => '*')], body },
    layout: 'cmpBox',
    margin: [0, 0, 0, 6]
  };

  return {
    pageSize: 'A4',
    pageMargins: [28, 28, 28, 34],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: SLATE_800, lineHeight: 1.2 },
    footer: (page, total) => ({
      columns: [
        {
          text: p.footerText || 'Dokument informacyjny. Wiążące są Ogólne Warunki Ubezpieczenia (OWU) oraz oferty ubezpieczycieli.',
          fontSize: 7,
          color: '#94a3b8',
          margin: [28, 0, 0, 0]
        },
        { text: `${page}/${total}`, fontSize: 7, color: '#94a3b8', alignment: 'right', margin: [0, 0, 28, 0] }
      ]
    }),
    content: [
      brandNode(p.logo),
      { text: 'Rekomendacja ofertowa — porównanie ofert ubezpieczenia utraty dochodu', style: 'title' },
      recTable,
      {
        table: { widths: ['*'], body: [[{ text: clause, style: 'clause' }]] },
        layout: 'clauseBox',
        margin: [0, 2, 0, 12]
      },
      cmpTable,
      ...conditionsContent()
    ],
    styles: {
      title: { fontSize: 13, bold: true, color: SLATE_900, margin: [0, 2, 0, 0] },
      recKey: { bold: true, fillColor: '#f1f5f9', color: '#334155', margin: [4, 3, 4, 3] },
      recVal: { margin: [4, 3, 4, 3] },
      clause: { fontSize: 9, margin: [6, 5, 6, 5] },
      cmpHead: { bold: true, color: '#ffffff', fillColor: SLATE_800, margin: [4, 4, 4, 4] },
      cmpHeadFirst: { bold: true, color: '#ffffff', fillColor: SLATE_900, margin: [4, 4, 4, 4] },
      cmpLabel: { bold: true, color: '#334155', fillColor: SLATE_50, margin: [4, 3, 4, 3] },
      cmpCell: { margin: [4, 3, 4, 3] },
      ocH2: { fontSize: 11.5, bold: true, color: SLATE_900 },
      ocH3: { fontSize: 9.5, bold: true, color: SLATE_900, margin: [0, 10, 0, 4] },
      ocSub: { fontSize: 8.5, bold: true, margin: [0, 4, 0, 2] },
      ocP: { fontSize: 8, margin: [0, 0, 0, 3] },
      ocList: { fontSize: 8, margin: [0, 0, 0, 5] },
      ocCompany: { fontSize: 6.5, color: '#64748b' }
    },
    // Ramki tabel — odpowiedniki obramowań z wersji HTML.
    __layouts: true
  };
}

/** Layouty tabel (przekazywane do pdfmake osobno). */
export const TABLE_LAYOUTS = {
  recBox: {
    hLineWidth: () => 0.6,
    vLineWidth: () => 0.6,
    hLineColor: () => SLATE_300,
    vLineColor: () => SLATE_300,
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 2,
    paddingBottom: () => 2
  },
  cmpBox: {
    hLineWidth: () => 0.6,
    vLineWidth: () => 0.6,
    hLineColor: () => SLATE_300,
    vLineColor: () => SLATE_300,
    paddingLeft: () => 5,
    paddingRight: () => 5,
    paddingTop: () => 2,
    paddingBottom: () => 2
  },
  clauseBox: {
    hLineWidth: () => 0,
    vLineWidth: (i) => (i === 0 ? 3 : 0),
    vLineColor: () => '#2563eb',
    fillColor: () => '#eff6ff',
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: () => 2,
    paddingBottom: () => 2
  },
  ocBox: {
    hLineWidth: () => 0.6,
    vLineWidth: () => 0.6,
    hLineColor: () => SLATE_200,
    vLineColor: () => SLATE_200,
    paddingLeft: () => 7,
    paddingRight: () => 7,
    paddingTop: () => 6,
    paddingBottom: () => 6
  }
};
