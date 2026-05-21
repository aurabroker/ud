/**
 * client.js — Client-facing view: greeting, exclusions modal, choice, PDF
 */

const ClientView = {
  offerData: null,

  renderGreeting() {
    const el = document.getElementById('clientGreeting');
    if (!el) return;
    const name = Store.state.clientName || '';
    const firstName = name.split(/\s+/)[0] || '';
    if (firstName) {
      el.innerHTML = `<p style="font-size:1rem;color:var(--slate-700);margin-bottom:0.5rem;">Szanowny/a Panie/Pani <strong>${escHtml(firstName)}</strong>,</p>
        <p style="font-size:0.85rem;color:var(--slate-500);">poniżej porównanie ofert ubezpieczenia utraty dochodu przygotowane specjalnie dla Ciebie.</p>`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  },

  renderClientParams() {
    const el = document.getElementById('clientParamsSection');
    if (!el) return;
    const p = Store.state.clientProfile;
    if (!p) { el.classList.add('hidden'); return; }

    const hasRisks = p.risk_death_invalidity || p.risk_temp_incapacity || p.risk_perm_incapacity || p.nw_death_sum;
    const nwList = [
      ['nw_funeral', 'Zasiłek pogrzebowy', 'zł'],
      ['nw_adaptation', 'Adaptacja mieszkania', 'zł'],
      ['nw_hospital_daily', 'Dzienna szpitalna', 'zł/dzień'],
      ['nw_medical_costs', 'Koszty leczenia', 'zł'],
      ['nw_unconscious_weekly', 'Tygodniowa nieprzytomność', 'zł/tydz.'],
      ['nw_permanent_damage', 'Trwały uszczerbek', null],
    ];
    const activeNw = nwList.filter(([key]) => p[key]);

    if (!hasRisks && activeNw.length === 0) { el.classList.add('hidden'); return; }

    let html = `<div class="card" style="margin-bottom:1rem;">
      <div class="card-header"><div class="card-title">📋 Parametry oferty</div></div>
      <div class="card-body-padded">`;

    if (p.employment_type || p.profession) {
      html += `<p style="font-size:0.8rem;color:var(--slate-500);margin-bottom:0.75rem;">`;
      if (p.employment_type) html += escHtml(p.employment_type);
      if (p.profession) html += `${p.employment_type ? ' · ' : ''}${escHtml(p.profession)}`;
      html += `</p>`;
    }

    if (hasRisks) {
      html += `<div style="margin-bottom:0.75rem;">
        <div style="font-size:0.72rem;font-weight:700;color:var(--slate-400);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem;">Wybrane ryzyka</div>`;
      if (p.risk_death_invalidity)
        html += `<div class="detail-row"><span>Śmierć / inwalidztwo</span><strong style="color:var(--blue-600);">✓</strong></div>`;
      if (p.risk_temp_incapacity)
        html += `<div class="detail-row"><span>Przejściowa niezdolność do pracy</span><strong style="color:var(--blue-600);">${p.temp_incapacity_sum ? formatCurrency(p.temp_incapacity_sum) + ' zł/mies.' : '✓'}</strong></div>`;
      if (p.risk_perm_incapacity)
        html += `<div class="detail-row"><span>Trwała niezdolność do pracy</span><strong style="color:var(--blue-600);">${p.perm_incapacity_sum ? formatCurrency(p.perm_incapacity_sum) + ' zł' : '✓'}</strong></div>`;
      if (p.nw_death_sum)
        html += `<div class="detail-row"><span>Suma NW (śmierć)</span><strong>${formatCurrency(p.nw_death_sum)} zł</strong></div>`;
      html += `</div>`;
    }

    if (activeNw.length > 0) {
      html += `<div>
        <div style="font-size:0.72rem;font-weight:700;color:var(--slate-400);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.4rem;">Klauzule NW</div>`;
      activeNw.forEach(([key, label, unit]) => {
        const val = p[key];
        const valueStr = (unit && val && typeof val === 'string') ? `${formatCurrency(val)} ${unit}` : '✓';
        html += `<div class="detail-row"><span>${label}</span><strong style="color:var(--blue-600);">${valueStr}</strong></div>`;
      });
      html += `</div>`;
    }

    html += `</div></div>`;
    el.innerHTML = html;
    el.classList.remove('hidden');
  },

  renderExclusions() {
    const el = document.getElementById('clientExclusionsSection');
    if (!el) return;
    el.innerHTML = `<div class="card" style="margin-top:1.25rem;">
      <div class="card-header"><div class="card-title" style="color:var(--red-700);">⚠️ Ważne wyłączenia odpowiedzialności</div></div>
      <div class="card-body-padded" style="font-size:0.8rem;color:var(--slate-600);line-height:1.7;">${EXCLUSIONS_TEXT}</div>
    </div>`;
    el.classList.remove('hidden');
  },

  chooseOffer(insurerId, insurerName) {
    // Open exclusions acceptance modal
    const modal = document.getElementById('exclusionsAcceptModal');
    const body = document.getElementById('exclusionsModalBody');
    const acceptBtn = document.getElementById('exclusionsAcceptBtn');
    const checkbox = document.getElementById('exclusionsCheckbox');

    body.innerHTML = EXCLUSIONS_TEXT;
    checkbox.checked = false;
    acceptBtn.disabled = true;
    acceptBtn.dataset.insurerId = insurerId;
    acceptBtn.dataset.insurerName = insurerName;

    // Enable accept button only after scrolling to bottom
    const scrollContainer = body;
    const checkScroll = () => {
      const atBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 30;
      if (atBottom) {
        document.getElementById('exclusionsScrollHint').classList.add('hidden');
        document.getElementById('exclusionsCheckboxArea').classList.remove('hidden');
      }
    };
    scrollContainer.addEventListener('scroll', checkScroll);
    // If content fits without scroll, show checkbox immediately
    setTimeout(() => {
      if (scrollContainer.scrollHeight <= scrollContainer.clientHeight + 30) {
        document.getElementById('exclusionsScrollHint').classList.add('hidden');
        document.getElementById('exclusionsCheckboxArea').classList.remove('hidden');
      }
    }, 100);

    checkbox.onchange = () => { acceptBtn.disabled = !checkbox.checked; };
    modal.classList.remove('hidden');
  },

  async confirmChoice() {
    const btn = document.getElementById('exclusionsAcceptBtn');
    const insurerId = btn.dataset.insurerId;
    const insurerName = btn.dataset.insurerName;
    const variantId = Store.getActiveVariant().id;

    btn.disabled = true;
    btn.textContent = 'Zapisuję...';

    const choice = {
      insurer_id: insurerId,
      insurer_name: insurerName,
      variant_id: variantId,
      chosen_at: new Date().toISOString(),
      exclusions_accepted: true,
      exclusions_accepted_at: new Date().toISOString(),
    };

    try {
      await Store.saveClientChoice(Store.state.offerId, choice);
      Store.state.clientChoice = choice;
      App.closeModal('exclusionsAcceptModal');
      Scoring.update();
      App.toast('Wybór zapisany. Dziękujemy.', 'success');

      // Trigger email via Edge Function
      try {
        await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/send-offer-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ offer_id: Store.state.offerId, choice }),
        });
      } catch (emailErr) {
        console.warn('Email function not available:', emailErr);
      }
    } catch (err) {
      App.toast('Błąd zapisu: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Potwierdzam wybór';
    }
  },
};
