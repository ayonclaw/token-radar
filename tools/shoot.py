#!/usr/bin/env python3
"""Render the radar dashboard's three screenshots with the native Chromium at 1440x900.

Usage: shoot.py <out_dir> <png_dir>
Renders from file:// out/dashboard/index.html, which reads ../data.js beside it.
Writes board.jpg, detail.jpg, filtered.jpg at 300-350 KB where the page allows.
"""
import os, sys, json, glob
from playwright.sync_api import sync_playwright

OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'out')
DEST = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else 'screenshots')
CHROME = '/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux/chrome'
os.makedirs(DEST, exist_ok=True)
page_url = 'file://' + os.path.join(OUT, 'dashboard', 'index.html')

W, H = 1440, 900


def shoot(page, path, quality=82):
    page.screenshot(path=path, type='jpeg', quality=quality, full_page=False)
    return os.path.getsize(path)


def settle(page):
    page.wait_for_timeout(400)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'])
    page = browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)
    page.goto(page_url, wait_until='load')
    settle(page)

    info = {}
    info['errors'] = errors
    info['title'] = page.title()
    info['rows'] = page.eval_on_selector_all('#grid-body tr', 'els => els.length')
    info['head_cols'] = page.eval_on_selector_all('#grid-head th', 'els => els.map(e => e.textContent.trim())')
    info['tally'] = page.inner_text('#tally')
    info['caption'] = page.inner_text('#grid-caption')
    info['first_row'] = page.inner_text('#grid-body tr')
    info['figure_text'] = page.inner_text('.figures')
    info['bound_sample'] = page.eval_on_selector('[data-bind="coef-size"]', 'e => e.textContent')

    # 1. the board
    info['board_bytes'] = shoot(page, os.path.join(DEST, '1-board.jpg'), 84)

    # 2. a protocol's detail view: open rank 1
    page.eval_on_selector('#grid-body tr', 'el => el.click()')
    settle(page)
    info['drawer_open'] = page.eval_on_selector('#drawer', 'e => !e.hidden')
    info['drawer_text'] = page.inner_text('#drawer-body')[:1200]
    info['detail_bytes'] = shoot(page, os.path.join(DEST, '2-detail.jpg'), 84)
    page.eval_on_selector('#drawer-close', 'el => el.click()')
    settle(page)

    # 3. a filtered view: search + TVL floor, showing the count change
    page.fill('#q', 'lending')
    page.select_option('#minTvl', '50000000')
    settle(page)
    info['filtered_tally'] = page.inner_text('#tally')
    info['filtered_rows'] = page.eval_on_selector_all('#grid-body tr', 'els => els.length')
    info['filtered_bytes'] = shoot(page, os.path.join(DEST, '3-filtered.jpg'), 84)

    browser.close()

print(json.dumps(info, indent=1)[:4000])
