#!/usr/bin/env python3
"""Generuje komplet ikon strony z jednego wektorowego mastera.

    python3 build_favicon.py

Master to favicon.svg — plik tekstowy, można go edytować ręcznie.
Rastry (favicon.png, favicon.ico, apple-touch-icon.png) są z niego odtwarzane,
więc nie poprawiaj ich w edytorze graficznym: przy następnym uruchomieniu
zmiany przepadną. Popraw SVG i uruchom skrypt ponownie.

Wymaga Playwright (jest już w testach) i Pillow.
"""
import os, struct, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SVG  = os.path.join(ROOT, 'favicon.svg')
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

# rozmiar → (plik wyjściowy, tło)
# Tylko apple-touch-icon jest nieprzezroczysty: iOS nie obsługuje przezroczystości
# i sam dokleja zaokrąglone rogi, więc ikona musi mieć własne pełne tło.
RASTRY = [(32, 'favicon.png', None), (180, 'apple-touch-icon.png', '#ffffff')]
ICO    = [16, 32, 48]          # rozmiary zaszyte w favicon.ico

RENDER_JS = r'''
const { chromium } = require('playwright');
const fs = require('fs');
const zadania = JSON.parse(process.argv[2]);
(async () => {
  const b = await chromium.launch({ executablePath: process.argv[3] });
  const svg = fs.readFileSync(process.argv[4], 'utf8');
  for (const z of zadania) {
    const p = await b.newPage({ viewport: { width: z.px, height: z.px }, deviceScaleFactor: 1 });
    const tlo = z.tlo || 'transparent';
    await p.setContent(`<style>html,body{margin:0;padding:0;background:${tlo}}`
      + `svg{display:block;width:${z.px}px;height:${z.px}px}</style>` + svg);
    await p.screenshot({ path: z.out, omitBackground: !z.tlo });
    await p.close();
  }
  await b.close();
})();
'''

def renderuj(zadania):
    """Rasteryzuje SVG w Chromium — ten sam silnik, który wyświetli ikonę u użytkownika."""
    import json
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(RENDER_JS); js = f.name
    env = dict(os.environ)
    env['NODE_PATH'] = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True).stdout.strip()
    subprocess.run(['node', js, json.dumps(zadania), CHROME, SVG], check=True, env=env)
    os.unlink(js)

def zapisz_ico(pliki, cel):
    """Składa ICO z gotowych PNG-ów.

    Pillow przy zapisie ICO skaluje jeden obrazek w dół, co przy 16 px daje papkę.
    Tu każdy rozmiar jest wyrenderowany osobno w pełnej jakości i pakowany
    bezpośrednio — ICO od Visty wzwyż przyjmuje PNG jako zawartość.
    """
    dane = [open(p, 'rb').read() for p in pliki]
    naglowek = struct.pack('<HHH', 0, 1, len(dane))
    offset = len(naglowek) + 16 * len(dane)
    wpisy = b''
    for px, d in zip(ICO, dane):
        wpisy += struct.pack('<BBBBHHII', px if px < 256 else 0, px if px < 256 else 0,
                             0, 0, 1, 32, len(d), offset)
        offset += len(d)
    open(cel, 'wb').write(naglowek + wpisy + b''.join(dane))

def main():
    if not os.path.exists(SVG):
        sys.exit('brak favicon.svg — to jest master, bez niego nie ma z czego generować')

    tmp = tempfile.mkdtemp()
    zadania  = [{'px': px, 'out': os.path.join(ROOT, out), 'tlo': tlo} for px, out, tlo in RASTRY]
    ico_pliki = [os.path.join(tmp, f'ico-{px}.png') for px in ICO]
    zadania += [{'px': px, 'out': p, 'tlo': None} for px, p in zip(ICO, ico_pliki)]

    renderuj(zadania)
    zapisz_ico(ico_pliki, os.path.join(ROOT, 'favicon.ico'))

    for _, out, _ in RASTRY:
        print(f'  {out:24} {os.path.getsize(os.path.join(ROOT, out)):>7} B')
    print(f'  {"favicon.ico":24} {os.path.getsize(os.path.join(ROOT, "favicon.ico")):>7} B  (16/32/48)')

if __name__ == '__main__':
    main()
