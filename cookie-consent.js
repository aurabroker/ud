/* UtrataDochodu — cookie-consent.js
   GDPR-compliant: GA4 loads only after explicit user consent.
   Medical-data site — consent is required before any analytics tracking.
*/

const GA4_ID      = 'G-D9XHPWP5DE';
const CONSENT_KEY = 'ud_cookie_consent';

function loadGA4() {
  if (document.querySelector('script[src*="googletagmanager"]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.src   = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA4_ID, { anonymize_ip: true });
}

function getConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

function setConsent(val) {
  try { localStorage.setItem(CONSENT_KEY, val); } catch { /* private mode */ }
}

function removeBanner() {
  document.getElementById('cookie-banner')?.remove();
}

function acceptCookies() {
  setConsent('accepted');
  removeBanner();
  loadGA4();
}

function declineCookies() {
  setConsent('declined');
  removeBanner();
}

function buildBanner() {
  const div = document.createElement('div');
  div.id        = 'cookie-banner';
  div.setAttribute('role', 'dialog');
  div.setAttribute('aria-label', 'Zgoda na pliki cookies');
  div.innerHTML = `
    <div style="
      position:fixed;bottom:0;left:0;right:0;z-index:9999;
      background:#1e293b;color:#f1f5f9;
      padding:1rem 1.25rem;
      display:flex;flex-wrap:wrap;align-items:center;gap:.75rem 1.25rem;
      font-family:Inter,system-ui,sans-serif;font-size:.875rem;line-height:1.5;
      box-shadow:0 -4px 20px rgba(0,0,0,.35);
    ">
      <p style="margin:0;flex:1;min-width:220px">
        Ta strona przetwarza dane wrażliwe (medyczne). Analityka Google Analytics
        jest uruchamiana <strong>wyłącznie po Twojej zgodzie</strong> zgodnie z RODO.
        <a href="polityka-cookies.html" style="color:#93c5fd;text-decoration:underline;white-space:nowrap">
          Polityka cookies
        </a>
      </p>
      <div style="display:flex;gap:.625rem;flex-shrink:0">
        <button id="cookie-decline-btn"
          style="background:transparent;border:1px solid #475569;color:#cbd5e1;
                 padding:.4375rem .875rem;border-radius:.375rem;cursor:pointer;
                 font-size:.875rem;font-weight:600;white-space:nowrap">
          Odrzuć
        </button>
        <button id="cookie-accept-btn"
          style="background:#2563eb;border:none;color:#fff;
                 padding:.4375rem 1.125rem;border-radius:.375rem;cursor:pointer;
                 font-size:.875rem;font-weight:700;white-space:nowrap">
          Akceptuję
        </button>
      </div>
    </div>`;
  document.body.appendChild(div);
  document.getElementById('cookie-accept-btn').addEventListener('click', acceptCookies);
  document.getElementById('cookie-decline-btn').addEventListener('click', declineCookies);
}

/* Allow polityka-cookies.html to show a "Zmień zgodę" button */
window.resetCookieConsent = function () {
  try { localStorage.removeItem(CONSENT_KEY); } catch { /* */ }
  if (!document.getElementById('cookie-banner')) buildBanner();
};

/* Wire up "Zmień zgodę" button on the cookie policy page */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('manage-consent-btn')
    ?.addEventListener('click', () => window.resetCookieConsent());
});

/* Boot */
(function init() {
  const consent = getConsent();
  if (consent === 'accepted') {
    loadGA4();
  } else if (consent !== 'declined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildBanner);
    } else {
      buildBanner();
    }
  }
})();
