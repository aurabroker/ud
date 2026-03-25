/**
 * admin.js — Admin panel: users + clients — v2.1
 */

const Admin = {
  activeTab: 'users',

  switchTab(tab) {
    Admin.activeTab = tab;
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.getElementById('adminUsersSection').classList.toggle('hidden', tab !== 'users');
    document.getElementById('adminClientsSection').classList.toggle('hidden', tab !== 'clients');
    if (tab === 'users') Admin.loadUsers();
    else Admin.loadClients();
  },

  // ---- USERS ----
  async loadUsers() {
    const tbody = document.getElementById('adminUsersList');
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;"><div class="spinner"></div></td></tr>`;
    try {
      const users = await Store.loadUsers();
      if (users.length === 0) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--slate-400);">Brak użytkowników</td></tr>`; return; }
      let html = '';
      users.forEach(u => {
        const isCurrent = u.id === Auth.currentUser?.id;
        const role = u.role === 'admin' ? '<span class="admin-role-badge admin">Admin</span>' : '<span class="admin-role-badge user">User</span>';
        const status = u.active !== false ? '<span class="admin-status-dot active"></span>Aktywny' : '<span class="admin-status-dot inactive"></span>Zablokowany';
        html += `<tr>
          <td class="admin-user-email">${escHtml(u.full_name || u.id.substring(0,8))}${isCurrent ? ' (Ty)' : ''}</td>
          <td>${role}</td>
          <td style="font-size:0.75rem;">${status}</td>
          <td>${!isCurrent ? `<div style="display:flex;gap:0.25rem;">
            <button class="btn btn-ghost btn-sm" onclick="Admin.toggleActive('${u.id}',${u.active!==false})">${u.active!==false?'🔒':'🔓'}</button>
            <button class="btn btn-ghost btn-sm" onclick="Admin.toggleRole('${u.id}','${u.role}')">${u.role==='admin'?'👤':'👑'}</button>
          </div>` : '—'}</td></tr>`;
      });
      tbody.innerHTML = html;
    } catch (err) { tbody.innerHTML = `<tr><td colspan="4" style="color:var(--red-500);text-align:center;padding:1rem;">${err.message}</td></tr>`; }
  },

  // ---- CLIENTS ----
  async loadClients() {
    const tbody = document.getElementById('adminClientsList');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;"><div class="spinner"></div></td></tr>`;
    try {
      const clients = await Store.loadClients();
      if (clients.length === 0) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--slate-400);">Brak klientów z formularza</td></tr>`; return; }
      let html = '';
      clients.forEach(c => {
        const date = new Date(c.created_at).toLocaleString('pl-PL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
        
        // Medical flags
        const medFlags = [];
        if (c.med_heart) medFlags.push('❤️');
        if (c.med_diabetes) medFlags.push('💉');
        if (c.med_bones) medFlags.push('🦴');
        if (c.med_stomach) medFlags.push('🫁');
        if (c.med_neuro) medFlags.push('🧠');
        if (c.med_surgery) medFlags.push('🏥');
        if (c.med_aids) medFlags.push('⚠️');
        
        // Risk flags count
        const riskFields = ['risk_balloon','risk_sailing','risk_skiing','risk_skydiving','risk_diving','risk_caving','risk_aviation','risk_extreme_bike_boat','risk_climbing','risk_paragliding','risk_horse','risk_horse_jumping','risk_gravity_bike','risk_quad','risk_hunting'];
        const riskCount = riskFields.filter(f => c[f]).length;

        html += `<tr style="cursor:pointer;" onclick="Admin.showClientDetail('${c.id}')">
          <td style="font-weight:600;">${escHtml(c.full_name || '—')}</td>
          <td>${escHtml(c.email || '—')}</td>
          <td>${escHtml(c.phone || '—')}</td>
          <td>${escHtml(c.employment_type || '—')}</td>
          <td style="font-size:0.7rem;">${medFlags.length > 0 ? medFlags.join(' ') : '<span style="color:var(--green-500);">✓</span>'}</td>
          <td style="font-size:0.7rem;">${riskCount > 0 ? `<span style="color:var(--amber-500);font-weight:700;">${riskCount} sportów</span>` : '—'}</td>
          <td style="font-size:0.7rem;color:var(--slate-400);">${date}</td>
        </tr>`;
      });
      tbody.innerHTML = html;
    } catch (err) { tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red-500);text-align:center;padding:1rem;">${err.message}</td></tr>`; }
  },

  // ---- CLIENT DETAIL MODAL ----
  showClientDetail(clientId) {
    const c = Store.dbClients.find(x => x.id === clientId);
    if (!c) return;

    const body = document.getElementById('clientDetailBody');
    const riskFields = [
      ['risk_balloon', 'Baloniarstwo'], ['risk_sailing', 'Żeglarstwo'], ['risk_skiing', 'Narciarstwo'],
      ['risk_skydiving', 'Skoki spadochronowe'], ['risk_diving', 'Nurkowanie'], ['risk_caving', 'Speleologia'],
      ['risk_aviation', 'Lotnictwo amatorskie'], ['risk_extreme_bike_boat', 'Ekstr. rower/łódź'],
      ['risk_climbing', 'Wspinaczka'], ['risk_paragliding', 'Paralotniarstwo'], ['risk_horse', 'Jazda konna'],
      ['risk_horse_jumping', 'Skoki konne'], ['risk_gravity_bike', 'Gravity bike'], ['risk_quad', 'Quad/ATV'],
      ['risk_hunting', 'Polowanie']
    ];

    const medFields = [
      ['med_heart', 'Serce / nadciśnienie'], ['med_diabetes', 'Cukrzyca / nerki'],
      ['med_bones', 'Kręgosłup / stawy'], ['med_stomach', 'Żołądek / jelita'],
      ['med_neuro', 'Depresja / nerwica'], ['med_surgery', 'Operacje / leki stałe'],
      ['med_aids', 'AIDS / HIV']
    ];

    let html = `<div class="client-detail-grid">`;

    // Basic info
    html += `<div class="client-detail-section">
      <h4>📋 Dane podstawowe</h4>
      <div class="detail-row"><span>Imię i nazwisko</span><strong>${escHtml(c.full_name || '—')}</strong></div>
      <div class="detail-row"><span>Email</span><strong>${escHtml(c.email || '—')}</strong></div>
      <div class="detail-row"><span>Telefon</span><strong>${escHtml(c.phone || '—')}</strong></div>
      <div class="detail-row"><span>PESEL</span><strong>${escHtml(c.pesel || '—')}</strong></div>
      <div class="detail-row"><span>Forma zatrudnienia</span><strong>${escHtml(c.employment_type || '—')}</strong></div>
      <div class="detail-row"><span>Zawód</span><strong>${escHtml(c.profession || '—')}</strong></div>
    </div>`;

    // B2B
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
        <div class="detail-row"><span>Wkład własny</span><strong>${escHtml(c.b2b_own_contribution || '—')}</strong></div>
        ${c.b2b_description ? `<div class="detail-row full"><span>Opis czynności</span><div style="margin-top:0.25rem;font-size:0.8rem;color:var(--slate-600);">${escHtml(c.b2b_description)}</div></div>` : ''}
      </div>`;
    }

    // Medical
    html += `<div class="client-detail-section">
      <h4>🩺 Ankieta medyczna</h4>`;
    medFields.forEach(([key, label]) => {
      const val = c[key];
      html += `<div class="detail-row"><span>${label}</span><strong style="color:${val ? 'var(--red-600)' : 'var(--green-600)'};">${val ? '⚠️ Tak' : '✓ Nie'}</strong></div>`;
    });
    if (c.med_notes) {
      html += `<div class="detail-row full"><span>Notatki medyczne</span><div style="margin-top:0.25rem;font-size:0.8rem;color:var(--slate-600);background:var(--amber-50);padding:0.5rem;border-radius:4px;border:1px solid #fde68a;">${escHtml(c.med_notes)}</div></div>`;
    }
    html += `</div>`;

    // Sports/risks
    const activeRisks = riskFields.filter(([key]) => c[key]);
    html += `<div class="client-detail-section">
      <h4>⚡ Sporty / ryzyka (${activeRisks.length})</h4>`;
    if (activeRisks.length === 0) {
      html += `<p style="font-size:0.8rem;color:var(--green-600);font-weight:600;">Brak deklarowanych sportów ryzykownych</p>`;
    } else {
      html += `<div style="display:flex;flex-wrap:wrap;gap:0.35rem;">`;
      activeRisks.forEach(([key, label]) => {
        html += `<span style="font-size:0.7rem;font-weight:600;background:var(--amber-50);color:var(--amber-600);padding:0.2rem 0.5rem;border-radius:4px;border:1px solid #fde68a;">${label}</span>`;
      });
      html += `</div>`;
    }
    html += `</div>`;

    html += `</div>`;

    // Action: create offer for this client
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

  async toggleActive(id, active) {
    try { await Store.updateUserProfile(id, { active: !active }); App.toast(active ? 'Zablokowany' : 'Odblokowany', 'success'); Admin.loadUsers(); }
    catch (e) { App.toast(e.message, 'error'); }
  },
  async toggleRole(id, role) {
    const nr = role === 'admin' ? 'user' : 'admin';
    try { await Store.updateUserProfile(id, { role: nr }); App.toast(`Rola: ${nr}`, 'success'); Admin.loadUsers(); }
    catch (e) { App.toast(e.message, 'error'); }
  },
};
