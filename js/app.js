/**
 * app.js — Main application controller
 */

const App = {
  currentView: 'dashboard',
  isClientView: false,

  // ---- INIT ----
  async init() {
    // Check for client share link
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');

    if (shareToken) {
      await App.initClientView(shareToken);
      return;
    }

    // Normal login flow
    try {
      const loggedIn = await Auth.init();
      if (loggedIn) {
        // Check if user is active
        if (Auth.userProfile && Auth.userProfile.active === false) {
          App.showLoginError('Twoje konto zostało zablokowane. Skontaktuj się z administratorem.');
          await Auth.logout();
          return;
        }
        App.showApp();
      }
    } catch (err) {
      console.error('Init error:', err);
    }

    // Login form
    document.getElementById('loginForm').addEventListener('submit', App.handleLogin);

    // Nav buttons
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => App.navigateTo(btn.dataset.view));
    });
  },

  // ---- LOGIN ----
  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('loginBtn');

    App.hideLoginError();
    btn.disabled = true;
    btn.textContent = 'Logowanie...';

    try {
      await Auth.login(email, password);

      // Check if user is active
      if (Auth.userProfile && Auth.userProfile.active === false) {
        App.showLoginError('Twoje konto zostało zablokowane. Skontaktuj się z administratorem.');
        await Auth.logout();
        return;
      }

      App.showApp();
    } catch (err) {
      console.error('Login error:', err);
      let msg = 'Nieprawidłowy email lub hasło.';
      if (err.message?.includes('Invalid login')) msg = 'Nieprawidłowy email lub hasło.';
      else if (err.message?.includes('Email not confirmed')) msg = 'Email nie został potwierdzony. Sprawdź skrzynkę.';
      else if (err.message) msg = err.message;
      App.showLoginError(msg);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Zaloguj się';
    }
  },

  showLoginError(msg) {
    const el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  hideLoginError() {
    document.getElementById('loginError').classList.add('hidden');
  },

  // ---- SHOW APP ----
  async showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');

    // Update header
    document.getElementById('userName').textContent = Auth.getDisplayName();
    document.getElementById('userAvatar').textContent = Auth.getInitials();
    document.getElementById('userRole').textContent = Auth.isAdmin() ? 'Admin' : 'User';

    // Show/hide admin nav
    const isAdmin = Auth.isAdmin();
    document.getElementById('navAdminBtn').classList.toggle('hidden', !isAdmin);
    const mobileAdminBtn = document.getElementById('mobileAdminBtn');
    if (mobileAdminBtn) mobileAdminBtn.classList.toggle('hidden', !isAdmin);

    // Load reference data
    try {
      await Store.loadReferenceData();
    } catch (err) {
      console.error('Error loading reference data:', err);
      App.toast('Błąd ładowania bazy ryzyk/ubezpieczycieli', 'error');
    }

    // Show dashboard
    App.navigateTo('dashboard');
  },

  // ---- NAVIGATION ----
  navigateTo(view) {
    App.currentView = view;

    // Hide all views
    document.getElementById('viewDashboard').classList.add('hidden');
    document.getElementById('viewEditor').classList.add('hidden');
    document.getElementById('viewAdmin').classList.add('hidden');

    // Update nav buttons
    document.querySelectorAll('[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Show target view
    switch (view) {
      case 'dashboard':
        document.getElementById('viewDashboard').classList.remove('hidden');
        App.loadDashboard();
        break;
      case 'editor':
        document.getElementById('viewEditor').classList.remove('hidden');
        break;
      case 'admin':
        if (!Auth.isAdmin()) {
          App.toast('Brak uprawnień', 'error');
          App.navigateTo('dashboard');
          return;
        }
        document.getElementById('viewAdmin').classList.remove('hidden');
        Admin.loadUsers();
        break;
    }
  },

  // ---- DASHBOARD ----
  async loadDashboard() {
    const container = document.getElementById('offersListContainer');
    container.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><p style="margin-top:1rem; font-size:0.8rem;">Ładowanie ofert...</p></div>`;

    try {
      const offers = await Store.loadOffers();

      if (offers.length === 0) {
        container.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">Brak ofert</div>
          <div class="empty-state-text">Utwórz pierwszą ofertę porównawczą Leadenhall vs CEU.</div>
          <button class="btn btn-primary" onclick="App.createNewOffer()">+ Nowa Oferta</button>
        </div>`;
        return;
      }

      let html = '<div class="offers-grid">';
      offers.forEach(o => {
        const date = new Date(o.updated_at || o.created_at).toLocaleString('pl-PL', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        html += `<div class="offer-card" onclick="App.openOffer('${o.id}')">
          <div class="offer-card-name">${o.name || 'Bez nazwy'}</div>
          <div class="offer-card-client">${o.client_name || 'Brak klienta'}</div>
          <div class="offer-card-meta">
            <span>${date}</span>
            <span>${o.version || 'v1.0'}</span>
            ${o.share_token ? '<span style="color:var(--green-600);">🔗 udostępniono</span>' : ''}
          </div>
          <div class="offer-card-actions">
            <button class="btn btn-ghost btn-icon" onclick="event.stopPropagation(); App.duplicateOffer('${o.id}')" title="Duplikuj">📋</button>
            <button class="btn btn-ghost btn-icon" onclick="event.stopPropagation(); App.confirmDeleteOffer('${o.id}', '${(o.name || '').replace(/'/g, "\\'")}')" title="Usuń" style="color:var(--red-500);">🗑</button>
          </div>
        </div>`;
      });
      html += '</div>';
      container.innerHTML = html;

    } catch (err) {
      console.error('Error loading offers:', err);
      container.innerHTML = `<div class="empty-state" style="color:var(--red-500);">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Błąd ładowania</div>
        <div class="empty-state-text">${err.message}</div>
      </div>`;
    }
  },

  // ---- OFFER OPERATIONS ----
  createNewOffer() {
    Store.resetState();
    App.syncEditorUI();
    App.navigateTo('editor');
    Matrix.render();
  },

  async openOffer(id) {
    try {
      const offer = await Store.loadOffer(id);
      Store.hydrateState(offer);
      App.syncEditorUI();
      App.navigateTo('editor');
      Matrix.render();
    } catch (err) {
      console.error('Error loading offer:', err);
      App.toast('Błąd wczytywania oferty: ' + err.message, 'error');
    }
  },

  async duplicateOffer(id) {
    try {
      const offer = await Store.loadOffer(id);
      Store.hydrateState(offer);
      Store.state.offerId = null; // New copy
      Store.state.offerName = (Store.state.offerName || 'Oferta') + ' (kopia)';
      App.syncEditorUI();
      App.navigateTo('editor');
      Matrix.render();
      App.toast('Oferta zduplikowana. Zapisz, aby zachować.', 'info');
    } catch (err) {
      App.toast('Błąd duplikowania: ' + err.message, 'error');
    }
  },

  confirmDeleteOffer(id, name) {
    document.getElementById('confirmTitle').textContent = 'Usuń ofertę';
    document.getElementById('confirmMessage').textContent = `Czy na pewno chcesz usunąć ofertę "${name}"? Tej operacji nie można cofnąć.`;
    const actionBtn = document.getElementById('confirmActionBtn');
    actionBtn.textContent = 'Usuń';
    actionBtn.onclick = async () => {
      try {
        await Store.deleteOffer(id);
        App.closeModal('confirmModal');
        App.toast('Oferta usunięta', 'success');
        App.loadDashboard();
      } catch (err) {
        App.toast('Błąd usuwania: ' + err.message, 'error');
      }
    };
    document.getElementById('confirmModal').classList.remove('hidden');
  },

  async saveOffer(generateLink) {
    const s = Store.state;

    if (s.insurers.length === 0 || s.risks.length === 0) {
      App.toast('Dodaj minimum jedno ryzyko i jednego ubezpieczyciela', 'error');
      return;
    }

    // Sync inputs
    s.offerName = document.getElementById('editorOfferName').value.trim();
    s.clientName = document.getElementById('editorClientName').value.trim();
    s.brokerMessage = document.getElementById('brokerMessage').value;

    const btn = generateLink ? document.getElementById('btnClientLink') : document.getElementById('btnSaveOffer');
    const origText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner spinner-sm"></span> Zapisuję...';
    btn.disabled = true;

    try {
      const result = await Store.saveOffer(generateLink);

      if (generateLink) {
        const token = result.share_token;
        const link = `${window.location.origin}${window.location.pathname}?share=${token}`;
        
        try {
          await navigator.clipboard.writeText(link);
          App.toast('Link skopiowany do schowka', 'success');
        } catch {
          prompt('Skopiuj ten link i wyślij Klientowi:', link);
        }
      } else {
        App.toast('Oferta zapisana pomyślnie', 'success');
      }

      // Update URL
      if (result.id) {
        const url = new URL(window.location);
        url.searchParams.set('offer', result.id);
        window.history.replaceState(null, '', url);
      }

      // Update name if auto-generated
      document.getElementById('editorOfferName').value = s.offerName;
    } catch (err) {
      console.error('Save error:', err);
      App.toast('Błąd zapisu: ' + err.message, 'error');
    } finally {
      btn.innerHTML = origText;
      btn.disabled = false;
    }
  },

  // ---- EDITOR SYNC ----
  syncEditorUI() {
    document.getElementById('editorOfferName').value = Store.state.offerName;
    document.getElementById('editorClientName').value = Store.state.clientName;
    document.getElementById('brokerMessage').value = Store.state.brokerMessage;
  },

  // ---- PDF EXPORT ----
  exportPDF() {
    const s = Store.state;
    if (s.insurers.length === 0 || s.risks.length === 0) {
      App.toast('Nie można eksportować pustej oferty', 'error');
      return;
    }

    // Sync name
    const nameInput = document.getElementById('editorOfferName');
    if (!nameInput.value.trim()) {
      const initials = s.insurers.map(tu =>
        (tu.short_name || tu.name).split(/[\s-]+/).map(w => w.charAt(0).toUpperCase()).join('')
      ).join('-');
      nameInput.value = `${initials}_${new Date().toISOString().slice(0, 10)}`;
      s.offerName = nameInput.value;
    }

    // Freeze input values for PDF
    document.querySelectorAll('input[type="text"], input[type="number"]').forEach(el => {
      el.setAttribute('value', el.value);
    });
    document.querySelectorAll('select').forEach(el => {
      Array.from(el.options).forEach(opt => {
        if (opt.value === el.value) opt.setAttribute('selected', 'selected');
        else opt.removeAttribute('selected');
      });
    });

    document.body.classList.add('pdf-mode');

    const btn = document.getElementById('btnExportPdf');
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳ Eksport...';
    btn.disabled = true;

    const element = document.getElementById('exportContent');
    const opt = {
      margin: 0.3,
      filename: `UD_${s.offerName || 'Oferta'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0, windowWidth: element.scrollWidth + 100 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
      btn.innerHTML = origText;
      btn.disabled = false;
      document.body.classList.remove('pdf-mode');
    });
  },

  // ---- MODALS ----
  openRiskPicker() {
    Matrix.renderRiskPicker();
    document.getElementById('riskPickerModal').classList.remove('hidden');
  },

  openInsurerPicker() {
    Matrix.renderInsurerPicker();
    document.getElementById('insurerPickerModal').classList.remove('hidden');
  },

  closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  },

  // ---- ADMIN: ADD USER ----
  openAddUserModal() {
    document.getElementById('addUserForm').reset();
    document.getElementById('addUserModal').classList.remove('hidden');
  },

  async addUser(e) {
    e.preventDefault();
    const email = document.getElementById('newUserEmail').value.trim();
    const name = document.getElementById('newUserName').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;

    const btn = document.getElementById('addUserBtn');
    btn.disabled = true;
    btn.textContent = 'Tworzenie...';

    try {
      await Auth.adminCreateUser(email, password, name, role);
      App.toast(`Użytkownik ${email} utworzony`, 'success');
      App.closeModal('addUserModal');
      Admin.loadUsers();
    } catch (err) {
      console.error('Error creating user:', err);
      App.toast('Błąd: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Utwórz konto';
    }
  },

  // ---- LOGOUT ----
  async logout() {
    await Auth.logout();
    document.getElementById('appScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('loginForm').reset();
  },

  // ---- CLIENT VIEW ----
  async initClientView(token) {
    App.isClientView = true;
    Matrix.isClientView = true;

    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');

    // Show client header, hide broker UI
    document.getElementById('clientHeader').classList.remove('hidden');
    document.querySelectorAll('.no-client').forEach(el => el.classList.add('hidden'));

    // Hide dashboard, show editor
    document.getElementById('viewDashboard').classList.add('hidden');
    document.getElementById('viewEditor').classList.remove('hidden');

    try {
      await Store.loadReferenceData();
      const offer = await Store.loadOfferByToken(token);

      if (!offer) {
        document.getElementById('scoringResults').innerHTML = `<div class="empty-state" style="padding:2rem; grid-column:1/-1;">
          <p style="color:var(--red-500); font-weight:700;">Oferta nie istnieje lub link wygasł.</p>
        </div>`;
        return;
      }

      Store.hydrateState(offer);

      // Client header title
      document.getElementById('clientHeaderTitle').textContent =
        `Rekomendacja: ${Store.state.offerName || 'Porównanie'}`;

      // Client message
      if (Store.state.brokerMessage) {
        document.getElementById('clientMessageSection').classList.remove('hidden');
        document.getElementById('clientMessageDisplay').textContent = Store.state.brokerMessage;
      }

      Matrix.render();
    } catch (err) {
      console.error('Client view error:', err);
      document.getElementById('scoringResults').innerHTML = `<div class="empty-state" style="padding:2rem; grid-column:1/-1;">
        <p style="color:var(--red-500); font-weight:700;">Błąd: ${err.message}</p>
      </div>`;
    }
  },

  // ---- TOAST NOTIFICATIONS ----
  toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '!' : 'ℹ';
    toast.innerHTML = `<span style="font-weight:700;">${icon}</span> ${message}`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-out 200ms ease-in forwards';
      setTimeout(() => toast.remove(), 200);
    }, 3500);
  }
};

// ---- BOOT ----
document.addEventListener('DOMContentLoaded', () => App.init());
