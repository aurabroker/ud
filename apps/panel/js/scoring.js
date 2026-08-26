/**
 * scoring.js — Compact scoring cards — v2.0
 */

const Scoring = {
  update() {
    const s = Store.state;
    const v = Store.getActiveVariant();
    const container = document.getElementById('scoringResults');
    const btnClientLink = document.getElementById('btnClientLink');
    const hasData = s.insurers.length > 0 && s.risks.length > 0;

    if (btnClientLink) btnClientLink.classList.toggle('hidden', !hasData);

    if (!hasData || !v) {
      container.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--slate-400);font-size:0.8rem;grid-column:1/-1;">Dodaj ryzyka i ubezpieczycieli.</div>`;
      return;
    }

    let maxScope = 0;
    s.risks.forEach(r => maxScope += (r.weight || 1));

    const validPremiums = s.insurers.map(tu => parseNum(v.totals[tu.id])).filter(p => p > 0);
    const minPremium = validPremiums.length > 0 ? Math.min(...validPremiums) : 0;

    const scores = [];
    s.insurers.forEach(tu => {
      let scopePts = 0;
      s.risks.forEach(r => {
        const su = parseNum(v.matrixData[r.id]?.[tu.id]?.su);
        let maxSu = 0;
        s.insurers.forEach(t => { const x = parseNum(v.matrixData[r.id]?.[t.id]?.su); if (x > maxSu) maxSu = x; });
        if (maxSu > 0 && su > 0) scopePts += (su / maxSu) * (r.weight || 1);
      });

      const scopePerc = maxScope > 0 ? (scopePts / maxScope) * 100 : 0;
      const prem = parseNum(v.totals[tu.id]);
      const pricePerc = (minPremium > 0 && prem > 0) ? (minPremium / prem) * 100 : (prem === 0 && minPremium === 0 ? 100 : 0);

      scores.push({
        id: tu.id,
        name: tu.short_name || tu.name,
        total: (scopePerc * 0.7) + (pricePerc * 0.3),
        scope: scopePerc, price: pricePerc, prem,
      });
    });

    scores.sort((a, b) => b.total - a.total);

    if (maxScope === 0) {
      container.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--slate-400);font-size:0.8rem;grid-column:1/-1;">Wypełnij SU aby zobaczyć rekomendację.</div>`;
      return;
    }

    // Compact single-line cards
    let html = '';
    scores.forEach((sc, i) => {
      const win = i === 0 && sc.total > 0;
      const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      const variantId = Store.getActiveVariant().id;
      const isChosen = Store.state.clientChoice?.insurer_id === sc.id && Store.state.clientChoice?.variant_id === variantId;

      html += `<div class="score-row${win ? ' winner' : ''}${isChosen ? ' chosen' : ''}">
        <span class="score-row-rank">${rank}</span>
        <span class="score-row-name">${escHtml(sc.name)}</span>
        <span class="score-row-pct${win ? ' gold' : ''}">${sc.total.toFixed(1)}%</span>
        <span class="score-row-detail">Z:${sc.scope.toFixed(0)}% S:${sc.price.toFixed(0)}%</span>
        <span class="score-row-prem">${sc.prem > 0 ? formatCurrency(sc.prem) + ' zł' : '—'}</span>`;

      // Client choice checkbox
      if (Matrix.isClientView && !Store.state.clientChoice) {
        html += `<button class="btn btn-success btn-sm score-row-choose" onclick="ClientView.chooseOffer('${sc.id}','${escHtml(sc.name)}')">Wybieram</button>`;
      }
      if (isChosen) {
        html += `<span class="score-row-chosen-badge">✓ Wybrano</span>`;
      }
      html += `</div>`;
    });

    container.innerHTML = html;
  }
};
