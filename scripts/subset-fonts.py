#!/usr/bin/env python3
"""Cut the shipped Latin subsets down to the characters the built pages print.

Both faces ship as variable fonts, so the files are sized by glyph count: every
Latin glyph carries an outline plus one delta set per weight, including glyphs
no page uses. This script reads dist/, finds the characters that actually
appear, and rewrites public/fonts/*.woff2 plus docs/font-coverage.json.

    npm run build                 # the text of the pages is the input
    python3 scripts/subset-fonts.py
    npm run build && npm run check

Shrinking works on the files in public/fonts. Adding text with a character the
subset dropped needs the full upstream fonts, which are not stored here:

    python3 scripts/subset-fonts.py --from ~/Downloads/dm-sans-upstream.woff2 ...

Font files are named <upstream>.woff2 and each one replaces the shipped file of
the same name, so download DM Sans and Manrope as dm-sans-var.woff2 and
manrope-var.woff2. Layout features and the name table (licence records) are
kept, because dropping them changes shaping or the required attribution.
"""
import argparse
import glob
import html
import json
import pathlib
import re
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTS = ROOT / 'public/fonts'
PAGES = ROOT / 'dist'
COVERAGE = ROOT / 'docs/font-coverage.json'

# The unicode-range in public/styles.css: characters outside it already render
# from a system font, so they never belong in these files.
RANGES = """U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212,
U+2215, U+FEFF, U+FFFD"""

SKIP = {'script', 'style', 'noscript', 'template'}


def range_set(spec):
    points = set()
    for part in re.split(r'[,\s]+', spec.strip()):
        if not part:
            continue
        span = part[2:].split('-')
        first = int(span[0], 16)
        points.update(range(first, int(span[1], 16) + 1) if len(span) > 1 else [first])
    return points


def visible_text():
    from html.parser import HTMLParser

    class Visible(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.depth = 0
            self.out = []

        def handle_starttag(self, tag, attrs):
            if tag in SKIP:
                self.depth += 1

        def handle_endtag(self, tag):
            if tag in SKIP and self.depth:
                self.depth -= 1

        def handle_data(self, data):
            if not self.depth:
                self.out.append(data)

    pages = sorted(PAGES.rglob('*.html'))
    if not pages:
        sys.exit('dist/ has no pages; run npm run build first')
    text = []
    for page in pages:
        parser = Visible()
        parser.feed(page.read_text(encoding='utf-8'))
        text.append(''.join(parser.out))
    return ' '.join(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from', dest='source', metavar='DIR', type=pathlib.Path,
                        help='directory holding the full upstream <font>.woff2 files')
    args = parser.parse_args()

    latin = range_set(RANGES)
    used = sorted({ord(ch) for ch in visible_text()} & latin)
    if len(used) < 32:
        sys.exit('found only %d characters; is dist/ complete?' % len(used))

    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_legacy = True
    options.notdef_outline = True

    for font in sorted(FONTS.glob('*-var.woff2')):
        source = (args.source / font.name) if args.source else font
        if not source.exists():
            sys.exit('missing upstream font %s' % source)
        before = font.stat().st_size
        face = subset.load_font(str(source), options)
        cut = subset.Subsetter(options=options)
        cut.populate(unicodes=used)
        cut.subset(face)
        subset.save_font(face, str(font), options)
        print('%-22s %6d -> %6d bytes, %d characters' % (font.name, before, font.stat().st_size, len(used)))

    data = json.loads(COVERAGE.read_text(encoding='utf-8'))
    data['codepoints'] = ['%04X' % c for c in used]
    COVERAGE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('wrote %s (%d codepoints); rebuild so dist/ carries the new files' % (COVERAGE.relative_to(ROOT), len(used)))


if __name__ == '__main__':
    main()
