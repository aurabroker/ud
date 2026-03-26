/**
 * app.js — Main controller — v3.0
 * Zmiany: zakładki Oferty/Klienci w dashboard, wysyłanie linku emailem
 */

const App = {
  currentView: 'dashboard',
  dashboardTab: 'oferty', // 'oferty' | 'klienci'
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
        Admin.switchTab(Admin.activeTab || 'clients');
        break;
    }
  },

  // ---- DASHBOARD z zakładkami ----
  async loadDashboard() {
    App.renderDashboardTabs();
    if (App.dashboardTab === 'oferty') {
      App.loadOferty();
    } else {
      App.loadKlienci();
    }
  },

  renderDashboardTabs() {
    const container = document.getElementById('dashboardTabsBar');
    if (!container) return;
    const tabs = [
      { key: 'oferty', label: '📋 Oferty' },
      { key: 'klienci', label: '👥 Klienci' },
    ];
    container.innerHTML = tabs.map(t => `
      <button onclick="App.switchDashboardTab('${t.key}')"
        class="admin-tab-btn ${App.dashboardTab === t.key ? 'active' : ''}">
        ${t.label}
      </button>
    `).join('');
  },

  switchDashboardTab(tab) {
    App.dashboardTab = tab;
    App.loadDashboard();
  },

  // ---- OFERTY ----
  async loadOferty() {
    const c = document.getElementById('offersListContainer');
    c.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><p style="margin-top:1rem;font-size:0.8rem;">Ładowanie...</p></div>`;

    // Przycisk "Nowa oferta"
    const actionsEl = document.getElementById('dashboardActions');
    if (actionsEl) actionsEl.innerHTML = `
      <button onclick="App.createNewOffer()" class="btn btn-primary">+ Nowa Oferta</button>
    `;

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

  // ---- KLIENCI ----
  async loadKlienci() {
    const c = document.getElementById('offersListContainer');
    c.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><p style="margin-top:1rem;font-size:0.8rem;">Ładowanie klientów...</p></div>`;

    // Przycisk "Nowy klient"
    const actionsEl = document.getElementById('dashboardActions');
    if (actionsEl) actionsEl.innerHTML = `
      <button onclick="App.openNewClientModal()" class="btn btn-primary">+ Nowy Klient</button>
    `;

    try {
      const clients = await Store.loadClients();
      if (clients.length === 0) {
        c.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">Brak klientów</div><div class="empty-state-text">Dodaj pierwszego klienta i wypełnij z nim ankietę.</div><button class="btn btn-primary" onclick="App.openNewClientModal()">+ Nowy Klient</button></div>`;
        return;
      }

      let html = '<div class="clients-grid">';
      clients.forEach(cl => {
        const date = new Date(cl.created_at).toLocaleString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric' });
        const medFlags = ['med_heart','med_diabetes','med_bones','med_stomach','med_neuro','med_surgery','med_aids'].filter(f => cl[f]);
        const riskCount = ['risk_balloon','risk_sailing','risk_skiing','risk_skydiving','risk_diving','risk_caving','risk_aviation','risk_extreme_bike_boat','risk_climbing','risk_paragliding','risk_horse','risk_horse_jumping','risk_gravity_bike','risk_quad','risk_hunting'].filter(f => cl[f]).length;
        const medBadge = medFlags.length > 0
          ? `<span class="badge badge-red">⚠️ ${medFlags.length} schorzeń</span>`
          : `<span class="badge badge-green">✓ Zdrowy</span>`;

        html += `<div class="offer-card" onclick="App.showClientDetail('${cl.id}')">
          <div class="offer-card-name">${escHtml(cl.full_name || '—')}</div>
          <div class="offer-card-client">${escHtml(cl.email || cl.phone || '—')}</div>
          <div class="offer-card-meta">
            <span>${date}</span>
            ${medBadge}
            ${riskCount > 0 ? `<span class="badge badge-amber">⚡ ${riskCount} sportów</span>` : ''}
          </div>
          <div class="offer-card-actions">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();App.createOfferForClient('${cl.id}')" title="Utwórz ofertę">📊 Oferta</button>
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();App.openSurveyModal('${cl.id}')" title="Wypełnij ankietę">📝 Ankieta</button>
          </div>
        </div>`;
      });
      c.innerHTML = html + '</div>';
    } catch (err) { c.innerHTML = `<div class="empty-state" style="color:var(--red-500);"><p>${err.message}</p></div>`; }
  },

  // ---- SZCZEGÓŁY KLIENTA ----
  showClientDetail(clientId) {
    Admin.showClientDetail(clientId);
  },

  // ---- UTWÓRZ OFERTĘ DLA KLIENTA ----
  createOfferForClient(clientId) {
    const c = Store.dbClients.find(x => x.id === clientId);
    if (!c) return;
    App.closeModal('clientDetailModal');
    Store.resetState();
    Store.state.clientId = clientId;
    Store.state.clientName = c.full_name || '';
    App.syncEditorUI();
    App.navigateTo('editor');
    Matrix.render();
    App.toast(`Oferta dla ${c.full_name || 'klienta'} — dodaj ryzyka i ubezpieczycieli`, 'info');
  },

  // ---- NOWY KLIENT ----
  openNewClientModal() {
    // Otwiera modal ankiety z czystym formularzem
    Store.state.surveyClientId = null;
    App.openSurveyModal(null);
  },

  // ---- MODAL ANKIETY ----
  openSurveyModal(clientId) {
    const modal = document.getElementById('surveyModal');
    if (!modal) return;

    const client = clientId ? Store.dbClients.find(x => x.id === clientId) : null;

    // Wypełnij formularz danymi klienta lub wyczyść
    document.getElementById('surveyFullName').value = client?.full_name || '';
    document.getElementById('surveyEmail').value = client?.email || '';
    document.getElementById('surveyPhone').value = client?.phone || '';
    document.getElementById('surveyPesel').value = client?.pesel || '';
    document.getElementById('surveyProfession').value = client?.profession || '';
    document.getElementById('surveyEmploymentType').value = client?.employment_type || 'b2b';

    // Medyczne
    ['heart','diabetes','bones','stomach','neuro','surgery','aids'].forEach(f => {
      const el = document.getElementById(`survey_med_${f}`);
      if (el) el.checked = client?.[`med_${f}`] || false;
    });
    document.getElementById('surveyMedNotes').value = client?.med_notes || '';

    // Sporty
    ['balloon','sailing','skiing','skydiving','diving','caving','aviation','extreme_bike_boat','climbing','paragliding','horse','horse_jumping','gravity_bike','quad','hunting'].forEach(f => {
      const el = document.getElementById(`survey_risk_${f}`);
      if (el) el.checked = client?.[`risk_${f}`] || false;
    });

    document.getElementById('surveyModalTitle').textContent = client ? `Ankieta: ${client.full_name}` : 'Nowy Klient — Ankieta';
    document.getElementById('surveyClientIdHidden').value = clientId || '';
    modal.classList.remove('hidden');
  },

  async saveSurvey() {
    const btn = document.getElementById('surveySaveBtn');
    btn.disabled = true; btn.textContent = 'Zapisuję...';

    const clientId = document.getElementById('surveyClientIdHidden').value || null;

    const payload = {
      full_name: document.getElementById('surveyFullName').value.trim(),
      email: document.getElementById('surveyEmail').value.trim(),
      phone: document.getElementById('surveyPhone').value.trim(),
      pesel: document.getElementById('surveyPesel').value.trim(),
      profession: document.getElementById('surveyProfession').value.trim(),
      employment_type: document.getElementById('surveyEmploymentType').value,
      // Medyczne
      med_heart: document.getElementById('survey_med_heart')?.checked || false,
      med_diabetes: document.getElementById('survey_med_diabetes')?.checked || false,
      med_bones: document.getElementById('survey_med_bones')?.checked || false,
      med_stomach: document.getElementById('survey_med_stomach')?.checked || false,
      med_neuro: document.getElementById('survey_med_neuro')?.checked || false,
      med_surgery: document.getElementById('survey_med_surgery')?.checked || false,
      med_aids: document.getElementById('survey_med_aids')?.checked || false,
      med_notes: document.getElementById('surveyMedNotes').value,
      // Sporty
      risk_balloon: document.getElementById('survey_risk_balloon')?.checked || false,
      risk_sailing: document.getElementById('survey_risk_sailing')?.checked || false,
      risk_skiing: document.getElementById('survey_risk_skiing')?.checked || false,
      risk_skydiving: document.getElementById('survey_risk_skydiving')?.checked || false,
      risk_diving: document.getElementById('survey_risk_diving')?.checked || false,
      risk_caving: document.getElementById('survey_risk_caving')?.checked || false,
      risk_aviation: document.getElementById('survey_risk_aviation')?.checked || false,
      risk_extreme_bike_boat: document.getElementById('survey_risk_extreme_bike_boat')?.checked || false,
      risk_climbing: document.getElementById('survey_risk_climbing')?.checked || false,
      risk_paragliding: document.getElementById('survey_risk_paragliding')?.checked || false,
      risk_horse: document.getElementById('survey_risk_horse')?.checked || false,
      risk_horse_jumping: document.getElementById('survey_risk_horse_jumping')?.checked || false,
      risk_gravity_bike: document.getElementById('survey_risk_gravity_bike')?.checked || false,
      risk_quad: document.getElementById('survey_risk_quad')?.checked || false,
      risk_hunting: document.getElementById('survey_risk_hunting')?.checked || false,
      source: 'broker_panel',
    };

    if (!payload.full_name) { App.toast('Podaj imię i nazwisko', 'error'); btn.disabled = false; btn.textContent = 'Zapisz'; return; }

    try {
      const saved = await Store.saveClient(payload, clientId);
      App.closeModal('surveyModal');
      App.toast(clientId ? 'Ankieta zaktualizowana' : 'Klient dodany', 'success');
      // Odśwież listę
      await Store.loadClients();
      App.loadKlienci();
    } catch (err) {
      App.toast('Błąd: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Zapisz';
    }
  },

  // ---- WYSYŁANIE LINKU NA EMAIL ----
  async sendOfferByEmail() {
    const s = Store.state;
    if (!s.offerId) { App.toast('Najpierw zapisz ofertę', 'error'); return; }
    const modal = document.getElementById('sendEmailModal');
    const emailInput = document.getElementById('sendEmailInput');
    if (s.clientId) {
      const client = Store.dbClients.find(c => c.id === s.clientId);
      if (client?.email) emailInput.value = client.email;
    }
    modal.classList.remove('hidden');
  },

  async sendOfferByEmailConfirm() {
    const s = Store.state;
    const email = document.getElementById('sendEmailInput').value.trim();
    if (!email || !email.includes('@')) { App.toast('Podaj prawidłowy adres email', 'error'); return; }

    const btn = document.getElementById('sendEmailBtn');
    btn.disabled = true; btn.textContent = 'Wysyłanie...';

    try {
      // Wygeneruj link jeśli nie istnieje
      let shareToken = s.shareToken;
      if (!shareToken) {
        const result = await Store.saveOffer(true);
        shareToken = result.share_token;
        s.shareToken = shareToken;
      }
      const link = `${window.location.origin}${window.location.pathname}?share=${shareToken}`;

      const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/send-offer-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
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
      btn.disabled = false; btn.textContent = 'Wyślij';
    }
  },

  // ---- OFERTY (bez zmian) ----
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
      try { await Store.deleteOffer(id); App.closeModal('confirmModal'); App.toast('Usunięto', 'success'); App.loadOferty(); }
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

  syncEditorUI() {
    document.getElementById('editorOfferName').value = Store.state.offerName;
    document.getElementById('editorClientName').value = Store.state.clientName;
    document.getElementById('brokerMessage').value = Store.state.brokerMessage;
  },

  exportPDF() {
    const s = Store.state;
    if (s.insurers.length === 0 || s.risks.length === 0) { App.toast('Pusta oferta', 'error'); return; }

    const btn = document.getElementById('btnExportPdf');
    const orig = btn.innerHTML;
    btn.innerHTML = '⏳ Generuję...'; btn.disabled = true;

    // Freeze form values into attributes so html2canvas captures them
    document.querySelectorAll('input,select,textarea').forEach(el => {
      if (el.type !== 'submit') el.setAttribute('value', el.value);
    });

    // Scroll to top to avoid offset issues
    window.scrollTo(0, 0);

    // Enter PDF mode — hides .no-pdf elements via CSS
    document.body.classList.add('pdf-mode');

    const exportEl = document.getElementById('exportContent');
    const fileName = `UD_${(s.offerName || 'Oferta').replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _-]/g, '')}.pdf`;

    // Small delay to let browser repaint after pdf-mode class
    setTimeout(() => {
      html2pdf().set({
        margin:       [0.4, 0.3, 0.4, 0.3],
        filename:     fileName,
        image:        { type: 'jpeg', quality: 0.95 },
        html2canvas:  {
          scale: 2,
          useCORS: true,
          scrollX: 0,
          scrollY: 0,
          windowWidth: 1200,
          logging: false,
          removeContainer: true,
        },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'landscape' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
      })
      .from(exportEl)
      .save()
      .then(() => {
        App.toast('PDF wygenerowany', 'success');
      })
      .catch(err => {
        console.error('PDF export error:', err);
        App.toast('Błąd generowania PDF: ' + (err.message || 'nieznany'), 'error');
      })
      .finally(() => {
        btn.innerHTML = orig;
        btn.disabled = false;
        document.body.classList.remove('pdf-mode');
      });
    }, 100);
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
        document.getElementById('newUserRole').value,
        document.getElementById('newUserRefId')?.value.trim() || null,
        document.getElementById('newUserLeader')?.value || null
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
      ClientView.renderGreeting();
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
