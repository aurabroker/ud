/* UtrataDochodu — app.js
   Chatbot, nawigacja mobilna, zakładki segmentów, losowe aktualności, AOS
*/

/* ──────────────────────────────────────────
   CHATBOT
────────────────────────────────────────── */
function initChat() {
  const chatBtn    = document.getElementById('chat-toggle-btn');
  const chatWidget = document.getElementById('chat-widget');
  const closeBtn   = document.getElementById('close-chat');
  if (!chatBtn || !chatWidget) return;

  function openChat() {
    chatWidget.classList.remove('scale-0', 'opacity-0');
    chatWidget.classList.add('scale-100', 'opacity-100');
    chatBtn.querySelector('span').innerText = '✕';
    chatBtn.classList.remove('pulse-btn');
  }

  function closeChat() {
    chatWidget.classList.remove('scale-100', 'opacity-100');
    chatWidget.classList.add('scale-0', 'opacity-0');
    chatBtn.querySelector('span').innerText = '💬';
  }

  function toggleChat() {
    chatWidget.classList.contains('scale-0') ? openChat() : closeChat();
  }

  chatBtn.addEventListener('click', toggleChat);
  closeBtn?.addEventListener('click', closeChat);

  // Auto-open po 8 sekundach
  setTimeout(() => {
    if (chatWidget.classList.contains('scale-0')) openChat();
  }, 8000);
}

/* ──────────────────────────────────────────
   NAWIGACJA MOBILNA
────────────────────────────────────────── */
function initMobileMenu() {
  const btn  = document.getElementById('mobile-menu-btn');
  const menu = document.getElementById('mobile-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', () => menu.classList.toggle('hidden'));

  // Zamknij menu po kliknięciu linka
  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => menu.classList.add('hidden'));
  });
}

/* ──────────────────────────────────────────
   PŁYNNE SCROLLOWANIE
────────────────────────────────────────── */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      e.preventDefault();
      const id     = anchor.getAttribute('href').substring(1);
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ──────────────────────────────────────────
   ZAKŁADKI SEGMENTÓW
────────────────────────────────────────── */
const segmentData = {
  beauty: {
    title: 'Dla Salonów i Kosmetologów',
    content: `
      <p class="text-slate-600 mb-6 leading-relaxed">Jako fryzjer, kosmetyczka czy kosmetolog, Twoje ręce to Twoje jedyne narzędzie pracy. Nawet drobny uraz, złamanie palca czy choroba zakaźna może wykluczyć Cię z zawodu na tygodnie.</p>
      <ul class="space-y-4">
        <li class="flex items-start"><span class="mr-3 text-green-500 text-xl">✔</span><div><strong class="text-slate-800">Wariant HIV/WZW:</strong> Wypłata jednorazowa przy nieszczęśliwym zakażeniu.</div></li>
        <li class="flex items-start"><span class="mr-3 text-green-500 text-xl">✔</span><div><strong class="text-slate-800">Utrata dochodu:</strong> Świadczenie dzienne, które pozwoli utrzymać lokal.</div></li>
      </ul>`,
  },
  med: {
    title: 'Dla Lekarzy i Pielęgniarek',
    content: `
      <p class="text-slate-600 mb-6 leading-relaxed">Medycy są codziennie narażeni na ekspozycję zawodową oraz roszczenia pacjentów. Oferta CEU/Leadenhall jest bezkompromisowo dedykowana specyfice Twojego dyżuru.</p>
      <ul class="space-y-4">
        <li class="flex items-start"><span class="mr-3 text-green-500 text-xl">✔</span><div><strong class="text-slate-800">Agresja Pacjenta:</strong> Dodatkowe świadczenia przy wypadkach w miejscu pracy.</div></li>
        <li class="flex items-start"><span class="mr-3 text-green-500 text-xl">✔</span><div><strong class="text-slate-800">Wysokie sumy:</strong> Szpitalne stawki dzienne pokrywające straty z kontraktu B2B.</div></li>
      </ul>`,
  },
  b2b: {
    title: 'Dla IT, Prawników i B2B',
    content: `
      <p class="text-slate-600 mb-6 leading-relaxed">Na kontrakcie B2B słowo "L4" często oznacza brak faktury w tym miesiącu. Nasza polisa działa jak "Prywatne Zwolnienie", zapewniając płynność w razie długiej choroby.</p>
      <ul class="space-y-4">
        <li class="flex items-start"><span class="mr-3 text-green-500 text-xl">✔</span><div><strong class="text-slate-800">Ochrona do 80% przychodów:</strong> Realne zastępstwo dla wypłat ZUS.</div></li>
        <li class="flex items-start"><span class="mr-3 text-green-500 text-xl">✔</span><div><strong class="text-slate-800">Elastyczność:</strong> Możliwość wypłaty nawet przez 24 miesiące niezdolności.</div></li>
      </ul>`,
  },
};

function switchSegment(key) {
  document.querySelectorAll('.segment-btn').forEach(btn => {
    btn.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600', 'bg-white');
    btn.classList.add('text-slate-500', 'hover:bg-white');
  });
  const activeBtn = document.getElementById(`btn-${key}`);
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-500', 'hover:bg-white');
    activeBtn.classList.add('text-blue-600', 'border-b-2', 'border-blue-600', 'bg-white');
  }

  const container = document.getElementById('segment-content');
  if (!container) return;
  container.style.opacity = 0;
  setTimeout(() => {
    container.innerHTML = `<h3 class="text-2xl font-bold mb-3 text-slate-800">${segmentData[key].title}</h3>${segmentData[key].content}`;
    container.style.opacity = 1;
  }, 200);
}

/* ──────────────────────────────────────────
   LOSOWE AKTUALNOŚCI W SIDEBARZE
────────────────────────────────────────── */
const blogPosts = [
  {
    title: 'L4 na JDG to często pułapka finansowa',
    excerpt: 'Większość przedsiębiorców opłaca minimalne składki. Zobacz, ile realnie wynosi zasiłek…',
    link: 'blog.html#post-1',
  },
  {
    title: 'Nowe wytyczne dot. zwolnień lekarskich w 2026',
    excerpt: 'Sprawdź, jak nadchodzące zmiany w prawie wpłyną na Twoje finanse podczas przewlekłej choroby…',
    link: 'blog.html#post-2',
  },
  {
    title: 'Medycy a agresja pacjentów. Jak działa polisa?',
    excerpt: 'Praca w placówce zdrowia to rosnące ryzyko. Nowe warianty ochrony na wypadek nieszczęśliwych zdarzeń…',
    link: 'blog.html#post-3',
  },
];

function initRandomBlogPost() {
  const container = document.getElementById('random-blog-post');
  if (!container) return;

  const post = blogPosts[Math.floor(Math.random() * blogPosts.length)];
  container.innerHTML = `
    <div class="bg-slate-50 p-5 sm:p-6 rounded-xl border border-slate-100 hover:border-blue-200 transition-colors shadow-sm group">
      <span class="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-3 block">Polecany Wpis</span>
      <h4 class="font-bold text-slate-900 text-lg sm:text-xl mb-3 group-hover:text-blue-700 transition-colors leading-snug">${post.title}</h4>
      <p class="text-sm text-slate-600 mb-5 line-clamp-3">${post.excerpt}</p>
      <a href="${post.link}" class="inline-flex items-center text-sm font-semibold text-white bg-slate-900 px-4 py-2 rounded-lg group-hover:bg-blue-600 transition-colors">
        Czytaj dalej <span class="ml-2">&rarr;</span>
      </a>
    </div>`;
}

/* ──────────────────────────────────────────
   AOS ANIMACJE
────────────────────────────────────────── */
function initAOS() {
  if (typeof AOS !== 'undefined') {
    AOS.init({ duration: 800, once: true });
  }
}

/* ──────────────────────────────────────────
   SUWAK WKŁADU PRACODAWCY
────────────────────────────────────────── */
function initEmployerSlider() {
  const slider = document.getElementById('emp_slider');
  const output = document.getElementById('emp_val');
  if (!slider || !output) return;

  slider.addEventListener('input', () => {
    output.innerText = slider.value + '%';
  });
}

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initChat();
  initMobileMenu();
  initSmoothScroll();
  initRandomBlogPost();
  initAOS();
  initEmployerSlider();

  document.getElementById('btn-beauty')?.addEventListener('click', () => switchSegment('beauty'));
  document.getElementById('btn-med')?.addEventListener('click',    () => switchSegment('med'));
  document.getElementById('btn-b2b')?.addEventListener('click',    () => switchSegment('b2b'));
});
