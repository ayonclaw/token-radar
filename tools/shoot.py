#!/usr/bin/env python3
"""Render the radar's three screenshots from the built out/ directory at 1440x900.

Usage: python3 tools/shoot.py [out_dir] [dest_dir]
Reads out/dashboard/index.html (which loads ../data.js) over file://, no network.
Writes board.jpg, charts.jpg, detail.jpg as JPEG at 300-350 KB where the page allows.
Exits 1 on any page error, so a broken render cannot be committed silently.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'out')
DEST = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else 'screenshots')
CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux/chrome'
W, H = 1440, 900
os.makedirs(DEST, exist_ok=True)

data = open(os.path.join(OUT, 'data.js'), encoding='utf-8').read()
radar = json.loads(data.split('=', 1)[1].strip().rstrip(';'))
top = radar['rows'][0]['slug']
best_detail = next(r['slug'] for r in radar['rows'] if r['rank'] in (5, 6, 7))
url = 'file://' + os.path.join(OUT, 'dashboard', 'index.html')

SHOTS = [
    ('1-board.jpg', '', 84),
    ('2-filtered.jpg', '?chain=Base&watch=1', 86),
    ('3-detail.jpg', '?p=' + best_detail, 86),
    ('4-charts.jpg', '?view=charts', 88),
]


def main():
    errors = []
    report = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'])
        for name, query, quality in SHOTS:
            page = browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
            page.goto(url + query, wait_until='load')
            page.wait_for_timeout(350)
            path = os.path.join(DEST, name)
            for q in range(quality, 50, -3):
                page.screenshot(path=path, type='jpeg', quality=q, full_page=False)
                size = os.path.getsize(path)
                if size <= 350 * 1024:
                    break
            report.append({'name': name, 'query': query, 'bytes': os.path.getsize(path), 'quality': q})
            page.close()
        browser.close()
    print(json.dumps({'shots': report, 'errors': errors, 'top': top, 'detail': best_detail}, indent=1))
    if errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
