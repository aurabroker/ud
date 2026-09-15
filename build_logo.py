#!/usr/bin/env python3
"""Generuje logo marki UtrataDochodu — poziomy lockup.

    python3 build_logo.py

Plik trafia pod dwa adresy, do których odwołuje się Schema.org:
`/logo.png` (Organization na `index.html`) oraz `/img/logo.png`
(publisher.logo na 228 podstronach zawodów).
Master kompozycji jest TUTAJ, w stałej LOCKUP_HTML — nie ma osobnego pliku
graficznego do edycji. Chcesz zmienić logo? Popraw HTML poniżej i uruchom skrypt.

Znak pochodzi z `favicon.svg`, więc ikona i logo nie mogą się rozjechać.
Krój Inter jest pobierany z Google Fonts przy renderowaniu — ten sam, którego
używa strona. Bez sieci skrypt przerwie pracę zamiast podstawić zastępczy font
i po cichu wypuścić logo w złym kroju.

Wymaga Playwright (jest już w testach) i Pillow.
"""
import os, subprocess, sys, tempfile

ROOT   = os.path.dirname(os.path.abspath(__file__))
ZNAK   = os.path.join(ROOT, 'favicon.svg')
# Dwa adresy, jeden plik źródłowy — w kodzie istnieją oba i oba były martwe:
#   /logo.png      — blok Organization na index.html
#   /img/logo.png  — publisher.logo na 228 podstronach zawodów
# Zapisujemy w obu miejscach z tego samego renderu, żeby nie mogły się rozjechać.
CELE   = [os.path.join(ROOT, 'logo.png'), os.path.join(ROOT, 'img', 'logo.png')]
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

SZEROKOSC_DOCELOWA = 1200   # Google wymaga min. 112 px; 1200 starcza na każde użycie
SKALA_RENDERU      = 2      # renderujemy 2x i zmniejszamy — tekst wychodzi czyściej

# Kolory prosto z nawigacji na index.html: slate-900 + blue-600.
LOCKUP_HTML = """
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@800&display=swap');
  html,body{margin:0;padding:0;background:#fff}
  .lockup{display:inline-flex;align-items:center;gap:40px;padding:56px 64px;background:#fff}
  /* Znak ma w viewBox własny margines, więc skalujemy go ponad wysokość
     wersalika — chodzi o zgodność optyczną, nie matematyczną. */
  .mark{width:196px;height:196px;display:block;margin-top:-6px}
  .slowo{font-family:Inter,sans-serif;font-weight:800;font-size:124px;letter-spacing:-.035em;
         line-height:.82;color:#0f172a;white-space:nowrap}
  .akcent{color:#2563eb}
</style>
<div class="lockup">
  __ZNAK__
  <div class="slowo">Utrata<span class="akcent">Dochodu</span></div>
</div>
"""

RENDER_JS = r'''
const { chromium } = require('playwright');
const fs = require('fs');
const [,, chrome, htmlPath, out, skala] = process.argv;
(async () => {
  const b = await chromium.launch({ executablePath: chrome });
  const p = await b.newPage({ viewport: { width: 2400, height: 800 },
                              deviceScaleFactor: Number(skala) });
  await p.setContent(fs.readFileSync(htmlPath, 'utf8'), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  if (!await p.evaluate(() => document.fonts.check('800 124px Inter'))) {
    console.error('BLAD: nie wczytano kroju Inter — logo wyszłoby w zastępczym foncie');
    process.exit(2);
  }
  await p.locator('.lockup').screenshot({ path: out });
  await b.close();
})();
'''

def main():
    if not os.path.exists(ZNAK):
        sys.exit('brak favicon.svg — znak w logo pochodzi z tego pliku')

    # Znak wchodzi inline; id klipu zmieniamy, żeby nie kolidowało z niczym na stronie.
    znak = (open(ZNAK, encoding='utf-8').read()
            .replace('<svg ', '<svg class="mark" ', 1)
            .replace('id="u"', 'id="ulogo"').replace('url(#u)', 'url(#ulogo)'))

    tmp = tempfile.mkdtemp()
    html = os.path.join(tmp, 'lockup.html')
    surowy = os.path.join(tmp, 'surowy.png')
    open(html, 'w', encoding='utf-8').write(LOCKUP_HTML.replace('__ZNAK__', znak))

    js = os.path.join(tmp, 'render.js')
    open(js, 'w').write(RENDER_JS)
    env = dict(os.environ)
    env['NODE_PATH'] = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True).stdout.strip()
    wynik = subprocess.run(['node', js, CHROME, html, surowy, str(SKALA_RENDERU)], env=env)
    if wynik.returncode:
        sys.exit('rasteryzacja nie powiodła się')

    from PIL import Image
    im = Image.open(surowy).convert('RGB')          # bez kanału alfa: logo ma własne białe tło
    wys = round(im.height * SZEROKOSC_DOCELOWA / im.width)
    gotowe = im.resize((SZEROKOSC_DOCELOWA, wys), Image.LANCZOS)

    for cel in CELE:
        os.makedirs(os.path.dirname(cel), exist_ok=True)
        gotowe.save(cel, optimize=True)
        print(f'  {os.path.relpath(cel, ROOT):16} {SZEROKOSC_DOCELOWA}x{wys}  {os.path.getsize(cel)} B')

if __name__ == '__main__':
    main()
