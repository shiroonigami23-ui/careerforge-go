#!/usr/bin/env python3
"""Render docs/ROADMAP.md to docs/ROADMAP.pdf (A4) with headless Chrome.

    pip install markdown playwright && python -m playwright install chromium
    python3 scripts/build_roadmap_pdf.py            # or set CHROME_PATH to use an installed Chrome
"""
import os
import pathlib
import markdown
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC, OUT = ROOT / "docs" / "ROADMAP.md", ROOT / "docs" / "ROADMAP.pdf"
TITLE, ACCENT, INK = "CareerForge", "#2d5bff", "#0e1636"

body = markdown.markdown(SRC.read_text(encoding="utf-8"), extensions=["extra", "sane_lists"])
body = body.replace("<li>[x]", '<li class="done">').replace("<li>[ ]", '<li class="todo">')
html = f"""<!doctype html><html><head><meta charset="utf-8"><title>{TITLE} roadmap</title><style>
@page {{ size: A4; margin: 18mm 16mm 20mm; }}
body {{ font: 10.5pt/1.55 'Segoe UI', system-ui, sans-serif; color: #1c2233; }}
h1 {{ font-size: 22pt; color: {INK}; margin: 0 0 4pt; border-bottom: 3pt solid {ACCENT}; padding-bottom: 6pt; }}
h2 {{ font-size: 14pt; color: {INK}; margin: 18pt 0 6pt; }}
h3 {{ font-size: 11.5pt; color: {ACCENT}; margin: 12pt 0 4pt; }}
p {{ margin: 4pt 0; }} code {{ font-size: 9pt; background: #eef2f8; padding: 0 3pt; border-radius: 3pt; }}
ul {{ padding-left: 0; list-style: none; margin: 4pt 0; }}
li {{ position: relative; padding-left: 16pt; margin: 2pt 0; }}
li::before {{ content: '•'; position: absolute; left: 4pt; color: #8a93a8; }}
li.done::before {{ content: '✓'; color: #1f9d6b; font-weight: 700; left: 2pt; }}
li.todo::before {{ content: '○'; color: {ACCENT}; left: 2pt; }}
h2, h3 {{ break-after: avoid; }} li {{ break-inside: avoid; }}
</style></head><body>{body}</body></html>"""

with sync_playwright() as p:
    kw = {"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}
    browser = p.chromium.launch(args=["--no-sandbox"], **kw)
    page = browser.new_page()
    page.set_content(html, wait_until="load")
    page.pdf(path=str(OUT), format="A4", print_background=True,
             display_header_footer=True, header_template="<span></span>",
             footer_template=f'<div style="font:8pt sans-serif;color:#8a93a8;width:100%;text-align:center">{TITLE} roadmap · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>')
    browser.close()
print(f"wrote {OUT.relative_to(ROOT)}")
