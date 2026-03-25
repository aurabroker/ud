/**
 * admin.js — Admin panel: user management
 */

const Admin = {
  async loadUsers() {
    const tbody = document.getElementById('adminUsersList');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem;"><div class="spinner"></div></td></tr>`;

    try {
      const users = await Store.loadUsers();

      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--slate-400);">Brak użytkowników</td></tr>`;
        return;
      }

      let html = '';
      users.forEach(u => {
        const isCurrentUser = u.id === Auth.currentUser?.id;
        const roleBadge = u.role === 'admin'
          ? '<span class="admin-role-badge admin">Admin</span>'
          : '<span class="admin-role-badge user">User</span>';
        const statusDot = u.active !== false
          ? '<span class="admin-status-dot active"></span>Aktywny'
          : '<span class="admin-status-dot inactive"></span>Zablokowany';

        html += `<tr>
          <td class="admin-user-email">${u.id === Auth.currentUser?.id ? u.id.substring(0, 8) + '... (Ty)' : u.id.substring(0, 8) + '...'}</td>
          <td>${u.full_name || '—'}</td>
          <td>${roleBadge}</td>
          <td style="font-size:0.75rem;">${statusDot}</td>
          <td>
            ${!isCurrentUser ? `
              <div style="display:flex; gap:0.25rem;">
                <button class="btn btn-ghost btn-sm" onclick="Admin.toggleUserActive('${u.id}', ${u.active !== false})" title="${u.active !== false ? 'Zablokuj' : 'Odblokuj'}">
                  ${u.active !== false ? '🔒' : '🔓'}
                </button>
                <button class="btn btn-ghost btn-sm" onclick="Admin.toggleUserRole('${u.id}', '${u.role}')" title="Zmień rolę">
                  ${u.role === 'admin' ? '👤' : '👑'}
                </button>
              </div>
            ` : '<span style="font-size:0.65rem; color:var(--slate-400);">—</span>'}
          </td>
        </tr>`;
      });

      tbody.innerHTML = html;
    } catch (err) {
      console.error('Error loading users:', err);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--red-500);">Błąd: ${err.message}</td></tr>`;
    }
  },

  async toggleUserActive(userId, currentlyActive) {
    try {
      await Store.updateUserProfile(userId, { active: !currentlyActive });
      App.toast(currentlyActive ? 'Użytkownik zablokowany' : 'Użytkownik odblokowany', 'success');
      await Admin.loadUsers();
    } catch (err) {
      App.toast('Błąd: ' + err.message, 'error');
    }
  },

  async toggleUserRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await Store.updateUserProfile(userId, { role: newRole });
      App.toast(`Rola zmieniona na ${newRole}`, 'success');
      await Admin.loadUsers();
    } catch (err) {
      App.toast('Błąd: ' + err.message, 'error');
    }
  },
};
