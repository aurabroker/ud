#!/usr/bin/env python3
"""
build.py — Injects SEO meta / OG / Twitter / Schema.org into all profession
index.html files using professions-metadata.json as the single source of truth.

Usage:
  python3 build.py              # update all pages in-place
  python3 build.py --dry-run    # show what would change, no writes
  python3 build.py --slug lekarz adwokat   # update only listed slugs
"""

import json
import re
import os
import argparse
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
METADATA_FILE = os.path.join(BASE_DIR, "professions-metadata.json")

# Anchor: everything in <head> before this tag stays untouched (CDN + fonts + styles)
HEAD_ANCHOR = re.compile(
    r'(?=[ \t]*<script src="https://cdn\.tailwindcss\.com">)',
    re.MULTILINE,
)

# The entire existing JSON-LD block to replace
JSONLD_BLOCK = re.compile(
    r'[ \t]*<script type="application/ld\+json">.*?</script>[ \t]*\n?',
    re.DOTALL,
)


def render_head_meta(entry: dict) -> str:
    """Build the SEO portion of <head> (meta/OG/Twitter/Schema)."""
    m = entry["meta"]
    og = entry["og"]
    tw = entry["twitter"]
    schema = entry["schema_org"]

    parts = [
        '<head>',
        f'  <meta charset="{m["charset"]}">',
        f'  <meta name="viewport" content="{m["viewport"]}">',
        f'  <title>{m["title"]}</title>',
        f'  <meta name="description" content="{m["description"]}">',
        f'  <meta name="robots" content="{m["robots"]}">',
        f'  <link rel="canonical" href="{m["canonical"]}">',
        '',
    ]

    for prop, val in og.items():
        parts.append(f'  <meta property="{prop}" content="{val}">')
    parts.append('')

    for name, val in tw.items():
        parts.append(f'  <meta name="{name}" content="{val}">')
    parts.append('')

    schema_str = json.dumps(schema, ensure_ascii=False, indent=2)
    parts += [
        '  <script type="application/ld+json">',
        schema_str,
        '  </script>',
        '',
    ]

    return '\n'.join(parts)


def update_html(html: str, entry: dict) -> tuple[str, bool]:
    """
    Replace the <head> SEO block in an HTML string.
    Returns (updated_html, was_changed).
    """
    # 1. Strip everything between <head> and the Tailwind CDN anchor
    head_open = html.find('<head>')
    if head_open == -1:
        return html, False

    anchor_match = HEAD_ANCHOR.search(html, head_open)
    if not anchor_match:
        return html, False

    # Remove any existing JSON-LD that may be AFTER tailwind (some pages place it there)
    tail = html[anchor_match.start():]
    tail_clean = JSONLD_BLOCK.sub('', tail)

    new_meta = render_head_meta(entry)
    new_html = html[:head_open] + new_meta + tail_clean

    return new_html, new_html != html


def process(metadata: list, slugs: list | None, dry_run: bool) -> None:
    updated = skipped = missing = 0

    for entry in metadata:
        slug = entry["profession"]
        if slugs and slug not in slugs:
            continue

        path = os.path.join(BASE_DIR, slug, "index.html")
        if not os.path.exists(path):
            print(f"  MISSING   {slug}/index.html")
            missing += 1
            continue

        with open(path, encoding="utf-8") as f:
            original = f.read()

        new_html, changed = update_html(original, entry)

        if not changed:
            skipped += 1
            continue

        if dry_run:
            print(f"  DRY-RUN   {slug}/index.html")
        else:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_html)
            print(f"  UPDATED   {slug}/index.html")
        updated += 1

    label = "would update" if dry_run else "updated"
    print(f"\nDone: {updated} {label}, {skipped} unchanged, {missing} missing")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview changes without writing files")
    parser.add_argument("--slug", nargs="+", metavar="SLUG",
                        help="Process only these profession slugs")
    args = parser.parse_args()

    if not os.path.exists(METADATA_FILE):
        print(f"ERROR: {METADATA_FILE} not found. Run from repo root.", file=sys.stderr)
        sys.exit(1)

    with open(METADATA_FILE, encoding="utf-8") as f:
        metadata = json.load(f)

    process(metadata, slugs=args.slug, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
