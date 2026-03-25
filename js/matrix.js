/**
 * matrix.js — Matrix rendering, risk/insurer pickers
 */

const Matrix = {
  isClientView: false,

  render() {
    Store.ensureMatrixConsistency();
    Matrix.renderHeader();
    Matrix.renderBody();
    Scoring.update();
  },

  renderHeader() {
    const thead = document.getElementById('matrixHeader');
    const s = Store.state;

    let html = `<th>Ryzyko</th>`;
    html += `<th style="width:80px;">Waga</th>`;

    s.insurers.forEach(tu => {
      const displayName = tu.short_name || tu.name;
      const premVal = s.totals[tu.id] || '';
      const premNum = parseNum(premVal);
      const premDisplay = premNum > 0 ? formatCurrency(premNum) : premVal;

      html += `<th style="min-width:130px;">`;
      html += `<span class="th-insurer-name" title="${tu.name}">${displayName}</span>`;

      if (Matrix.isClientView) {
        const premText = premNum > 0 ? `${formatCurrency(premNum)} PLN` : '—';
        html += `<div style="margin-top:0.4rem; font-size:0.75rem; font-weight:700; color:var(--blue-700);">${premText}</div>`;
      } else {
        html += `<div class="premium-cell">
          <input type="text" class="premium-cell-input" value="${premDisplay}" 
            oninput="Matrix.onPremiumInput('${tu.id}', this)"
            onblur="Matrix.onPremiumBlur(this)"
            placeholder="Składka">
          <span class="premium-cell-currency">PLN</span>
        </div>`;
        html += `<button class="th-remove-insurer no-pdf" onclick="Matrix.removeInsurer('${tu.id}')" title="Usuń">✕</button>`;
      }
      html += `</th>`;
    });

    thead.innerHTML = html;
  },

  renderBody() {
    const tbody = document.getElementById('matrixBody');
    const s = Store.state;

    if (s.risks.length === 0) {
      const colSpan = s.insurers.length + 2;
      tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding:2.5rem; color:var(--slate-400); font-size:0.85rem;">
        Brak ryzyk. Kliknij <strong>+ Ryzyko</strong> aby dodać świadczenia do porównania.
      </td></tr>`;
      return;
    }

    // Group by category
    const grouped = {};
    s.risks.forEach(r => {
      const cat = r.category || 'Inne';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(r);
    });

    const sortedCats = Object.keys(grouped).sort(
      (a, b) => Store.getCategoryWeight(a) - Store.getCategoryWeight(b)
    );

    let html = '';
    sortedCats.forEach(cat => {
      const items = grouped[cat];
      const colSpan = s.insurers.length + 2;
      html += `<tr class="matrix-category-row"><td colspan="${colSpan}">📁 ${cat}</td></tr>`;

      items.forEach(r => {
        const w = r.weight || 1;

        html += `<tr>`;
        // Risk name
        html += `<td style="position:relative;">
          <span class="matrix-risk-name">${r.name}</span>
          ${!Matrix.isClientView ? `<button class="matrix-remove-btn no-pdf" onclick="Matrix.removeRisk('${r.id}')" title="Usuń ryzyko">✕</button>` : ''}
        </td>`;

        // Weight
        if (Matrix.isClientView) {
          const wTxt = w === 3 ? '🔥 Kryt.' : w === 2 ? '⭐ Ważne' : '⚪ Dodat.';
          html += `<td style="text-align:center;"><span style="font-size:0.65rem; font-weight:700; color:var(--slate-600); background:var(--slate-100); padding:0.2rem 0.5rem; border-radius:4px; border:1px solid var(--slate-200);">${wTxt}</span></td>`;
        } else {
          html += `<td style="text-align:center;">
            <select class="weight-select" onchange="Matrix.onWeightChange('${r.id}', this.value)">
              <option value="3" ${w === 3 ? 'selected' : ''}>🔥 Kryt.</option>
              <option value="2" ${w === 2 ? 'selected' : ''}>⭐ Ważne</option>
              <option value="1" ${w === 1 ? 'selected' : ''}>⚪ Dodat.</option>
            </select>
          </td>`;
        }

        // SU cells per insurer
        s.insurers.forEach(tu => {
          const data = s.matrixData[r.id]?.[tu.id] || { su: '' };
          const rawSu = data.su || '';
          const parsedSu = parseNum(rawSu);
          const displaySu = parsedSu > 0 ? formatCurrency(parsedSu) : rawSu;

          if (Matrix.isClientView) {
            const clientDisplay = parsedSu > 0 ? `${formatCurrency(parsedSu)} PLN` : (rawSu || '—');
            html += `<td style="text-align:center; font-size:0.8rem; font-weight:600; color:var(--slate-700);">${clientDisplay}</td>`;
          } else {
            html += `<td>
              <div class="su-cell">
                <span class="su-cell-label">SU</span>
                <input type="text" class="su-cell-input" value="${displaySu}"
                  oninput="Matrix.onSuInput('${r.id}', '${tu.id}', this)"
                  onblur="Matrix.onSuBlur(this)"
                  placeholder="Kwota">
                <span class="su-cell-currency">PLN</span>
              </div>
            </td>`;
          }
        });

        html += `</tr>`;
      });
    });

    tbody.innerHTML = html;
  },

  // Events
  onSuInput(riskId, insurerId, el) {
    Store.state.matrixData[riskId][insurerId].su = el.value;
    Scoring.update();
  },

  onSuBlur(el) {
    const val = parseNum(el.value);
    if (val > 0) el.value = formatCurrency(val);
  },

  onPremiumInput(insurerId, el) {
    Store.state.totals[insurerId] = el.value;
    Scoring.update();
  },

  onPremiumBlur(el) {
    const val = parseNum(el.value);
    if (val > 0) el.value = formatCurrency(val);
  },

  onWeightChange(riskId, val) {
    const r = Store.state.risks.find(x => x.id === riskId);
    if (r) {
      r.weight = parseInt(val);
      Scoring.update();
    }
  },

  removeRisk(riskId) {
    Store.state.risks = Store.state.risks.filter(r => r.id !== riskId);
    delete Store.state.matrixData[riskId];
    Matrix.render();
  },

  removeInsurer(insurerId) {
    Store.state.insurers = Store.state.insurers.filter(t => t.id !== insurerId);
    delete Store.state.totals[insurerId];
    // Clean matrix data
    Object.keys(Store.state.matrixData).forEach(rId => {
      delete Store.state.matrixData[rId][insurerId];
    });
    Matrix.render();
  },

  // Add risk from DB
  addRisk(riskId) {
    const r = Store.dbRisks.find(x => x.id === riskId);
    if (!r || Store.state.risks.some(x => x.id === riskId)) return;
    Store.state.risks.push({ ...r, weight: 1 });
    Matrix.render();
    Matrix.renderRiskPicker(); // Update picker UI
  },

  // Add insurer from DB
  addInsurer(insurerId) {
    const tu = Store.dbInsurers.find(x => x.id === insurerId);
    if (!tu || Store.state.insurers.some(x => x.id === insurerId)) return;
    Store.state.insurers.push({ ...tu });
    Matrix.render();
    Matrix.renderInsurerPicker(); // Update picker UI
  },

  // Pickers
  renderRiskPicker() {
    const container = document.getElementById('riskPickerBody');
    const risks = Store.dbRisks;

    if (risks.length === 0) {
      container.innerHTML = '<p style="text-align:center; color:var(--red-500); font-weight:700; padding:1rem;">Brak ryzyk w bazie.</p>';
      return;
    }

    const grouped = {};
    risks.forEach(r => {
      const cat = r.category || 'Inne';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(r);
    });

    const sortedCats = Object.keys(grouped).sort(
      (a, b) => Store.getCategoryWeight(a) - Store.getCategoryWeight(b)
    );

    let html = '';
    sortedCats.forEach(cat => {
      html += `<div class="picker-category-header">${cat}</div>`;
      grouped[cat].forEach(r => {
        const isAdded = Store.state.risks.some(x => x.id === r.id);
        if (isAdded) {
          html += `<div class="picker-item" style="opacity:0.5; cursor:default;">
            <span class="picker-item-name">${r.name}</span>
            <span class="picker-item-added">Dodano</span>
          </div>`;
        } else {
          html += `<div class="picker-item" onclick="Matrix.addRisk('${r.id}')">
            <span class="picker-item-name">${r.name}</span>
            <button class="btn btn-primary btn-sm">Dodaj</button>
          </div>`;
        }
      });
    });

    container.innerHTML = html;
  },

  renderInsurerPicker() {
    const container = document.getElementById('insurerPickerBody');
    const insurers = Store.dbInsurers;

    if (insurers.length === 0) {
      container.innerHTML = '<p style="text-align:center; color:var(--red-500); font-weight:700; padding:1rem;">Brak ubezpieczycieli w bazie.</p>';
      return;
    }

    let html = '';
    insurers.forEach(tu => {
      const displayName = tu.short_name || tu.name;
      const isAdded = Store.state.insurers.some(x => x.id === tu.id);
      if (isAdded) {
        html += `<div class="picker-item" style="opacity:0.5; cursor:default;">
          <span class="picker-item-name" style="font-weight:700;">${displayName}</span>
          <span class="picker-item-added">Dodano</span>
        </div>`;
      } else {
        html += `<div class="picker-item" onclick="Matrix.addInsurer('${tu.id}')">
          <span class="picker-item-name" style="font-weight:700;">${displayName}</span>
          <button class="btn btn-primary btn-sm">Wybierz</button>
        </div>`;
      }
    });

    container.innerHTML = html;
  },
};
