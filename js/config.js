/**
 * config.js — Supabase config & globals — v2.0
 */

const CONFIG = {
  SUPABASE_URL: 'https://kukvgsjrmrqtzhkszzum.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a3Znc2pybXJxdHpoa3N6enVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTI0NzYsImV4cCI6MjA4ODQ4ODQ3Nn0.wOB-4CJTcRksSUY7WD7CXEccTKNxPIVF8AT8hczS5zY',
  APP_VERSION: 'v2.0',
  COMPANY_NAME: 'Aura Expert sp. z o.o.',
  COMPANY_FULL: 'Aura Expert spółka z ograniczoną odpowiedzialnością z siedzibą w Warszawie przy ul. Bolkowskiej 2A lokal 28',
};

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const currencyFmt = new Intl.NumberFormat('pl-PL', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 });

function parseNum(val) {
  if (!val) return 0;
  return parseFloat(val.toString().replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
}
function formatCurrency(num) { return (!num || num === 0) ? '' : currencyFmt.format(num); }
function generateShareToken() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let t = ''; for (let i = 0; i < 24; i++) t += c.charAt(Math.floor(Math.random() * c.length)); return t;
}
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Waiting period options
const WAIT_ACCIDENT = [14, 21, 30, 45, 60, 180];
const WAIT_ILLNESS = [21, 30, 45, 60, 180];
// Indemnity period by insurer
const INDEMNITY_LEADENHALL = [24];
const INDEMNITY_CEU = [24, 36, 48, 60];

// Exclusions text
const EXCLUSIONS_TEXT = `<h3 style="font-size:1rem; font-weight:700; color:var(--red-700); margin-bottom:0.75rem;">⚠️ Ważne Wyłączenia Odpowiedzialności (CEU / Leadenhall)</h3>
<p style="margin-bottom:0.75rem;">Zgodnie z ogólnymi warunkami ubezpieczenia, ubezpieczyciel <strong>nie ponosi odpowiedzialności</strong> za roszczenia związane z:</p>
<ul style="list-style:disc; padding-left:1.5rem; display:flex; flex-direction:column; gap:0.5rem;">
  <li><strong>Chorobami sprzed polisy:</strong> wynikającymi z chorób leczonych lub konsultowanych w okresie 24 miesięcy przed zawarciem polisy.</li>
  <li><strong>Problemami z kręgosłupem i stawami:</strong> zwyrodnienia kręgosłupa i stawów leczone w ostatnich 24 miesiącach.</li>
  <li>Celowym samookaleczeniem lub usiłowaniem samobójstwa.</li>
  <li>Wypadkami pod wpływem alkoholu, narkotyków lub leków.</li>
  <li>Zawodowym uprawianiem sportu.</li>
  <li>Zdarzeniami w strefach objętych wojną lub sankcjami.</li>
</ul>
<p style="margin-top:1rem; font-size:0.8rem; color:var(--slate-500);">Pełna lista wyłączeń znajduje się w Ogólnych Warunkach Ubezpieczenia (OWU) oraz Karcie Produktu.</p>`;
