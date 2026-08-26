/**
 * matrix.js — Matrix rendering with variants, wait periods, indemnity — v2.0
 */

const Matrix = {
  isClientView: false,

  render() {
    Store.ensureVariantConsistency();
    Matrix.renderVariantTabs();
    Matrix.renderHeader();
    Matrix.renderBody();
    Matrix.renderWaitPeriods();
    Scoring.update();
  },

  // --- Variant tabs ---
  renderVariantTabs() {
    const container = document.getElementById('variantTabs');
    if (!container) return;
    if (Matrix.isClientView && Store.state.variants.length <= 1) { container.innerHTML = ''; return; }

    const s = Store.state;
    let html = '';
    s.variants.forEach((v, i) => {
      const active = i === s.activeVariantIdx;
      html += `<button class="variant-tab${active ? ' active' : ''}" onclick="Matrix.switchVariant(${i})">
        ${escHtml(v.label)}${!Matrix.isClientView && s.variants.length > 1 ? `<span class="variant-tab-remove" onclick="event.stopPropagation(); Matrix.removeVariant(${i})">✕</span>` : ''}
      </button>`;
    });
    if (!Matrix.isClientView) {
      html += `<button class="variant-tab variant-tab-add" onclick="Matrix.addVariant()">+ Wariant</button>`;
    }
    container.innerHTML = html;
  },

  switchVariant(idx) {
    Store.state.activeVariantIdx = idx;
    Matrix.render();
  },

  addVariant() {
    const num = Store.state.variants.length + 1;
    const newV = Store.createEmptyVariant(`Wariant ${num}`);
    // Copy insurers structure
    Store.state.risks.forEach(r => {
      newV.matrixData[r.id] = {};
      Store.state.insurers.forEach(tu => { newV.matrixData[r.id][tu.id] = { su: '' }; });
    });
    Store.state.insurers.forEach(tu => {
      newV.totals[tu.id] = '';
      newV.waitAccident[tu.id] = 14;
      newV.waitIllness[tu.id] = 21;
      newV.indemnity[tu.id] = 24;
    });
    Store.state.variants.push(newV);
    Store.state.activeVariantIdx = Store.state.variants.length - 1;
    Matrix.render();
  },

  removeVariant(idx) {
    if (Store.state.variants.length <= 1) return;
    Store.state.variants.splice(idx, 1);
    if (Store.state.activeVariantIdx >= Store.state.variants.length) {
      Store.state.activeVariantIdx = Store.state.variants.length - 1;
    }
    Matrix.render();
  },

  // --- Header ---
  renderHeader() {
    const thead = document.getElementById('matrixHeader');
    const s = Store.state;
    const v = Store.getActiveVariant();

    let html = `<th>Ryzyko</th><th style="width:70px;">Waga</th>`;
    s.insurers.forEach(tu => {
      const name = tu.short_name || tu.name;
      const premVal = v.totals[tu.id] || '';
      const premNum = parseNum(premVal);
      html += `<th style="min-width:140px;">`;
      html += `<span class="th-insurer-name" title="${escHtml(tu.name)}">${escHtml(name)}</span>`;
      if (Matrix.isClientView) {
        html += `<div style="margin-top:0.35rem;font-size:0.75rem;font-weight:700;color:var(--blue-700);">${premNum > 0 ? formatCurrency(premNum) + ' PLN/mies.' : '—'}</div>`;
      } else {
        html += `<div class="premium-cell"><input type="text" class="premium-cell-input" value="${premNum > 0 ? formatCurrency(premNum) : premVal}" oninput="Matrix.onPremiumInput('${tu.id}',this)" onblur="Matrix.onBlur(this)" placeholder="Składka"><span class="premium-cell-currency">PLN</span></div>`;
        html += `<button class="th-remove-insurer no-pdf" onclick="Matrix.removeInsurer('${tu.id}')" title="Usuń">✕</button>`;
      }
      html += `</th>`;
    });
    thead.innerHTML = html;
  },

  // --- Body ---
  renderBody() {
    const tbody = document.getElementById('matrixBody');
    const s = Store.state;
    const v = Store.getActiveVariant();

    if (s.risks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${s.insurers.length + 2}" style="text-align:center;padding:2rem;color:var(--slate-400);font-size:0.85rem;">Dodaj ryzyka i ubezpieczycieli, aby zbudować matrycę.</td></tr>`;
      return;
    }

    const grouped = {};
    s.risks.forEach(r => { const c = r.category || 'Inne'; if (!grouped[c]) grouped[c] = []; grouped[c].push(r); });
    const sortedCats = Object.keys(grouped).sort((a, b) => Store.getCategoryWeight(a) - Store.getCategoryWeight(b));

    let html = '';
    sortedCats.forEach(cat => {
      html += `<tr class="matrix-category-row"><td colspan="${s.insurers.length + 2}">📁 ${escHtml(cat)}</td></tr>`;
      grouped[cat].forEach(r => {
        const w = r.weight || 1;
        html += `<tr><td style="position:relative;"><span class="matrix-risk-name">${escHtml(r.name)}</span>`;
        if (!Matrix.isClientView) html += `<button class="matrix-remove-btn no-pdf" onclick="Matrix.removeRisk('${r.id}')">✕</button>`;
        html += `</td>`;

        // Weight
        if (Matrix.isClientView) {
          const wt = w === 3 ? '🔥 Kryt.' : w === 2 ? '⭐ Ważne' : '⚪ Dodat.';
          html += `<td style="text-align:center;"><span class="weight-badge">${wt}</span></td>`;
        } else {
          html += `<td style="text-align:center;"><select class="weight-select" onchange="Matrix.onWeightChange('${r.id}',this.value)">
            <option value="3" ${w===3?'selected':''}>🔥 Kryt.</option><option value="2" ${w===2?'selected':''}>⭐ Ważne</option><option value="1" ${w===1?'selected':''}>⚪ Dodat.</option></select></td>`;
        }

        // SU per insurer
        s.insurers.forEach(tu => {
          const d = v.matrixData[r.id]?.[tu.id] || { su: '' };
          const val = parseNum(d.su);
          const disp = val > 0 ? formatCurrency(val) : d.su;
          if (Matrix.isClientView) {
            html += `<td style="text-align:center;font-size:0.8rem;font-weight:600;">${val > 0 ? formatCurrency(val) + ' PLN' : (d.su || '—')}</td>`;
          } else {
            html += `<td><div class="su-cell"><span class="su-cell-label">SU</span><input type="text" class="su-cell-input" value="${disp}" oninput="Matrix.onSuInput('${r.id}','${tu.id}',this)" onblur="Matrix.onBlur(this)" placeholder="Kwota"><span class="su-cell-currency">PLN</span></div></td>`;
          }
        });
        html += `</tr>`;
      });
    });
    tbody.innerHTML = html;
  },

  // --- Wait periods & indemnity ---
  renderWaitPeriods() {
    const container = document.getElementById('waitPeriodsSection');
    if (!container) return;
    const s = Store.state;
    const v = Store.getActiveVariant();

    // Only show if there's a "niezdolność" risk
    const hasNiezdolnosc = s.risks.some(r => r.name.toLowerCase().includes('okresow'));
    if (!hasNiezdolnosc || s.insurers.length === 0) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');

    let html = '<div class="wait-grid">';
    s.insurers.forEach(tu => {
      const name = tu.short_name || tu.name;
      const isLH = name.toLowerCase().includes('leadenhall');
      const indemnityOptions = isLH ? INDEMNITY_LEADENHALL : INDEMNITY_CEU;
      const wa = v.waitAccident[tu.id] || 14;
      const wi = v.waitIllness[tu.id] || 21;
      const ind = v.indemnity[tu.id] || 24;

      html += `<div class="wait-card">
        <div class="wait-card-title">${escHtml(name)}</div>
        <div class="wait-card-row"><label>Karencja wypadek:</label>`;
      if (Matrix.isClientView) {
        html += `<span class="wait-val">${wa} dni</span>`;
      } else {
        html += `<select class="wait-select" onchange="Matrix.onWaitChange('${tu.id}','waitAccident',this.value)">`;
        WAIT_ACCIDENT.forEach(d => { html += `<option value="${d}" ${wa===d?'selected':''}>${d} dni</option>`; });
        html += `</select>`;
      }
      html += `</div><div class="wait-card-row"><label>Karencja choroba:</label>`;
      if (Matrix.isClientView) {
        html += `<span class="wait-val">${wi} dni</span>`;
      } else {
        html += `<select class="wait-select" onchange="Matrix.onWaitChange('${tu.id}','waitIllness',this.value)">`;
        WAIT_ILLNESS.forEach(d => { html += `<option value="${d}" ${wi===d?'selected':''}>${d} dni</option>`; });
        html += `</select>`;
      }
      html += `</div><div class="wait-card-row"><label>Okres odszkod.:</label>`;
      if (Matrix.isClientView) {
        html += `<span class="wait-val">${ind} mies.</span>`;
      } else {
        html += `<select class="wait-select" onchange="Matrix.onIndemnityChange('${tu.id}',this.value)">`;
        indemnityOptions.forEach(m => { html += `<option value="${m}" ${ind===m?'selected':''}>${m} mies.</option>`; });
        html += `</select>`;
      }
      html += `</div></div>`;
    });
    html += '</div>';
    container.innerHTML = `<div class="card-title" style="margin-bottom:0.75rem;">⏱️ Okresy wyczekiwania i odszkodowawcze</div>` + html;
  },

  // --- Events ---
  onSuInput(riskId, insurerId, el) {
    const v = Store.getActiveVariant();
    v.matrixData[riskId][insurerId].su = el.value;
    Scoring.update();
  },
  onBlur(el) { const val = parseNum(el.value); if (val > 0) el.value = formatCurrency(val); },
  onPremiumInput(insurerId, el) { Store.getActiveVariant().totals[insurerId] = el.value; Scoring.update(); },
  onWeightChange(riskId, val) { const r = Store.state.risks.find(x => x.id === riskId); if (r) { r.weight = parseInt(val); Scoring.update(); } },
  onWaitChange(insurerId, field, val) { Store.getActiveVariant()[field][insurerId] = parseInt(val); },
  onIndemnityChange(insurerId, val) { Store.getActiveVariant().indemnity[insurerId] = parseInt(val); },

  removeRisk(riskId) {
    Store.state.risks = Store.state.risks.filter(r => r.id !== riskId);
    Store.state.variants.forEach(v => delete v.matrixData[riskId]);
    Matrix.render();
  },
  removeInsurer(insurerId) {
    Store.state.insurers = Store.state.insurers.filter(t => t.id !== insurerId);
    Store.state.variants.forEach(v => {
      delete v.totals[insurerId]; delete v.waitAccident[insurerId]; delete v.waitIllness[insurerId]; delete v.indemnity[insurerId];
      Object.keys(v.matrixData).forEach(rId => delete v.matrixData[rId][insurerId]);
    });
    Matrix.render();
  },

  addRisk(riskId) {
    const r = Store.dbRisks.find(x => x.id === riskId);
    if (!r || Store.state.risks.some(x => x.id === riskId)) return;
    Store.state.risks.push({ ...r, weight: 1 });
    Matrix.render();
    Matrix.renderRiskPicker();
  },
  addInsurer(insurerId) {
    const tu = Store.dbInsurers.find(x => x.id === insurerId);
    if (!tu || Store.state.insurers.some(x => x.id === insurerId)) return;
    Store.state.insurers.push({ ...tu });
    Matrix.render();
    Matrix.renderInsurerPicker();
  },

  // --- Pickers ---
  renderRiskPicker() {
    const container = document.getElementById('riskPickerBody');
    if (Store.dbRisks.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--red-500);font-weight:700;padding:1rem;">Brak ryzyk w bazie.</p>'; return; }
    const grouped = {};
    Store.dbRisks.forEach(r => { const c = r.category || 'Inne'; if (!grouped[c]) grouped[c] = []; grouped[c].push(r); });
    let html = '';
    Object.keys(grouped).sort((a, b) => Store.getCategoryWeight(a) - Store.getCategoryWeight(b)).forEach(cat => {
      html += `<div class="picker-category-header">${escHtml(cat)}</div>`;
      grouped[cat].forEach(r => {
        const added = Store.state.risks.some(x => x.id === r.id);
        html += added
          ? `<div class="picker-item" style="opacity:0.5;cursor:default;"><span class="picker-item-name">${escHtml(r.name)}</span><span class="picker-item-added">Dodano</span></div>`
          : `<div class="picker-item" onclick="Matrix.addRisk('${r.id}')"><span class="picker-item-name">${escHtml(r.name)}</span><button class="btn btn-primary btn-sm">Dodaj</button></div>`;
      });
    });
    container.innerHTML = html;
  },

  renderInsurerPicker() {
    const container = document.getElementById('insurerPickerBody');
    if (Store.dbInsurers.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--red-500);font-weight:700;padding:1rem;">Brak TU w bazie.</p>'; return; }
    let html = '';
    Store.dbInsurers.forEach(tu => {
      const name = tu.short_name || tu.name;
      const added = Store.state.insurers.some(x => x.id === tu.id);
      html += added
        ? `<div class="picker-item" style="opacity:0.5;cursor:default;"><span class="picker-item-name" style="font-weight:700;">${escHtml(name)}</span><span class="picker-item-added">Dodano</span></div>`
        : `<div class="picker-item" onclick="Matrix.addInsurer('${tu.id}')"><span class="picker-item-name" style="font-weight:700;">${escHtml(name)}</span><button class="btn btn-primary btn-sm">Wybierz</button></div>`;
    });
    container.innerHTML = html;
  },
};
