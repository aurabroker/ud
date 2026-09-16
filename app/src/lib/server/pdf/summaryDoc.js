/**
 * summaryDoc.js — definicja dokumentu pdfmake dla podsumowania oferty.
 * Odpowiednik summaryHtml.js, ale bez HTML i bez zewnętrznego API.
 */
import { insurerLabel } from '$lib/format.js';
import { comparisonRows } from '$lib/comparisonRows.js';
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

/** Nagłówek: logo (jeśli udało się pobrać) albo napis UtrataDochodu. */
function brandNode(logo) {
  // Tylko `fit` — podanie równocześnie height/fit potrafi popsuć skalowanie w pdfmake.
  if (logo?.kind === 'image') return { image: logo.data, fit: [170, 44], margin: [0, 0, 0, 4] };
  if (logo?.kind === 'svg') return { svg: logo.data, fit: [170, 44], margin: [0, 0, 0, 4] };
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
 * Blok „Postanowienia dodatkowe" — ręczny tekst agenta (warunki, zastrzeżenia),
 * niezależny od wiadomości dla klienta. Pusty tekst => sekcji nie ma w ogóle.
 * Wiersze zaczynające się od myślnika/kropki renderujemy jako listę punktową,
 * bo tak agenci najczęściej zapisują zastrzeżenia.
 * @param {string} [text]
 * @returns {Array<object>}
 */
export function additionalTermsContent(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const nodes = [];
  /** @type {string[]} */
  let bullets = [];
  const flush = () => {
    if (bullets.length) nodes.push({ ul: bullets, style: 'atList' });
    bullets = [];
  };
  for (const line of lines) {
    if (/^[-–—•*]\s+/.test(line)) {
      bullets.push(line.replace(/^[-–—•*]\s+/, ''));
    } else {
      flush();
      nodes.push({ text: line, style: 'atP' });
    }
  }
  flush();

  return [
    {
      table: {
        widths: ['*'],
        body: [[{ stack: [{ text: 'Postanowienia dodatkowe', style: 'atTitle' }, ...nodes] }]]
      },
      layout: 'atBox',
      margin: [0, 2, 0, 8]
    }
  ];
}

/**
 * @param {{ clientName?: string, documents: any[], employmentType?: string,
 *   offerNumber?: string, additionalTerms?: string, footerText?: string,
 *   logo?: {kind:string, data:any}|null }} p
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

  // Tabela porównania. Gdy wszystkie oferty są od tego samego ubezpieczyciela,
  // nagłówek jest jeden, wspólny dla wszystkich kolumn.
  const sameInsurer =
    documents.length > 1 && documents.every((d) => d.insurer_type === documents[0].insurer_type);
  const header = sameInsurer
    ? [
        { text: "przedstawiciel Lloyd's", style: 'cmpHeadFirst' },
        { text: insurerLabel(documents[0].insurer_type), style: 'cmpHead', colSpan: documents.length },
        ...Array.from({ length: documents.length - 1 }, () => ({}))
      ]
    : [
        { text: "przedstawiciel Lloyd's", style: 'cmpHeadFirst' },
        ...documents.map((d) => ({ text: insurerLabel(d.insurer_type), style: 'cmpHead' }))
      ];
  // Wiersze (bazowe + postanowienia dodatkowe + składki) liczy ten sam moduł,
  // z którego korzysta tabela w przeglądarce.
  const body = [header];
  for (const row of comparisonRows(documents)) {
    if (row.kind === 'section') {
      body.push([
        { text: row.label, style: 'cmpSection', colSpan: documents.length + 1 },
        ...Array.from({ length: documents.length }, () => ({}))
      ]);
      continue;
    }
    body.push([
      { text: row.label, style: 'cmpLabel' },
      ...row.cells.map((c) => ({
        text: c.text,
        style: 'cmpCell',
        ...(c.green ? { color: GREEN, bold: true } : {}),
        ...(c.bold ? { bold: true } : {}),
        ...(c.underline ? { decoration: 'underline' } : {})
      }))
    ]);
  }

  const cmpTable = {
    table: { headerRows: 1, widths: [150, ...documents.map(() => '*')], body },
    layout: 'cmpBox',
    margin: [0, 0, 0, 6]
  };

  return {
    pageSize: 'A4',
    pageMargins: [28, 28, 28, 30],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: SLATE_800, lineHeight: 1.2 },
    // W stopce trzymamy tylko krótką notę i numer strony — długi tekst prawny
    // z ustawień nie mieści się w stopce i był ucinany; jest na końcu dokumentu.
    footer: (page, total) => ({
      columns: [
        {
          text: 'Dokument informacyjny. Wiążące są OWU oraz oferty ubezpieczycieli.',
          fontSize: 6.5,
          color: '#94a3b8',
          margin: [28, 6, 0, 0]
        },
        {
          text: `${page} / ${total}`,
          fontSize: 6.5,
          color: '#94a3b8',
          alignment: 'right',
          margin: [0, 6, 28, 0]
        }
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
      ...additionalTermsContent(p.additionalTerms),
      ...conditionsContent(p.footerText)
    ],
    styles: {
      title: { fontSize: 13, bold: true, color: SLATE_900, margin: [0, 2, 0, 0] },
      recKey: { bold: true, fillColor: '#f1f5f9', color: '#334155', margin: [4, 3, 4, 3] },
      recVal: { margin: [4, 3, 4, 3] },
      clause: { fontSize: 9, margin: [6, 5, 6, 5] },
      cmpHead: { bold: true, color: '#ffffff', fillColor: SLATE_800, margin: [4, 4, 4, 4], alignment: 'center' },
      cmpHeadFirst: { bold: true, color: '#ffffff', fillColor: SLATE_900, margin: [4, 4, 4, 4] },
      cmpLabel: { bold: true, color: '#334155', fillColor: SLATE_50, margin: [4, 3, 4, 3] },
      // Nagłówek sekcji „Postanowienia dodatkowe" — wiersz na całą szerokość tabeli.
      cmpSection: { bold: true, fontSize: 8, color: '#475569', fillColor: '#f1f5f9', margin: [4, 3, 4, 3] },
      // Komórki z danymi ofert — wyśrodkowane.
      cmpCell: { margin: [4, 3, 4, 3], alignment: 'center' },
      // Ręczne postanowienia dodatkowe (pole z edycji oferty).
      atTitle: { fontSize: 9.5, bold: true, color: '#92400e', margin: [0, 0, 0, 3] },
      atP: { fontSize: 8.5, margin: [0, 0, 0, 2] },
      atList: { fontSize: 8.5, margin: [0, 0, 0, 2] },
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
  atBox: {
    hLineWidth: () => 0,
    vLineWidth: (i) => (i === 0 ? 3 : 0),
    vLineColor: () => '#f59e0b',
    fillColor: () => '#fffbeb',
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: () => 5,
    paddingBottom: () => 5
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
