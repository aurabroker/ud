/**
 * Przeciąganie kart — kontroler na zdarzeniach wskaźnika (bez biblioteki).
 *
 * Dlaczego własny, a nie biblioteka DnD: HTML5 drag-and-drop nie działa na
 * dotyku, nie pozwala na próg ruchu (K01: zwykły klik ma otwierać szczegóły,
 * nie zaczynać przeciągania), nie pozwala anulować Esc ani zatrzymać
 * przewijania pod wskaźnikiem. Tu: próg ~7 px, duch karty, placeholder,
 * autoprzewijanie przy krawędziach, Esc/pointercancel/utrata fokusu anulują,
 * a po upuszczeniu połykamy kliknięcie, które przeglądarka wygeneruje na karcie.
 *
 * Kontrakt z DOM:
 *   [data-karta-id]       karta (źródło przeciągania)
 *   [data-uchwyt]         uchwyt — jedyny punkt startu dla dotyku
 *   [data-cel-etap]       cel upuszczenia (kolumna, pozycja zwiniętego etapu, podgląd)
 *   [data-zwiniety]       cel jest zwiniętym etapem → po ~600 ms podgląd
 *   [data-przewijanie-poziome] / [data-przewijanie-kolumny]  kontenery autoprzewijania
 * Decyzje (czy można upuścić, co zrobić) należą do aplikacji — kontroler tylko
 * pyta (`ocen`) i zgłasza (`onUpusc`).
 */

const INTERAKTYWNE = 'a[href], button:not([data-uchwyt]), input, textarea, select, summary, [contenteditable="true"], [data-bez-przeciagania]';

/**
 * @param {{
 *   korzen: HTMLElement,
 *   czyMoznaZaczac?: (leadId: string) => boolean,
 *   ocen: (leadId: string, etapId: string) => { ok: boolean, powod?: string },
 *   onStart?: (leadId: string) => void,
 *   onCel?: (cel: { etapId: string, ok: boolean, powod?: string } | null, wskaznik: { x: number, y: number }) => void,
 *   onRuch?: (wskaznik: { x: number, y: number }) => void,
 *   onUpusc?: (leadId: string, etapId: string) => void,
 *   onOdmowa?: (leadId: string, etapId: string, powod: string) => void,
 *   onAnuluj?: (leadId: string, przyczyna: 'esc' | 'poza' | 'anulowano' | 'utrata_fokusu') => void,
 *   onPodglad?: (etapId: string) => void,
 *   czasPodgladuMs?: number,
 *   prog?: number,
 * }} opcje
 */
export function utworzPrzeciaganie({
  korzen,
  czyMoznaZaczac = () => true,
  ocen,
  onStart,
  onCel,
  onRuch,
  onUpusc,
  onOdmowa,
  onAnuluj,
  onPodglad,
  czasPodgladuMs = 600,
  prog = 7,
}) {
  /** @type {null | { x: number, y: number, id: number, karta: HTMLElement, leadId: string }} */
  let start = null;
  let aktywne = false;
  let duch = null;
  let przesuniecie = { x: 0, y: 0 };
  let cel = null;
  let timerPodgladu = null;
  let ramka = 0;
  let wskaznik = { x: 0, y: 0 };
  let vx = 0;
  let vy = 0;

  const dok = korzen.ownerDocument;
  const okno = dok.defaultView;

  function znajdzCel(x, y) {
    for (const el of dok.elementsFromPoint(x, y)) {
      const c = el.closest?.('[data-cel-etap]');
      if (c) return c;
    }
    return null;
  }

  function pointerdown(e) {
    if (e.button !== 0 || !e.isPrimary || start) return;
    const karta = e.target.closest?.('[data-karta-id]');
    if (!karta || !korzen.contains(karta)) return;
    const naUchwycie = Boolean(e.target.closest('[data-uchwyt]'));
    if (!naUchwycie && e.target.closest(INTERAKTYWNE)) return;
    // Dotyk: tylko z uchwytu — reszta karty ma przewijać listę palcem.
    if (e.pointerType === 'touch' && !naUchwycie) return;
    const leadId = karta.getAttribute('data-karta-id');
    if (!czyMoznaZaczac(leadId)) return;

    start = { x: e.clientX, y: e.clientY, id: e.pointerId, karta, leadId };
    okno.addEventListener('pointermove', pointermove);
    okno.addEventListener('pointerup', pointerup);
    okno.addEventListener('pointercancel', pointercancel);
    okno.addEventListener('keydown', keydown, true);
    okno.addEventListener('blur', blur);
  }

  function rozpocznij() {
    aktywne = true;
    const r = start.karta.getBoundingClientRect();
    przesuniecie = { x: start.x - r.left, y: start.y - r.top };

    duch = start.karta.cloneNode(true);
    duch.removeAttribute('data-karta-id');
    duch.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    duch.setAttribute('aria-hidden', 'true');
    duch.setAttribute('data-duch', '');
    duch.inert = true;
    Object.assign(duch.style, {
      position: 'fixed', left: '0', top: '0', width: `${r.width}px`, margin: '0', zIndex: '2000',
      pointerEvents: 'none', opacity: '.96', transform: `translate(${r.left}px, ${r.top}px) rotate(1.5deg)`,
      boxShadow: '0 12px 28px rgba(15,23,42,.28)',
    });
    dok.body.append(duch);

    start.karta.setAttribute('data-przeciagana', '');
    dok.documentElement.setAttribute('data-przeciaganie', '');
    try { start.karta.setPointerCapture(start.id); } catch { /* element mógł zniknąć */ }
    okno.getSelection?.()?.removeAllRanges();
    okno.addEventListener('contextmenu', zablokuj, true);
    okno.addEventListener('selectstart', zablokuj, true);
    onStart?.(start.leadId);
    ramka = okno.requestAnimationFrame(petla);
  }

  const zablokuj = (e) => e.preventDefault();

  function pointermove(e) {
    if (!start || e.pointerId !== start.id) return;
    if (!aktywne) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < prog) return;
      rozpocznij();
    }
    wskaznik = { x: e.clientX, y: e.clientY };
    duch.style.transform = `translate(${e.clientX - przesuniecie.x}px, ${e.clientY - przesuniecie.y}px) rotate(1.5deg)`;
    onRuch?.(wskaznik);
    zaktualizujCel(e.clientX, e.clientY);
    policzPrzewijanie(e.clientX, e.clientY);
  }

  function zaktualizujCel(x, y) {
    const el = znajdzCel(x, y);
    const etapId = el?.getAttribute('data-cel-etap') ?? null;
    if (etapId === (cel?.etapId ?? null)) return;
    clearTimeout(timerPodgladu);
    if (!etapId) {
      cel = null;
      onCel?.(null, wskaznik);
      return;
    }
    const ocena = ocen(start.leadId, etapId);
    cel = { etapId, ok: ocena.ok, powod: ocena.powod };
    onCel?.(cel, wskaznik);
    if (el.hasAttribute('data-zwiniety') && onPodglad) {
      timerPodgladu = setTimeout(() => { if (aktywne && cel?.etapId === etapId) onPodglad(etapId); }, czasPodgladuMs);
    }
  }

  /** Autoprzewijanie: poziomo przy brzegach tablicy, pionowo przy brzegach kolumny pod wskaźnikiem. */
  function policzPrzewijanie(x, y) {
    vx = 0;
    vy = 0;
    const pozioma = korzen.querySelector('[data-przewijanie-poziome]');
    const pas = 72;
    if (pozioma) {
      const r = pozioma.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        if (x < r.left + pas) vx = -Math.ceil(((r.left + pas - x) / pas) * 18);
        else if (x > r.right - pas) vx = Math.ceil(((x - (r.right - pas)) / pas) * 18);
      }
    }
    for (const el of dok.elementsFromPoint(x, y)) {
      const lista = el.closest?.('[data-przewijanie-kolumny]');
      if (!lista) continue;
      const r = lista.getBoundingClientRect();
      const pasY = 56;
      if (y < r.top + pasY) vy = -Math.ceil(((r.top + pasY - y) / pasY) * 16);
      else if (y > r.bottom - pasY) vy = Math.ceil(((y - (r.bottom - pasY)) / pasY) * 16);
      break;
    }
  }

  function petla() {
    if (!aktywne) return;
    if (vx || vy) {
      const pozioma = korzen.querySelector('[data-przewijanie-poziome]');
      if (vx && pozioma) pozioma.scrollLeft += vx;
      if (vy) {
        for (const el of dok.elementsFromPoint(wskaznik.x, wskaznik.y)) {
          const lista = el.closest?.('[data-przewijanie-kolumny]');
          if (lista) { lista.scrollTop += vy; break; }
        }
      }
      // Po przewinięciu pod wskaźnikiem jest już inny element.
      zaktualizujCel(wskaznik.x, wskaznik.y);
    }
    ramka = okno.requestAnimationFrame(petla);
  }

  function pointerup(e) {
    if (!start || e.pointerId !== start.id) return;
    if (!aktywne) { sprzatnij(); return; }
    const leadId = start.leadId;
    const el = znajdzCel(e.clientX, e.clientY);
    const etapId = el?.getAttribute('data-cel-etap') ?? null;
    polknijKlikniecie();
    sprzatnij();
    if (!etapId) { onAnuluj?.(leadId, 'poza'); return; }
    const ocena = ocen(leadId, etapId);
    if (!ocena.ok) { onOdmowa?.(leadId, etapId, ocena.powod ?? 'Niedozwolony cel.'); return; }
    onUpusc?.(leadId, etapId);
  }

  function pointercancel(e) {
    if (!start || e.pointerId !== start.id) return;
    anuluj('anulowano');
  }

  function keydown(e) {
    if (e.key !== 'Escape' || !aktywne) return;
    e.preventDefault();
    e.stopPropagation();
    anuluj('esc');
  }

  function blur() {
    if (aktywne) anuluj('utrata_fokusu');
    else sprzatnij();
  }

  function anuluj(przyczyna) {
    const leadId = start?.leadId;
    const bylo = aktywne;
    polknijKlikniecie();
    sprzatnij();
    if (bylo && leadId) onAnuluj?.(leadId, przyczyna);
  }

  /**
   * Po upuszczeniu przeglądarka wysyła `click` na elemencie z przechwyconym
   * wskaźnikiem (karta) — nie ma otwierać szczegółów. Połykamy WYŁĄCZNIE kliknięcie
   * w tę kartę, i tylko jedno: kliknięcie gdzie indziej (np. w okno, które właśnie
   * otworzyło upuszczenie) musi przejść. Timer jest tylko zabezpieczeniem na
   * wypadek, gdyby przeglądarka żadnego kliknięcia nie wysłała.
   */
  function polknijKlikniecie() {
    const karta = start?.karta;
    if (!karta) return;
    const polkniecie = (e) => {
      if (karta.contains(e.target)) {
        e.stopPropagation();
        e.preventDefault();
      }
      okno.removeEventListener('click', polkniecie, true);
    };
    okno.addEventListener('click', polkniecie, true);
    setTimeout(() => okno.removeEventListener('click', polkniecie, true), 250);
  }

  function sprzatnij() {
    okno.removeEventListener('pointermove', pointermove);
    okno.removeEventListener('pointerup', pointerup);
    okno.removeEventListener('pointercancel', pointercancel);
    okno.removeEventListener('keydown', keydown, true);
    okno.removeEventListener('blur', blur);
    okno.removeEventListener('contextmenu', zablokuj, true);
    okno.removeEventListener('selectstart', zablokuj, true);
    clearTimeout(timerPodgladu);
    okno.cancelAnimationFrame(ramka);
    if (start) {
      try { start.karta.releasePointerCapture(start.id); } catch { /* już zwolniony */ }
      start.karta.removeAttribute('data-przeciagana');
    }
    duch?.remove();
    duch = null;
    dok.documentElement.removeAttribute('data-przeciaganie');
    const bylo = aktywne;
    aktywne = false;
    start = null;
    cel = null;
    vx = 0;
    vy = 0;
    if (bylo) onCel?.(null, wskaznik);
  }

  korzen.addEventListener('pointerdown', pointerdown);

  return {
    czyAktywne: () => aktywne,
    zniszcz() {
      korzen.removeEventListener('pointerdown', pointerdown);
      sprzatnij();
    },
  };
}
