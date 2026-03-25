/**
 * scoring.js — Recommendation scoring engine
 * Zakres (70%) + Składka (30%), SU relative to max in row
 */

const Scoring = {
  update() {
    const s = Store.state;
    const container = document.getElementById('scoringResults');

    // Check visibility of client link button
    const btnClientLink = document.getElementById('btnClientLink');
    const hasData = s.insurers.length > 0 && s.risks.length > 0;

    if (btnClientLink) {
      btnClientLink.classList.toggle('hidden', !hasData);
    }

    if (!hasData) {
      container.innerHTML = `<div class="empty-state" style="padding:2rem; grid-column:1/-1;">
        <p style="font-size:0.8rem; color:var(--slate-400);">Dodaj ryzyka i ubezpieczycieli, aby zobaczyć rekomendację.</p>
      </div>`;
      return;
    }

    // Calculate max scope
    let maxScope = 0;
    s.risks.forEach(r => maxScope += (r.weight || 1));

    // Get valid premiums for price scoring
    const validPremiums = s.insurers
      .map(tu => parseNum(s.totals[tu.id]))
      .filter(p => p > 0);
    const minPremium = validPremiums.length > 0 ? Math.min(...validPremiums) : 0;

    // Score each insurer
    const scores = [];
    s.insurers.forEach(tu => {
      let scopePts = 0;

      s.risks.forEach(r => {
        const currentSu = parseNum(s.matrixData[r.id]?.[tu.id]?.su);
        let maxSuRow = 0;
        s.insurers.forEach(t => {
          const su = parseNum(s.matrixData[r.id]?.[t.id]?.su);
          if (su > maxSuRow) maxSuRow = su;
        });
        if (maxSuRow > 0 && currentSu > 0) {
          scopePts += (currentSu / maxSuRow) * (r.weight || 1);
        }
      });

      const scopePerc = maxScope > 0 ? (scopePts / maxScope) * 100 : 0;
      const prem = parseNum(s.totals[tu.id]);
      const pricePerc = (minPremium > 0 && prem > 0)
        ? (minPremium / prem) * 100
        : (prem === 0 && minPremium === 0 ? 100 : 0);

      scores.push({
        name: tu.short_name || tu.name,
        total: (scopePerc * 0.7) + (pricePerc * 0.3),
        scope: scopePerc,
        price: pricePerc,
        prem: prem,
      });
    });

    scores.sort((a, b) => b.total - a.total);

    if (maxScope === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:2rem; grid-column:1/-1;">
        <p style="font-size:0.8rem; color:var(--slate-400);">Wypełnij wartości SU, aby zobaczyć rekomendację.</p>
      </div>`;
      return;
    }

    let html = '';
    scores.forEach((s, i) => {
      const isWinner = i === 0 && s.total > 0;
      const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;

      html += `<div class="score-card${isWinner ? ' winner' : ''}">`;
      if (isWinner) {
        html += `<div class="score-card-winner-badge">Zwycięzca</div>`;
      }
      html += `<div class="score-card-header">
        <span class="score-card-rank">${rankEmoji}</span>
        <span class="score-card-name">${s.name}</span>
      </div>`;

      html += `<div class="score-card-total">
        <div class="score-card-total-label">Dopasowanie oferty</div>
        <div><span class="score-card-total-value">${s.total.toFixed(1)}</span><span class="score-card-total-unit">%</span></div>
      </div>`;

      html += `<div class="score-card-details">
        <div class="score-detail-row"><span>Zakres (70%)</span><span>${s.scope.toFixed(1)}%</span></div>
        <div class="score-detail-row"><span>Składka (30%)</span><span>${s.price.toFixed(1)}%</span></div>
        <div class="score-divider"></div>
        <div class="score-detail-row"><span>Składka</span><span style="color:var(--blue-700);">${s.prem > 0 ? formatCurrency(s.prem) + ' zł' : '—'}</span></div>
      </div>`;

      html += `</div>`;
    });

    container.innerHTML = html;
  }
};
