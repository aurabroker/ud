/**
 * app.js — Main controller — v2.0
 */

const App = {
  currentView: 'dashboard',
  isClientView: false,

  async init() {
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');
    if (shareToken) { await App.initClientView(shareToken); return; }

    try {
      const loggedIn = await Auth.init();
      if (loggedIn) {
        if (Auth.userProfile?.active === false) { App.showLoginError('Konto zablokowane.'); await Auth.logout(); return; }
        App.showApp();
      }
    } catch (err) { console.error('Init:', err); }

    document.getElementById('loginForm').addEventListener('submit', App.handleLogin);
    document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => App.navigateTo(btn.dataset.view)));
  },

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const pw = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');
    App.hideLoginError(); btn.disabled = true; btn.textContent = 'Logowanie...';
    try {
      await Auth.login(email, pw);
      if (Auth.userProfile?.active === false) { App.showLoginError('Konto zablokowane.'); await Auth.logout(); return; }
      App.showApp();
    } catch (err) {
      App.showLoginError(err.message?.includes('Invalid') ? 'Nieprawidłowy email lub hasło.' : (err.message || 'Błąd logowania.'));
    } finally { btn.disabled = false; btn.textContent = 'Zaloguj się'; }
  },

  showLoginError(msg) { const el = document.getElementById('loginError'); el.textContent = msg; el.classList.remove('hidden'); },
  hideLoginError() { document.getElementById('loginError').classList.add('hidden'); },

  async showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('userName').textContent = Auth.getDisplayName();
    document.getElementById('userAvatar').textContent = Auth.getInitials();
    document.getElementById('userRole').textContent = Auth.isAdmin() ? 'Admin' : 'User';

    const isAdmin = Auth.isAdmin();
    document.getElementById('navAdminBtn').classList.toggle('hidden', !isAdmin);
    const mob = document.getElementById('mobileAdminBtn');
    if (mob) mob.classList.toggle('hidden', !isAdmin);

    try { await Store.loadReferenceData(); } catch (err) { App.toast('Błąd ładowania bazy', 'error'); }
    App.navigateTo('dashboard');
  },

  navigateTo(view) {
    App.currentView = view;
    ['viewDashboard', 'viewEditor', 'viewAdmin'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.querySelectorAll('[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));

    switch (view) {
      case 'dashboard':
        document.getElementById('viewDashboard').classList.remove('hidden');
        App.loadDashboard();
        break;
      case 'editor':
        document.getElementById('viewEditor').classList.remove('hidden');
        break;
      case 'admin':
        if (!Auth.isAdmin()) { App.toast('Brak uprawnień', 'error'); App.navigateTo('dashboard'); return; }
        document.getElementById('viewAdmin').classList.remove('hidden');
        Admin.loadUsers();
        break;
    }
  },

  async loadDashboard() {
    const c = document.getElementById('offersListContainer');
    c.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><p style="margin-top:1rem;font-size:0.8rem;">Ładowanie...</p></div>`;
    try {
      const offers = await Store.loadOffers();
      if (offers.length === 0) {
        c.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">Brak ofert</div><div class="empty-state-text">Utwórz pierwszą ofertę porównawczą.</div><button class="btn btn-primary" onclick="App.createNewOffer()">+ Nowa Oferta</button></div>`;
        return;
      }
      let html = '<div class="offers-grid">';
      offers.forEach(o => {
        const date = new Date(o.updated_at || o.created_at).toLocaleString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
        const hasChoice = !!o.client_choice;
        html += `<div class="offer-card" onclick="App.openOffer('${o.id}')">
          <div class="offer-card-name">${escHtml(o.name || 'Bez nazwy')}</div>
          <div class="offer-card-client">${escHtml(o.client_name || 'Brak klienta')}</div>
          <div class="offer-card-meta">
            <span>${date}</span>
            ${o.share_token ? '<span style="color:var(--green-600);">🔗</span>' : ''}
            ${hasChoice ? '<span style="color:var(--blue-600);font-weight:700;">✓ Klient wybrał</span>' : ''}
          </div>
          <div class="offer-card-actions">
            <button class="btn btn-ghost btn-icon" onclick="event.stopPropagation();App.duplicateOffer('${o.id}')" title="Duplikuj">📋</button>
            <button class="btn btn-ghost btn-icon" onclick="event.stopPropagation();App.confirmDelete('${o.id}','${escHtml(o.name||'')}')" title="Usuń" style="color:var(--red-500);">🗑</button>
          </div>
        </div>`;
      });
      c.innerHTML = html + '</div>';
    } catch (err) { c.innerHTML = `<div class="empty-state" style="color:var(--red-500);"><p>${err.message}</p></div>`; }
  },

  createNewOffer() {
    Store.resetState();
    App.syncEditorUI();
    App.navigateTo('editor');
    Matrix.render();
  },

  async openOffer(id) {
    try { const o = await Store.loadOffer(id); Store.hydrateState(o); App.syncEditorUI(); App.navigateTo('editor'); Matrix.render(); }
    catch (err) { App.toast('Błąd: ' + err.message, 'error'); }
  },

  async duplicateOffer(id) {
    try {
      const o = await Store.loadOffer(id); Store.hydrateState(o);
      Store.state.offerId = null; Store.state.offerName += ' (kopia)'; Store.state.clientChoice = null;
      App.syncEditorUI(); App.navigateTo('editor'); Matrix.render();
      App.toast('Zduplikowano. Zapisz aby zachować.', 'info');
    } catch (err) { App.toast(err.message, 'error'); }
  },

  confirmDelete(id, name) {
    document.getElementById('confirmTitle').textContent = 'Usuń ofertę';
    document.getElementById('confirmMessage').textContent = `Usunąć "${name}"?`;
    const btn = document.getElementById('confirmActionBtn');
    btn.textContent = 'Usuń'; btn.onclick = async () => {
      try { await Store.deleteOffer(id); App.closeModal('confirmModal'); App.toast('Usunięto', 'success'); App.loadDashboard(); }
      catch (e) { App.toast(e.message, 'error'); }
    };
    document.getElementById('confirmModal').classList.remove('hidden');
  },

  async saveOffer(generateLink) {
    const s = Store.state;
    if (s.insurers.length === 0 || s.risks.length === 0) { App.toast('Dodaj ryzyka i ubezpieczycieli', 'error'); return; }
    s.offerName = document.getElementById('editorOfferName').value.trim();
    s.clientName = document.getElementById('editorClientName').value.trim();
    s.brokerMessage = document.getElementById('brokerMessage').value;

    const btn = generateLink ? document.getElementById('btnClientLink') : document.getElementById('btnSaveOffer');
    const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner spinner-sm"></span>'; btn.disabled = true;
    try {
      const result = await Store.saveOffer(generateLink);
      if (generateLink) {
        const link = `${window.location.origin}${window.location.pathname}?share=${result.share_token}`;
        try { await navigator.clipboard.writeText(link); App.toast('Link skopiowany', 'success'); } catch { prompt('Link:', link); }
      } else { App.toast('Zapisano', 'success'); }
      document.getElementById('editorOfferName').value = s.offerName;
    } catch (err) { App.toast('Błąd: ' + err.message, 'error'); }
    finally { btn.innerHTML = orig; btn.disabled = false; }
  },

  async sendOfferByEmail() {
    const s = Store.state;
    if (!s.offerId) {
        App.toast('Najpierw zapisz ofertę', 'error');
        return;
    }
 
    // Otwórz modal z inputem email
    const modal = document.getElementById('sendEmailModal');
    const emailInput = document.getElementById('sendEmailInput');
    
    // Prefill emailem klienta jeśli znany
    if (s.clientId) {
        const client = Store.dbClients.find(c => c.id === s.clientId);
        if (client?.email) emailInput.value = client.email;
    }
    
    modal.classList.remove('hidden');
},
 
async sendOfferByEmailConfirm() {
    const s = Store.state;
    const email = document.getElementById('sendEmailInput').value.trim();
    if (!email || !email.includes('@')) {
        App.toast('Podaj prawidłowy adres email', 'error');
        return;
    }
 
    const btn = document.getElementById('sendEmailBtn');
    btn.disabled = true;
    btn.textContent = 'Wysyłanie...';
 
    try {
        // Najpierw wygeneruj link jeśli nie istnieje
        let shareToken = null;
        if (!s.shareToken) {
            const result = await Store.saveOffer(true); // generateLink = true
            shareToken = result.share_token;
        }
 
        const link = `${window.location.origin}${window.location.pathname}?share=${shareToken || s.shareToken}`;
 
        // Wywołaj Edge Function
        const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/send-offer-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
                to_email: email,
                offer_id: s.offerId,
                offer_name: s.offerName || 'Oferta ubezpieczenia',
                client_name: s.clientName || '',
                broker_name: Auth.getDisplayName(),
                offer_link: link,
            })
        });
 
        const data = await res.json();
        if (res.ok) {
            App.closeModal('sendEmailModal');
            App.toast(`Email wysłany na ${email}`, 'success');
        } else {
            throw new Error(data.error || 'Błąd wysyłki');
        }
    } catch (err) {
        App.toast('Błąd: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Wyślij';
    }
},
  
  syncEditorUI() {
    document.getElementById('editorOfferName').value = Store.state.offerName;
    document.getElementById('editorClientName').value = Store.state.clientName;
    document.getElementById('brokerMessage').value = Store.state.brokerMessage;
  },

  exportPDF() {
    const s = Store.state;
    if (s.insurers.length === 0 || s.risks.length === 0) { App.toast('Pusta oferta', 'error'); return; }
    document.querySelectorAll('input,select,textarea').forEach(el => { if (el.type !== 'submit') el.setAttribute('value', el.value); });
    document.body.classList.add('pdf-mode');
    const btn = document.getElementById('btnExportPdf'); const orig = btn.innerHTML; btn.innerHTML = '⏳'; btn.disabled = true;
    html2pdf().set({
      margin: 0.3, filename: `UD_${s.offerName || 'Oferta'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0, windowWidth: document.getElementById('exportContent').scrollWidth + 100 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
    }).from(document.getElementById('exportContent')).save().then(() => { btn.innerHTML = orig; btn.disabled = false; document.body.classList.remove('pdf-mode'); });
  },

  openRiskPicker() { Matrix.renderRiskPicker(); document.getElementById('riskPickerModal').classList.remove('hidden'); },
  openInsurerPicker() { Matrix.renderInsurerPicker(); document.getElementById('insurerPickerModal').classList.remove('hidden'); },
  closeModal(id) { document.getElementById(id).classList.add('hidden'); },

  openAddUserModal() { document.getElementById('addUserForm').reset(); document.getElementById('addUserModal').classList.remove('hidden'); },
  async addUser(e) {
    e.preventDefault();
    const btn = document.getElementById('addUserBtn'); btn.disabled = true; btn.textContent = 'Tworzenie...';
    try {
      await Auth.adminCreateUser(
        document.getElementById('newUserEmail').value.trim(),
        document.getElementById('newUserPassword').value,
        document.getElementById('newUserName').value.trim(),
        document.getElementById('newUserRole').value
      );
      App.toast('Użytkownik utworzony', 'success'); App.closeModal('addUserModal'); Admin.loadUsers();
    } catch (err) { App.toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Utwórz konto'; }
  },

  async logout() { await Auth.logout(); document.getElementById('appScreen').classList.add('hidden'); document.getElementById('loginScreen').classList.remove('hidden'); },

  // ---- CLIENT VIEW ----
  async initClientView(token) {
    App.isClientView = true; Matrix.isClientView = true;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('clientHeader').classList.remove('hidden');
    document.querySelectorAll('.no-client').forEach(el => el.classList.add('hidden'));
    document.getElementById('viewDashboard').classList.add('hidden');
    document.getElementById('viewEditor').classList.remove('hidden');

    try {
      await Store.loadReferenceData();
      const offer = await Store.loadOfferByToken(token);
      if (!offer) { document.getElementById('scoringResults').innerHTML = `<p style="color:var(--red-500);font-weight:700;padding:2rem;text-align:center;">Oferta nie istnieje lub link wygasł.</p>`; return; }
      Store.hydrateState(offer);
      document.getElementById('clientHeaderTitle').textContent = `Rekomendacja: ${Store.state.offerName || 'Porównanie'}`;

      // Greeting
      ClientView.renderGreeting();

      // Broker message
      if (Store.state.brokerMessage) {
        document.getElementById('clientMessageSection').classList.remove('hidden');
        document.getElementById('clientMessageDisplay').textContent = Store.state.brokerMessage;
      }

      Matrix.render();
      ClientView.renderExclusions();
    } catch (err) {
      document.getElementById('scoringResults').innerHTML = `<p style="color:var(--red-500);padding:2rem;text-align:center;">${err.message}</p>`;
    }
  },

  toast(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div'); t.className = `toast ${type}`;
    const ico = type === 'success' ? '✓' : type === 'error' ? '!' : 'ℹ';
    t.innerHTML = `<span style="font-weight:700;">${ico}</span> ${msg}`;
    c.appendChild(t);
    setTimeout(() => { t.style.animation = 'toast-out 200ms ease-in forwards'; setTimeout(() => t.remove(), 200); }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
