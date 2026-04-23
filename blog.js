/* UtrataDochodu — blog.js
   Ładowanie artykułów z Supabase, obsługa czytnika, deep linking.
*/

const SB_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a3Znc2pybXJxdHpoa3N6enVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTI0NzYsImV4cCI6MjA4ODQ4ODQ3Nn0.wOB-4CJTcRksSUY7WD7CXEccTKNxPIVF8AT8hczS5zY';
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);

const cardStyles = [
  { bg: 'bg-blue-50',    text: 'text-blue-600',   emoji: '💸' },
  { bg: 'bg-amber-50',   text: 'text-amber-600',  emoji: '⚖️' },
  { bg: 'bg-emerald-50', text: 'text-emerald-600', emoji: '⚕️' },
  { bg: 'bg-purple-50',  text: 'text-purple-600', emoji: '🛡️' },
  { bg: 'bg-rose-50',    text: 'text-rose-600',   emoji: '📊' },
  { bg: 'bg-indigo-50',  text: 'text-indigo-600', emoji: '📈' },
];

async function loadBlogPosts() {
  const grid = document.getElementById('blog-grid');
  try {
    const { data, error } = await supabaseClient
      .from('aura_articles')
      .select('id, title, excerpt, tags, published_at, created_at')
      .eq('status', 'published')
      .contains('platforms', ['UtrataDochodu.pl'])
      .order('published_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      grid.innerHTML = '<div class="col-span-full text-center text-slate-500 py-10 border-2 border-dashed border-slate-200 rounded-3xl">Brak wpisów w bazie. Opublikuj je w panelu administracyjnym.</div>';
      return;
    }

    grid.innerHTML = data.map((art, idx) => {
      const style   = cardStyles[idx % cardStyles.length];
      const mainTag = art.tags?.length ? art.tags[0] : 'Wiedza HR';
      const dateStr = new Date(art.published_at || art.created_at)
        .toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

      return `
        <article class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col hover:shadow-lg transition-shadow cursor-pointer" data-article-id="${art.id}">
          <div class="${style.bg} h-48 flex items-center justify-center border-b border-slate-100">
            <span class="text-6xl">${style.emoji}</span>
          </div>
          <div class="p-6 sm:p-8 flex flex-col flex-grow">
            <div class="text-xs font-bold ${style.text} uppercase tracking-widest mb-3">${mainTag}</div>
            <h2 class="text-xl font-bold text-slate-900 mb-3 leading-snug hover:text-blue-600 transition-colors">${art.title}</h2>
            <p class="text-sm text-slate-600 mb-6 flex-grow line-clamp-3">${art.excerpt || 'Kliknij, aby przeczytać...'}</p>
            <div class="flex justify-between items-center pt-4 border-t border-slate-100">
              <span class="text-xs text-slate-500">${dateStr}</span>
              <span class="text-sm font-bold text-blue-600 hover:text-blue-800">Czytaj wpis &rarr;</span>
            </div>
          </div>
        </article>`;
    }).join('');

  } catch (err) {
    console.error('Błąd ładowania bazy:', err);
    grid.innerHTML = '<div class="col-span-full text-center text-red-500 py-10">Wystąpił błąd podczas komunikacji z bazą danych.</div>';
  }
}

async function openArticle(id) {
  const { data, error } = await supabaseClient.from('aura_articles').select('*').eq('id', id).single();
  if (error || !data) { alert('Nie udało się pobrać artykułu.'); return; }

  document.getElementById('reader-title').textContent = data.title;
  const dateStr = new Date(data.published_at || data.created_at)
    .toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('reader-date').textContent = `Opublikowano: ${dateStr}`;
  document.getElementById('reader-tags').innerHTML = (data.tags || [])
    .map(t => `<span class="bg-blue-50 border border-blue-100 text-blue-700 text-xs px-3 py-1 rounded-lg font-black uppercase tracking-wider">${t}</span>`)
    .join('');
  document.getElementById('reader-content').innerHTML = data.content;

  document.getElementById('blog-list-view').classList.add('hidden');
  document.getElementById('article-reader-view').classList.remove('hidden');
  window.scrollTo(0, 0);
  history.pushState(null, null, '#article-' + id);
}

function closeArticle() {
  document.getElementById('article-reader-view').classList.add('hidden');
  document.getElementById('blog-list-view').classList.remove('hidden');
  window.scrollTo(0, 0);
  history.pushState(null, null, window.location.pathname);
}

function copyArticleLink() {
  navigator.clipboard?.writeText(window.location.href).then(() => {
    alert('Pomyślnie skopiowano link do artykułu!');
  }).catch(() => {
    alert('Skopiuj ten link ręcznie:\n' + window.location.href);
  });
}

async function handleRouting() {
  const hash = window.location.hash.replace('#', '');
  if (hash.startsWith('article-')) {
    await openArticle(hash.replace('article-', ''));
  } else {
    document.getElementById('article-reader-view').classList.add('hidden');
    document.getElementById('blog-list-view').classList.remove('hidden');
  }
}

/* ── Event Listeners ── */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
  });

  /* Event delegation for article cards */
  document.getElementById('blog-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('article[data-article-id]');
    if (card) openArticle(card.dataset.articleId);
  });

  document.getElementById('close-article-btn')?.addEventListener('click', closeArticle);
  document.getElementById('copy-link-btn')?.addEventListener('click', copyArticleLink);

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    hash.startsWith('article-') ? openArticle(hash.replace('article-', '')) : closeArticle();
  });

  loadBlogPosts();
  handleRouting();
});
