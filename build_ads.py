#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_ads.py - Dodaje Google Ads conversion tracking do wszystkich stron HTML
              oraz aktualizuje HTML_TEMPLATE w build_ud.py

Co robi:
  1. Strony bez żadnego gtag       → wstawia pełny global tag za <head>
  2. Strony z istniejącym GA4 tag  → dopisuje gtag('config', 'AW-...') do bloku
  3. thankyou.html                 → global tag + event konwersji
  4. build_ud.py HTML_TEMPLATE     → dopisuje global tag (przyszłe buildy)
  5. Pliki już z AW ID             → pomija (idempotentne)

Użycie: python3 build_ads.py [--dry-run]
"""

import os
import re
import glob
import argparse

AW_ID             = "AW-18020137303"
CONVERSION_LABEL  = "_uZeCOTG_KwcENfy1ZBD"
BASE_DIR          = os.path.dirname(os.path.abspath(__file__))

# ── Snippety wstrzykiwane do HTML ─────────────────────────────────────────────

GLOBAL_TAG = f"""\
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id={AW_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', '{AW_ID}');
</script>"""

CONFIG_LINE = f"  gtag('config', '{AW_ID}');"

CONVERSION_EVENT = f"""\
<!-- Event snippet for Przesłanie formularza kontaktowego -->
<script>
  gtag('event', 'conversion', {{'send_to': '{AW_ID}/{CONVERSION_LABEL}'}});
</script>"""

# ── Snippet dla HTML_TEMPLATE w build_ud.py (podwójne {{ bo Python .format) ──

BUILD_UD_TAG = (
    '  <!-- Google tag (gtag.js) -->\n'
    '  <script async src="https://www.googletagmanager.com/gtag/js?id=' + AW_ID + '"></script>\n'
    '  <script>\n'
    '    window.dataLayer = window.dataLayer || [];\n'
    '    function gtag(){{dataLayer.push(arguments);}}\n'
    "    gtag('js', new Date());\n"
    "    gtag('config', '" + AW_ID + "');\n"
    '  </script>\n'
)

BUILD_UD_ANCHOR = '  <script defer src="https://static.cloudflareinsights.com/beacon.min.js"'

# ─────────────────────────────────────────────────────────────────────────────


def patch_html(path, dry_run=False):
    rel = os.path.relpath(path, BASE_DIR)
    with open(path, encoding='utf-8') as f:
        original = f.read()

    content = original
    actions = []

    # Sprawdź czy plik już ma tag AW
    if AW_ID in content:
        # Specjalny przypadek: thankyou.html może mieć global tag ale nie event
        if os.path.basename(path) == 'thankyou.html' and CONVERSION_LABEL not in content:
            content = content.replace('</head>', CONVERSION_EVENT + '\n</head>', 1)
            actions.append('dodano conversion event')
        else:
            print(f"  [pominięto – ma już AW]  {rel}")
            return

    else:
        # Plik ma istniejący gtag (np. GA4) – tylko dopisz config line
        if 'window.dataLayer' in content:
            content = re.sub(
                r"(gtag\('config',\s*'[^']+'\);)",
                r"\1\n" + CONFIG_LINE,
                content,
                count=1
            )
            actions.append('dopisano gtag config')
        else:
            # Brak jakiegokolwiek gtag – wstaw pełny global tag za <head>
            content = content.replace('<head>', '<head>\n' + GLOBAL_TAG, 1)
            actions.append('dodano global tag')

        # thankyou.html potrzebuje też eventu konwersji
        if os.path.basename(path) == 'thankyou.html':
            content = content.replace('</head>', CONVERSION_EVENT + '\n</head>', 1)
            actions.append('dodano conversion event')

    if content == original:
        print(f"  [bez zmian]               {rel}")
        return

    label = ' + '.join(actions)
    if dry_run:
        print(f"  [DRY-RUN] {label:<30} {rel}")
    else:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  [OK] {label:<34} {rel}")


def patch_build_ud(dry_run=False):
    path = os.path.join(BASE_DIR, 'build_ud.py')
    with open(path, encoding='utf-8') as f:
        content = f.read()

    if AW_ID in content:
        print(f"  [pominięto – ma już AW]  build_ud.py")
        return

    if BUILD_UD_ANCHOR not in content:
        print(f"  [BŁĄD] nie znaleziono znacznika w HTML_TEMPLATE — build_ud.py pomiń ręcznie")
        return

    new_content = content.replace(BUILD_UD_ANCHOR, BUILD_UD_TAG + BUILD_UD_ANCHOR, 1)

    if dry_run:
        print(f"  [DRY-RUN] zaktualizowano HTML_TEMPLATE  build_ud.py")
    else:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  [OK] zaktualizowano HTML_TEMPLATE       build_ud.py")


def main():
    parser = argparse.ArgumentParser(description="Dodaj Google Ads tracking do wszystkich stron HTML")
    parser.add_argument('--dry-run', action='store_true', help='Pokaż co zostałoby zmienione, bez zapisu')
    args = parser.parse_args()

    static = sorted(glob.glob(os.path.join(BASE_DIR, '*.html')))
    profession = sorted(glob.glob(os.path.join(BASE_DIR, '*/index.html')))

    print(f"Google Ads tracking — {'DRY RUN' if args.dry_run else 'patch'}")
    print("=" * 60)

    print(f"\nStatyczne strony ({len(static)}):")
    for f in static:
        patch_html(f, args.dry_run)

    print(f"\nStrony zawodowe ({len(profession)}):")
    for f in profession:
        patch_html(f, args.dry_run)

    print(f"\nbuild_ud.py:")
    patch_build_ud(args.dry_run)

    total = len(static) + len(profession)
    print(f"\nGotowe! Przetworzono {total} plików HTML.")


if __name__ == '__main__':
    main()
