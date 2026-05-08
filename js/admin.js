/**
 * admin.js — Admin panel: users + clients + stats + reflinks — v3.0
 * Supports: 4 tabs, team cards, ref ID hierarchy, client counters
 */

const Admin = {
  activeTab: 'clients',

  // ---- TAB SWITCHING (4 tabs) ----
  switchTab(tab) {
    Admin.activeTab = tab;
    document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));

    const tabMap = {
      clients:  'adminClientsSection',
      users:    'adminUsersSection',
      stats:    'adminStatsSection',
      reflinks: 'adminRefLinksSection'
    };

    const target = document.getElementById(tabMap[tab]);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll(`.admin-tab-btn[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));

    if (tab === 'users') Admin.loadUsers();
    else if (tab === 'clients') Admin.loadClients();
    else if (tab === 'stats') Admin.loadStats();
    else if (tab === 'reflinks') Admin.loadRefLinks();
  },

  // ---- USERS ----
  async loadUsers() {
    const tbody = document.getElementById('adminUsersList');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;"><div class="spinner"></div></td></tr>`;

    try {
      const users = await Store.loadUsers();
      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--slate-400);">Brak użytkowników</td></tr>`;
        return;
      }

      // Try team cards if data supports it
      const hasTeamData = users.some(u => u.ref_id || u.leader_id);
      if (hasTeamData && typeof Admin.renderTeamCards === 'function') {
        Admin.renderTeamCards(users);
      }
          if (hasTeamData) return; // nie renderuj flat table gdy sa team cards

      // Flat table (always rendered as fallback)
      let html = '';
      users.forEach(u => {
        const isCurrent = u.id === Auth.currentUser?.id;
    
        // Role badge
        let roleBadge;
        if (u.role === 'admin') roleBadge = '<span class="admin-role-badge admin">Admin</span>';
        else if (u.role === 'leader') roleBadge = '<span class="admin-role-badge leader">Lider</span>';
        else roleBadge = '<span class="admin-role-badge user">User</span>';

        // Status
        const isActive = u.active !== false;
        const status = isActive
          ? '<span class="admin-status-dot active"></span>Aktywny'
          : '<span class="admin-status-dot inactive"></span>Zablokowany';

        // Client count
        const clientCount = u.client_count || 0;
        const clientCell = clientCount > 0
          ? `<span style="font-weight:700;color:var(--emerald-600,#059669);">${clientCount}</span>`
          : `<span style="color:var(--slate-400);">0</span>`;

        // Ref ID
        const refCell = u.ref_id
          ? `<span class="ref-id-cell" title="Kliknij aby skopiować link" onclick="event.stopPropagation();Admin.copyRef('${u.ref_id}')">${u.ref_id}</span>`
          : '<span style="color:var(--slate-400);font-size:0.75rem;">—</span>';

        // Actions
        let actions = '—';
        if (!isCurrent) {
          actions = `<div style="display:flex;gap:0.25rem;">
            <button class="btn btn-ghost btn-sm" onclick="Admin.toggleActive('${u.id}',${isActive})" title="${isActive ? 'Zablokuj' : 'Odblokuj'}">${isActive ? '🔒' : '🔓'}</button>
            <button class="btn btn-ghost btn-sm" onclick="Admin.toggleRole('${u.id}','${u.role}')" title="${u.role === 'admin' ? 'Na User' : 'Na Admin'}">${u.role === 'admin' ? '👤' : '👑'}</button>
          </div>`;
        }

        html += `<tr>
          <td class="admin-user-email">${escHtml(u.full_name || u.id.substring(0, 8))}${isCurrent ? ' <span style="color:var(--blue-600);font-size:0.7rem;">(Ty)</span>' : ''}</td>
          <td>${roleBadge}</td>
          <td style="font-size:0.75rem;">${status}</td>
          <td style="text-align:center;">${clientCell}</td>
          <td>${refCell}</td>
          <td>${actions}</td>
        </tr>`;
      });
      tbody.innerHTML = html;

      // Populate ref link dropdown
      Admin.populateRefUserDropdown(users);

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red-500);text-align:center;padding:1rem;">${err.message}</td></tr>`;
    }
  },

  // ---- CLIENTS ----
  async loadClients() {
    const tbody = document.getElementById('adminClientsList');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;"><div class="spinner"></div></td></tr>`;

    try {
      const clients = await Store.loadClients();
      Admin.updateClientCounters(clients);

      if (clients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--slate-400);">Brak klientów z formularza</td></tr>`;
        return;
      }

      let html = '';
      clients.forEach(c => {
        const date = new Date(c.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const refCell = c.ref_source
          ? `<span class="ref-id-cell">${c.ref_source}</span>`
          : '<span style="color:var(--slate-400);font-size:0.75rem;">—</span>';

        const assignedTo = c.assigned_user_name || c.assigned_to || '—';

        html += `<tr style="cursor:pointer;" onclick="Admin.showClientDetail('${c.id}')">
          <td style="font-weight:600;">${escHtml(c.full_name || '—')}</td>
          <td>${escHtml(c.email || '—')}</td>
          <td>${escHtml(c.phone || '—')}</td>
          <td style="font-size:0.8rem;">${escHtml(assignedTo)}</td>
          <td>${refCell}</td>
          <td style="font-size:0.7rem;color:var(--slate-400);">${date}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red-500);text-align:center;padding:1rem;">${err.message}</td></tr>`;
    }
  },

  // ---- CLIENT COUNTERS ----
  updateClientCounters(clients) {
    const totalEl = document.getElementById('clientsTotalCount');
    const newEl = document.getElementById('clientsNewCount');
    const badgeEl = document.getElementById('clientsTabBadge');

    if (totalEl) totalEl.textContent = clients.length;

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newCount = clients.filter(c => new Date(c.created_at).getTime() > weekAgo).length;

    if (newEl) {
      newEl.textContent = `${newCount} nowych`;
      newEl.style.display = newCount > 0 ? 'inline' : 'none';
    }
    if (badgeEl) {
      badgeEl.textContent = newCount;
      badgeEl.style.display = newCount > 0 ? 'inline' : 'none';
    }
  },

  // ---- CLIENT SEARCH ----
  filterClients(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#adminClientsList tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  },

  // ---- CLIENT DETAIL MODAL ----
  showClientDetail(clientId) {
    const c = Store.dbClients.find(x => x.id === clientId);
    if (!c) return;

    const body = document.getElementById('clientDetailBody');
    const riskFields = [
      ['risk_balloon', 'Baloniarstwo'], ['risk_sailing', 'Żeglarstwo'], ['risk_skiing', 'Narciarstwo'],
      ['risk_skydiving', 'Skoki spadochronowe'], ['risk_diving', 'Nurkowanie'], ['risk_caving', 'Speleologia'],
      ['risk_aviation', 'Lotnictwo amatorskie'], ['risk_aviation_non_comm', 'Lotnictwo niekomercyjne'],
      ['risk_extreme_bike_boat', 'Ekstr. rower/łódź'], ['risk_climbing', 'Wspinaczka'],
      ['risk_paragliding', 'Paralotniarstwo'], ['risk_horse', 'Jazda konna'],
      ['risk_horse_jumping', 'Skoki konne'], ['risk_gravity_bike', 'Gravity bike'],
      ['risk_quad', 'Quad/ATV'], ['risk_hunting', 'Polowanie'], ['risk_motorcycle', 'Motocykl']
    ];
    const medFields = [
      ['med_heart', 'Serce / nadciśnienie', 'med_heart_notes'],
      ['med_diabetes', 'Cukrzyca / nerki', 'med_diabetes_notes'],
      ['med_bones', 'Kręgosłup / stawy', 'med_bones_notes'],
      ['med_stomach', 'Żołądek / jelita', 'med_stomach_notes'],
      ['med_neuro', 'Depresja / nerwica', 'med_neuro_notes'],
      ['med_surgery', 'Operacje / leki stałe', 'med_surgery_notes'],
      ['med_aids', 'AIDS / HIV', 'med_aids_notes']
    ];

    let html = `<div class="client-detail-grid">`;

    // Dane podstawowe
    html += `<div class="client-detail-section">
      <h4>📋 Dane podstawowe</h4>
      <div class="detail-row"><span>Imię i nazwisko</span><strong>${escHtml(c.full_name || '—')}</strong></div>
      <div class="detail-row"><span>Email</span><strong>${escHtml(c.email || '—')}</strong></div>
      <div class="detail-row"><span>Telefon</span><strong>${escHtml(c.phone || '—')}</strong></div>
      <div class="detail-row"><span>PESEL</span><strong>${escHtml(c.pesel || '—')}</strong></div>
      <div class="detail-row"><span>Forma zatrudnienia</span><strong>${escHtml(c.employment_type || '—')}</strong></div>
      <div class="detail-row"><span>Zawód</span><strong>${escHtml(c.profession || '—')}</strong></div>
      <div class="detail-row"><span>Forma opodatkowania</span><strong>${escHtml(c.tax_form || '—')}</strong></div>
      <div class="detail-row"><span>Waga / Wzrost</span><strong>${c.weight ? c.weight + ' kg' : '—'} / ${c.height ? c.height + ' cm' : '—'}</strong></div>
      <div class="detail-row"><span>Ręczność</span><strong>${escHtml(c.handedness || '—')}</strong></div>
    </div>`;

    // Dane B2B
    if (c.employs_people || c.b2b_start_date || c.b2b_industry) {
      html += `<div class="client-detail-section">
        <h4>🏢 Dane B2B</h4>
        <div class="detail-row"><span>Zatrudnia</span><strong>${c.employs_people ? 'Tak' : 'Nie'}</strong></div>
        <div class="detail-row"><span>Data rozpoczęcia</span><strong>${escHtml(c.b2b_start_date || '—')}</strong></div>
        <div class="detail-row"><span>Branża</span><strong>${escHtml(c.b2b_industry || '—')}</strong></div>
        <div class="detail-row"><span>Charakter</span><strong>${escHtml(c.b2b_character || '—')}</strong></div>
        <div class="detail-row"><span>Obszar</span><strong>${escHtml(c.b2b_area || '—')}</strong></div>
        <div class="detail-row"><span>Pracownicy 2024</span><strong>${escHtml(c.b2b_employees_2024 || '—')}</strong></div>
        <div class="detail-row"><span>Pracownicy 2025</span><strong>${escHtml(c.b2b_employees_2025 || '—')}</strong></div>
        <div class="detail-row"><span>Dochód B2B</span><strong>${c.b2b_income ? formatCurrency(c.b2b_income) + ' zł' : '—'}</strong></div>
        <div class="detail-row"><span>Miesięcy działalności</span><strong>${escHtml(String(c.b2b_months || '—'))}</strong></div>
        <div class="detail-row"><span>Okres karencji</span><strong>${escHtml(c.b2b_period || '—')}</strong></div>
        <div class="detail-row"><span>HIV (B2B)</span><strong style="color:${c.b2b_hiv ? 'var(--red-600)' : 'var(--green-600)'};">${c.b2b_hiv ? '⚠️ Tak' : '✓ Nie'}</strong></div>
        <div class="detail-row"><span>Suma NW</span><strong>${c.b2b_nw_sum ? formatCurrency(c.b2b_nw_sum) + ' zł' : '—'}</strong></div>
        <div class="detail-row"><span>Wkład własny</span><strong>${escHtml(c.b2b_own_contribution || '—')}</strong></div>
        ${c.b2b_description ? `<div class="detail-row full"><span>Opis czynności</span><div style="margin-top:0.25rem;font-size:0.8rem;color:var(--slate-600);">${escHtml(c.b2b_description)}</div></div>` : ''}
      </div>`;
    }

    // Wybór ryzyk / sumy
    if (c.risk_death_invalidity || c.risk_temp_incapacity || c.risk_perm_incapacity || c.nw_death_sum) {
      html += `<div class="client-detail-section">
        <h4>🎯 Wybór ryzyk</h4>
        <div class="detail-row"><span>Śmierć / inwalidztwo</span><strong style="color:${c.risk_death_invalidity ? 'var(--blue-600)' : 'var(--slate-400)'};">${c.risk_death_invalidity ? '✓ Tak' : 'Nie'}</strong></div>
        <div class="detail-row"><span>Przejściowa niezdolność</span><strong style="color:${c.risk_temp_incapacity ? 'var(--blue-600)' : 'var(--slate-400)'};">${c.risk_temp_incapacity ? '✓ Tak' : 'Nie'}</strong></div>
        <div class="detail-row"><span>Trwała niezdolność</span><strong style="color:${c.risk_perm_incapacity ? 'var(--blue-600)' : 'var(--slate-400)'};">${c.risk_perm_incapacity ? '✓ Tak' : 'Nie'}</strong></div>
        <div class="detail-row"><span>Suma NW śmierć</span><strong>${c.nw_death_sum ? formatCurrency(c.nw_death_sum) + ' zł' : '—'}</strong></div>
      </div>`;
    }

    // Klauzule NW
    const nwFields = [
      ['nw_funeral', 'Zasiłek pogrzebowy'], ['nw_adaptation', 'Adaptacja mieszkania'],
      ['nw_hospital_daily', 'Dzienna szpitalna'], ['nw_medical_costs', 'Koszty leczenia'],
      ['nw_unconscious_weekly', 'Tygodniowa nieprzytomność'], ['nw_permanent_damage', 'Trwały uszczerbek']
    ];
    const activeNw = nwFields.filter(([key]) => c[key]);
    if (activeNw.length > 0) {
      html += `<div class="client-detail-section"><h4>🛡️ Klauzule NW (${activeNw.length})</h4>
        <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">`;
      activeNw.forEach(([, label]) => {
        html += `<span style="font-size:0.7rem;font-weight:600;background:#eff6ff;color:var(--blue-600);padding:0.2rem 0.5rem;border-radius:4px;border:1px solid #bfdbfe;">${label}</span>`;
      });
      html += `</div></div>`;
    }

    // Ankieta medyczna
    html += `<div class="client-detail-section"><h4>🩺 Ankieta medyczna</h4>`;
    medFields.forEach(([key, label, notesKey]) => {
      const val = c[key];
      const notes = c[notesKey];
      html += `<div class="detail-row"><span>${label}</span><strong style="color:${val ? 'var(--red-600)' : 'var(--green-600)'};">${val ? '⚠️ Tak' : '✓ Nie'}</strong></div>`;
      if (val && notes) {
        html += `<div style="margin:-0.15rem 0 0.4rem 0;padding:0.35rem 0.5rem;font-size:0.78rem;color:var(--slate-600);background:var(--amber-50);border-radius:4px;border:1px solid #fde68a;">${escHtml(notes)}</div>`;
      }
    });
    html += `</div>`;

    // Przesiew zdrowotny
    const healthFields = [
      ['weight_change', 'Zmiana masy ciała'], ['takes_meds', 'Przyjmuje leki stałe'],
      ['pending_diagnosis', 'Oczekuje na diagnozę'], ['disability_congenital', 'Niepełnospr. wrodzona'],
      ['smoker', 'Palacz']
    ];
    if (healthFields.some(([key]) => c[key] !== undefined && c[key] !== null)) {
      html += `<div class="client-detail-section"><h4>🔍 Przesiew zdrowotny</h4>`;
      healthFields.forEach(([key, label]) => {
        const val = c[key];
        if (val === undefined || val === null) return;
        html += `<div class="detail-row"><span>${label}</span><strong style="color:${val ? 'var(--red-600)' : 'var(--green-600)'};">${val ? '⚠️ Tak' : '✓ Nie'}</strong></div>`;
      });
      html += `</div>`;
    }

    // Zdarzenia medyczne (ostatnie 2 lata)
    const eventFields = [
      ['event_hospitalization', 'Hospitalizacja'], ['event_sick_leave_30', 'L4 > 30 dni'],
      ['event_further_diagnosis', 'Dalsza diagnostyka']
    ];
    if (eventFields.some(([key]) => c[key])) {
      html += `<div class="client-detail-section"><h4>🏥 Zdarzenia medyczne (2 lata)</h4>`;
      eventFields.forEach(([key, label]) => {
        const val = c[key];
        html += `<div class="detail-row"><span>${label}</span><strong style="color:${val ? 'var(--red-600)' : 'var(--green-600)'};">${val ? '⚠️ Tak' : '✓ Nie'}</strong></div>`;
      });
      html += `</div>`;
    }

    // Sporty / ryzyka
    const activeRisks = riskFields.filter(([key]) => c[key]);
    html += `<div class="client-detail-section"><h4>⚡ Sporty / ryzyka (${activeRisks.length})</h4>`;
    if (activeRisks.length === 0) {
      html += `<p style="font-size:0.8rem;color:var(--green-600);font-weight:600;">Brak deklarowanych sportów ryzykownych</p>`;
    } else {
      html += `<div style="display:flex;flex-wrap:wrap;gap:0.35rem;">`;
      activeRisks.forEach(([, label]) => {
        html += `<span style="font-size:0.7rem;font-weight:600;background:var(--amber-50);color:var(--amber-600);padding:0.2rem 0.5rem;border-radius:4px;border:1px solid #fde68a;">${label}</span>`;
      });
      html += `</div>`;
    }
    html += `</div>`;

    // Zgody
    if (c.exclusions_accepted !== undefined || c.informed_accepted !== undefined) {
      html += `<div class="client-detail-section"><h4>✅ Zgody</h4>
        <div class="detail-row"><span>Wyłączenia zaakceptowane</span><strong style="color:${c.exclusions_accepted ? 'var(--green-600)' : 'var(--red-600)'};">${c.exclusions_accepted ? '✓ Tak' : '✗ Nie'}</strong></div>
        <div class="detail-row"><span>Poinformowany</span><strong style="color:${c.informed_accepted ? 'var(--green-600)' : 'var(--red-600)'};">${c.informed_accepted ? '✓ Tak' : '✗ Nie'}</strong></div>
      </div>`;
    }

    html += `</div>`;

    html += `<div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--slate-200);display:flex;gap:0.5rem;">
      <button class="btn btn-primary btn-sm" onclick="Admin.createOfferForClient('${c.id}')">📊 Utwórz ofertę dla tego klienta</button>
    </div>`;

    body.innerHTML = html;
    document.getElementById('clientDetailTitle').textContent = c.full_name || 'Klient';
    document.getElementById('clientDetailModal').classList.remove('hidden');
  },

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

  // ---- USER ACTIONS ----
  async toggleActive(id, active) {
    try { await Store.updateUserProfile(id, { active: !active }); App.toast(active ? 'Zablokowany' : 'Odblokowany', 'success'); Admin.loadUsers(); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  async toggleRole(id, role) {
    const nr = role === 'admin' ? 'user' : 'admin';
    try { await Store.updateUserProfile(id, { role: nr }); App.toast(`Rola: ${nr}`, 'success'); Admin.loadUsers(); }
    catch (e) { App.toast(e.message, 'error'); }
  },

  // ---- REF HELPERS ----
  copyRef(refId) {
    const domain = document.getElementById('refLinkDomain')?.value || 'utratadochodu.pl';
    const link = `${domain}/?ref=${refId}`;
    navigator.clipboard.writeText(link).then(() => {
      App.toast(`Link skopiowany: ${link}`, 'success');
    }).catch(() => { prompt('Link referencyjny:', link); });
  },

  copyRefLink() {
    const output = document.getElementById('refLinkOutput');
    if (!output) return;
    navigator.clipboard.writeText(output.value).then(() => {
      const btn = output.nextElementSibling;
      if (btn) { btn.textContent = '✅ Skopiowano!'; setTimeout(() => btn.textContent = '📋 Kopiuj', 1500); }
    });
  },

  populateRefUserDropdown(users) {
    const select = document.getElementById('refLinkUser');
    if (!select) return;
    select.innerHTML = users
      .filter(u => u.ref_id)
      .map(u => `<option value="${u.ref_id}">${escHtml(u.full_name || u.id.substring(0, 8))} (${u.ref_id})</option>`)
      .join('');
    const refDomain = document.getElementById('refLinkDomain');
    const refOutput = document.getElementById('refLinkOutput');
    if (refDomain && refOutput) {
      refOutput.value = refDomain.value + '/?ref=' + (select.value || '0000');
    }
  },

  generateRefId() {
    const role = document.getElementById('newUserRole')?.value;
    const leaderId = document.getElementById('newUserLeader')?.value;
    const refInput = document.getElementById('newUserRefId');
    if (!refInput) return;
    if (role === 'leader' || role === 'admin' || !leaderId) {
      refInput.value = String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');
    } else {
      refInput.value = leaderId + '.' + String(Math.floor(Math.random() * 90) + 10);
    }
  },

  // ---- PLACEHOLDER TABS ----
  loadStats() {
    const noData = document.getElementById('statsChartNoData');
    if (noData) noData.style.display = 'block';
  },

  loadRefLinks() {
    if (Store.dbUsers && Store.dbUsers.length > 0) {
      Admin.populateRefUserDropdown(Store.dbUsers);
    }
  },
  
  // ---- NOWY USER MODAL ----
    openNewUserModal(preLeaderId, preLeaderRefId) {
    // Wypelnij dropdown liderow
    const leaderSel = document.getElementById('newUserLeader');
    if (leaderSel && Store.dbUsers) {
      leaderSel.innerHTML = '<option value="">— brak lidera (samodzielny) —</option>' +
        Store.dbUsers
          .filter(u => u.role === 'leader' || u.role === 'admin')
          .map(u => `<option value="${u.id}">${escHtml(u.full_name)} (${u.ref_id || '—'})</option>`)
          .join('');
    }
          // Pre-wypelnij lidera jesli przekazano z przycisku DODAJ SUBUSER
    if (preLeaderId && leaderSel) {
      leaderSel.value = preLeaderId;
      const roleEl2 = document.getElementById('newUserRole');
      if (roleEl2) roleEl2.value = 'user';
      Admin.generateRefId();
    }
    // Reset pol
    ['newUserName','newUserEmail','newUserPassword','newUserRefId']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const roleEl = document.getElementById('newUserRole');
    if (roleEl) roleEl.value = 'user';
    document.getElementById('newUserModal')?.classList.remove('hidden');
  },

  async submitNewUser() {
    const full_name = document.getElementById('newUserName')?.value?.trim();
    const email    = document.getElementById('newUserEmail')?.value?.trim();
    const password = document.getElementById('newUserPassword')?.value?.trim();
    const role     = document.getElementById('newUserRole')?.value || 'user';
    const leader_id = document.getElementById('newUserLeader')?.value || null;
    const affiliate_code = document.getElementById('newUserRefId')?.value?.trim() || null;

    if (!full_name || !email || !password) {
      App.toast('Uzupelnij wszystkie wymagane pola', 'error'); return;
    }
    if (password.length < 6) {
      App.toast('Haslo musi miec min. 6 znakow', 'error'); return;
    }

    const btn = document.getElementById('newUserSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Tworzenie...'; }

    try {
      await Store.createUser({ email, password, full_name, role, leader_id, affiliate_code });
      App.toast(`Uzytkownik ${full_name} utworzony!`, 'success');
      document.getElementById('newUserModal')?.classList.add('hidden');
      Admin.loadUsers();
    } catch (e) {
      App.toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Utwórz użytkownika'; }
    }
  },
};
