#!/usr/bin/env python3
"""
Pulls every row from the Carlam Team Schedule Notion database and writes
several self-contained HTML pages into docs/:

  - index.html               a landing page with links to every schedule
  - schedule-master-<salt>.html   everyone, all teams, in one grid
  - schedule-<team>-<salt>.html   one page per Team option, filtered

All pages use the same grid layout as before - people across, dates down -
and auto-refresh every couple of minutes. Access to individual pages is
controlled separately via Cloudflare Access policies (one policy per team
page), so who sees what is decided in Cloudflare, not by this script.

Runs alongside generate_ics.py and generate_grid.py in the same GitHub
Actions workflow - same Notion data feeds all outputs.
"""

import hashlib
import html
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

# The full staff roster, used to expand a "Everyone" tag on a row into every
# individual person. Keep in step with the "Person Name" select options.
ALL_STAFF = [
    "Iestyn O'Leary", "Bethan Evans", "Ceri Siggins", "Cerys Pinkman",
    "Derwena Burt", "Elin Jones", "Euros Llyr Morgan",
    "Jason Lye-Phillips", "Lara Hughes", "Osian Lewis", "Owain Jones",
    "Rhodri Lewis", "Wil Williams",
]

FILENAME_SALT = os.environ.get("FILENAME_SALT")
if not FILENAME_SALT:
    print(
        "FILENAME_SALT is not set. Refusing to run: without a private salt, "
        "page filenames would be guessable. Add a FILENAME_SALT repository "
        "secret in GitHub (Settings -> Secrets and variables -> Actions) and "
        "re-run.",
        file=sys.stderr,
    )
    sys.exit(1)

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
DATABASE_ID = os.environ["NOTION_DATABASE_ID"]
NOTION_VERSION = "2022-06-28"
OUTPUT_DIR = Path(__file__).parent / "docs"

# The full list of teams. Must match the options on the "Team" select field
# in Notion exactly (case-sensitive).
TEAMS = ["Corporate", "Children", "Digital", "Technical", "Admin", "Factual"]

AUTO_REFRESH_SECONDS = 120

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
}

def programme_colour(programme: str) -> str | None:
    """A consistent pastel colour derived from the programme's name - the
    same programme always gets the same colour, and new programmes get a
    sensible colour automatically without needing to update a hardcoded
    list every time one's added in Notion."""
    if not programme:
        return None
    digest = hashlib.md5(programme.encode("utf-8")).hexdigest()
    hue = int(digest, 16) % 360
    return f"hsl({hue}, 65%, 87%)"


STATUS_COLOURS = {
    "A/L": "#fff2cc",
    "OFF": "#f4cccc",
    "TOIL": "#f4cccc",
    "Offline Edit": "#d9ead3",
    "Online Edit": "#d9ead3",
    "Finishing": "#cfe2f3",
    "Delivery": "#c9daf8",
    "Archive": "#efefef",
    "Priority task": "#f9cb9c",
    "Notes / Changes": "#fff2cc",
    "Tentative": "#ead1dc",
}
DEFAULT_COLOUR = "#ffffff"

# These two statuses matter more operationally than which programme they're
# under, so they get their own bold, consistent colours that override the
# programme colour - a strong blue for Delivery, a strong amber for anyone
# off/on leave, both clearly distinct from the softer programme pastels.
DELIVERY_COLOUR = "#e63946"
LEAVE_COLOUR = "#f5a623"
LEAVE_STATUSES = {"A/L", "TOIL", "OFF"}


def programme_colour(name: str) -> str:
    """
    Generates a consistent pastel colour for any programme name, purely from
    the text itself - so every programme automatically gets its own distinct
    colour, including ones added in future, with nothing to maintain here.
    """
    if not name:
        return ""
    h = 0
    for ch in name:
        h = (h * 31 + ord(ch)) % 360
    return f"hsl({h}, 60%, 85%)"


def entry_colour(status: str, programme: str) -> str:
    if status in LEAVE_STATUSES:
        return LEAVE_COLOUR
    if status == "Delivery":
        return DELIVERY_COLOUR
    return programme_colour(programme)


def page_suffix(name: str) -> str:
    """Same salted-hash approach as the other scripts, one per page name."""
    return hashlib.sha256(f"{FILENAME_SALT}:{name}".encode()).hexdigest()[:8]


def slugify(name: str) -> str:
    return name.lower().replace(" ", "-")


def fetch_all_rows():
    rows = []
    payload = {"page_size": 100}
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"
    while True:
        resp = requests.post(url, headers=HEADERS, json=payload)
        resp.raise_for_status()
        data = resp.json()
        rows.extend(data["results"])
        if not data.get("has_more"):
            break
        payload["start_cursor"] = data["next_cursor"]
    return rows


def get_plain_text(rich_text_list):
    return "".join(t.get("plain_text", "") for t in rich_text_list) if rich_text_list else ""


def extract_row(page):
    props = page["properties"]
    title = get_plain_text(props.get("Task", {}).get("title", []))
    date_prop = props.get("Date", {}).get("date")
    start_date = date_prop["start"][:10] if date_prop else None
    programme = (props.get("Programme", {}).get("select") or {}).get("name", "")
    status = (props.get("Status", {}).get("status") or props.get("Status", {}).get("select") or {}).get("name", "")
    notes = get_plain_text(props.get("Notes", {}).get("rich_text", []))
    team = (props.get("Team", {}).get("select") or {}).get("name", "")
    people = [p.get("name", "Unknown") for p in props.get("Person", {}).get("people", [])]
    person_name_prop = props.get("Person Name", {})
    if "select" in person_name_prop:
        person_name_text = (person_name_prop.get("select") or {}).get("name", "")
    else:
        person_name_text = get_plain_text(person_name_prop.get("rich_text", []))
    if person_name_text:
        people = ALL_STAFF if person_name_text == "Everyone" else [person_name_text]
    return {
        "title": title,
        "start_date": start_date,
        "programme": programme,
        "status": status,
        "notes": notes,
        "team": team,
        "people": people,
    }


def cell_html(entries) -> str:
    if not entries:
        return ""
    blocks = []
    for e in entries:
        parts = [p for p in [e["programme"], e["status"], e["title"]] if p]
        main = html.escape(" - ".join(parts) if parts else "")
        colour = entry_colour(e["status"], e["programme"])
        style_attr = f' style="background:{colour}"' if colour else ""
        block = f'<div class="entry"{style_attr}>{main}'
        if e["notes"]:
            block += f'<div class="notes">{html.escape(e["notes"])}</div>'
        block += "</div>"
        blocks.append(block)
    return "".join(blocks)


# --- Shared theming system -------------------------------------------------
# Mirrors the same theme constants in worker.js exactly, so a theme picked
# on any page (homepage, trackers, personal schedule) looks identical here
# too. Task/programme colours are never part of this - they're always set
# as direct inline styles in cell_html() and stay fixed regardless of theme.
THEME_VARS_CSS = """
  :root, [data-theme="dark"] {
    --bg: #0b0b0c;
    --surface: #17171a;
    --surface-hover: #1f1f23;
    --border: #2a2a2e;
    --text: #f5f5f3;
    --text-dim: #8b8b90;
    --accent: #3f7fd1;
  }
  [data-theme="light"] {
    --bg: #fafafa;
    --surface: #ffffff;
    --surface-hover: #f0f0f0;
    --border: #e0e0e0;
    --text: #1a1a1a;
    --text-dim: #666666;
    --accent: #3f7fd1;
  }
  [data-theme="midnight"] {
    --bg: #0a0e17;
    --surface: #131a2b;
    --surface-hover: #1b2438;
    --border: #232f45;
    --text: #e8ecf5;
    --text-dim: #7a8699;
    --accent: #5b8dd9;
  }
  [data-theme="pink"] {
    --bg: hsl(330, 25%, 7%);
    --surface: hsl(330, 20%, 12%);
    --surface-hover: hsl(330, 18%, 16%);
    --border: hsl(330, 16%, 20%);
    --text: hsl(330, 12%, 95%);
    --text-dim: hsl(330, 10%, 63%);
    --accent: hsl(330, 70%, 58%);
  }
  [data-theme="red"] {
    --bg: hsl(355, 25%, 7%);
    --surface: hsl(355, 20%, 12%);
    --surface-hover: hsl(355, 18%, 16%);
    --border: hsl(355, 16%, 20%);
    --text: hsl(355, 12%, 95%);
    --text-dim: hsl(355, 10%, 63%);
    --accent: hsl(355, 70%, 58%);
  }
  [data-theme="green"] {
    --bg: hsl(150, 25%, 7%);
    --surface: hsl(150, 20%, 12%);
    --surface-hover: hsl(150, 18%, 16%);
    --border: hsl(150, 16%, 20%);
    --text: hsl(150, 12%, 95%);
    --text-dim: hsl(150, 10%, 63%);
    --accent: hsl(150, 70%, 58%);
  }
  [data-theme="blue"] {
    --bg: hsl(215, 25%, 7%);
    --surface: hsl(215, 20%, 12%);
    --surface-hover: hsl(215, 18%, 16%);
    --border: hsl(215, 16%, 20%);
    --text: hsl(215, 12%, 95%);
    --text-dim: hsl(215, 10%, 63%);
    --accent: hsl(215, 70%, 58%);
  }
  [data-theme="purple"] {
    --bg: hsl(265, 25%, 7%);
    --surface: hsl(265, 20%, 12%);
    --surface-hover: hsl(265, 18%, 16%);
    --border: hsl(265, 16%, 20%);
    --text: hsl(265, 12%, 95%);
    --text-dim: hsl(265, 10%, 63%);
    --accent: hsl(265, 70%, 58%);
  }
  [data-theme="orange"] {
    --bg: hsl(25, 25%, 7%);
    --surface: hsl(25, 20%, 12%);
    --surface-hover: hsl(25, 18%, 16%);
    --border: hsl(25, 16%, 20%);
    --text: hsl(25, 12%, 95%);
    --text-dim: hsl(25, 10%, 63%);
    --accent: hsl(25, 70%, 58%);
  }
  [data-theme="light-blue"] {
    --bg: hsl(205, 45%, 96%);
    --surface: hsl(205, 35%, 99%);
    --surface-hover: hsl(205, 35%, 92%);
    --border: hsl(205, 30%, 85%);
    --text: hsl(205, 35%, 15%);
    --text-dim: hsl(205, 15%, 42%);
    --accent: hsl(205, 75%, 45%);
  }
"""

THEME_BOOTSTRAP_SCRIPT = """<script>
(function () {
  var m = document.cookie.match(/(?:^|; )carlam_theme=([^;]+)/);
  var theme = m ? decodeURIComponent(m[1]) : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
})();
</script>"""

THEME_PICKER_CSS = """
  .theme-picker { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; max-width: 200px; }
  .theme-swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--border);
    cursor: pointer;
    padding: 0;
  }
  .theme-swatch[data-theme-btn="midnight"] { background: #5b8dd9; }
  .theme-swatch[data-theme-btn="pink"] { background: hsl(330, 70%, 58%); }
  .theme-swatch[data-theme-btn="red"] { background: hsl(355, 70%, 58%); }
  .theme-swatch[data-theme-btn="green"] { background: hsl(150, 70%, 58%); }
  .theme-swatch[data-theme-btn="blue"] { background: hsl(215, 70%, 58%); }
  .theme-swatch[data-theme-btn="purple"] { background: hsl(265, 70%, 58%); }
  .theme-swatch[data-theme-btn="orange"] { background: hsl(25, 70%, 58%); }
  .theme-swatch[data-theme-btn="light-blue"] { background: hsl(205, 75%, 45%); }
  .theme-swatch[data-theme-btn="dark"], .theme-swatch[data-theme-btn="light"] {
    background: linear-gradient(135deg, #0b0b0c 50%, #fafafa 50%);
  }
  .theme-swatch.active { border-color: #fff; box-shadow: 0 0 0 1px var(--accent); }
"""

THEME_PICKER_HTML = """<div class="theme-picker" title="Theme">
  <button class="theme-swatch" data-theme-btn="dark" aria-label="Dark theme"></button>
  <button class="theme-swatch" data-theme-btn="light" aria-label="Light theme"></button>
  <button class="theme-swatch" data-theme-btn="midnight" aria-label="Midnight theme"></button>
  <button class="theme-swatch" data-theme-btn="pink" aria-label="Pink theme"></button>
  <button class="theme-swatch" data-theme-btn="red" aria-label="Red theme"></button>
  <button class="theme-swatch" data-theme-btn="green" aria-label="Green theme"></button>
  <button class="theme-swatch" data-theme-btn="blue" aria-label="Blue theme"></button>
  <button class="theme-swatch" data-theme-btn="purple" aria-label="Purple theme"></button>
  <button class="theme-swatch" data-theme-btn="orange" aria-label="Orange theme"></button>
  <button class="theme-swatch" data-theme-btn="light-blue" aria-label="Light blue theme"></button>
</div>"""

THEME_PICKER_SCRIPT = """<script>
(function () {
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  document.querySelectorAll('.theme-swatch').forEach(function (btn) {
    if (btn.getAttribute('data-theme-btn') === current) btn.classList.add('active');
    btn.addEventListener('click', function () {
      var theme = this.getAttribute('data-theme-btn');
      document.cookie = 'carlam_theme=' + theme + '; path=/; max-age=31536000';
      location.reload();
    });
  });
})();
</script>"""

PAGE_STYLE = """
  body {
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  .top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  h1 {
    font-size: 20px;
    margin: 0 0 4px 0;
    flex-shrink: 0;
  }
  .meta {
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 16px;
    flex-shrink: 0;
  }
  .table-wrap {
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  table {
    border-collapse: collapse;
    min-width: 100%;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 6px;
    text-align: left;
    vertical-align: top;
    font-size: 13px;
    white-space: nowrap;
    min-width: 140px;
    color: var(--text);
  }
  td {
    white-space: normal;
  }
  .scroll-hint {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12px;
    color: #7a5b00;
    background: #fffbe6;
    border: 1px solid #f0e0a0;
    border-radius: 6px;
    padding: 6px 10px;
    margin-bottom: 10px;
    flex-shrink: 0;
  }
  .scroll-hint.visible {
    display: flex;
  }
  thead th {
    position: sticky;
    top: 0;
    background: #333;
    color: #fff;
    z-index: 2;
  }
  .daterow {
    position: sticky;
    left: 0;
    background: var(--surface);
    color: var(--text);
    z-index: 1;
    font-weight: 600;
  }
  thead th.daterow {
    background: #333;
    color: #fff;
    z-index: 3;
  }
  tr.weekend .daterow {
    background: var(--surface-hover);
    border-left: 4px solid var(--text-dim);
  }
  tr.weekend td {
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }
  tr.today .daterow {
    background: var(--accent);
    color: #fff;
    border-left: 4px solid var(--accent);
  }
  tr.today td {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-top: 1px solid var(--accent);
    border-bottom: 1px solid var(--accent);
  }
  .past-toggle-row td {
    padding: 0;
    border: none;
  }
  .past-toggle-wrap {
    padding: 6px 0 12px 0;
  }
  .past-toggle {
    font-size: 13px;
    font-family: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 14px;
    cursor: pointer;
    color: var(--text);
  }
  .past-toggle:hover {
    background: var(--surface-hover);
  }
  tbody.past-weeks {
    display: none;
  }
  tbody.past-weeks.expanded {
    display: table-row-group;
  }
  .entry {
    padding: 4px 6px;
    margin-bottom: 5px;
    border-radius: 4px;
    border: 1px solid #b0b0b0;
    background: #f2f2f2;
  }
  .entry:last-child {
    margin-bottom: 0;
  }
  .entry, .entry * {
    color: #1a1a1a;
  }
  .notes {
    font-size: 11px;
    color: #444;
    font-style: italic;
  }
  a.back {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--text-dim);
    text-decoration: none;
    flex-shrink: 0;
  }
  a.back:hover {
    text-decoration: underline;
  }
"""


def build_html(rows, page_title, back_link=None) -> str:
    people = sorted({p for r in rows for p in r["people"]})
    dated_rows = [r for r in rows if r["start_date"]]

    if not dated_rows:
        min_date = max_date = date.today()
    else:
        all_dates = [date.fromisoformat(r["start_date"]) for r in dated_rows]
        min_date = min(all_dates)
        max_date = max(all_dates)

    grid = defaultdict(list)
    for r in dated_rows:
        d = date.fromisoformat(r["start_date"])
        for person in r["people"]:
            grid[(d, person)].append(r)

    header_cells = "".join(f"<th>{html.escape(p)}</th>" for p in people)

    # Everything before the Monday of the current week gets tucked away
    # behind a toggle, so people land on "this week onward" by default
    # instead of scrolling past months of old entries.
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())

    past_rows = []
    current_rows = []
    current = min_date
    last_shown_year = None
    while current <= max_date:
        is_weekend = current.weekday() >= 5
        is_today = current == today
        row_classes = []
        if is_weekend:
            row_classes.append("weekend")
        if is_today:
            row_classes.append("today")
        row_class_attr = f' class="{" ".join(row_classes)}"' if row_classes else ""

        if current.year != last_shown_year:
            date_label = html.escape(current.strftime("%a %d %b %Y"))
            last_shown_year = current.year
        else:
            date_label = html.escape(current.strftime("%a %d %b"))
        cells = [f"<th class='daterow'>{date_label}</th>"]
        for person in people:
            entries = grid.get((current, person), [])
            if not entries and is_weekend:
                colour = "#eaeaea"
            else:
                colour = "transparent"
            style = f' style="background:{colour}"' if colour != "transparent" else ""
            cells.append(f"<td{style}>{cell_html(entries)}</td>")
        row_html = f"<tr{row_class_attr}>{''.join(cells)}</tr>"

        if current < start_of_week:
            past_rows.append(row_html)
        else:
            current_rows.append(row_html)

        current += timedelta(days=1)

    generated_at = datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")
    back_html = f'<a class="back" href="{back_link}">&larr; All schedules</a>' if back_link else ""

    if not people:
        table_html = '<p style="color:#666;font-size:14px;">No entries tagged for this team yet.</p>'
    else:
        col_count = len(people) + 1
        toggle_row = ""
        past_tbody = ""
        if past_rows:
            toggle_row = f"""<tbody>
        <tr class="past-toggle-row"><td colspan="{col_count}">
          <div class="past-toggle-wrap">
            <button type="button" class="past-toggle" onclick="
              var wrap = document.getElementById('tableWrap');
              var pw = document.getElementById('past-weeks');
              var beforeHeight = wrap.scrollHeight;
              var expanded = pw.classList.toggle('expanded');
              var afterHeight = wrap.scrollHeight;
              wrap.scrollTop += (afterHeight - beforeHeight);
              this.textContent = expanded ? '\u2191 Hide earlier weeks' : '\u2193 Show earlier weeks ({len(past_rows)} days)';
            ">&darr; Show earlier weeks ({len(past_rows)} days)</button>
          </div>
        </td></tr>
      </tbody>"""
            past_tbody = f"""<tbody id="past-weeks" class="past-weeks">
        {''.join(past_rows)}
      </tbody>"""

        table_html = f"""<div class="scroll-hint" id="scrollHint">&larr; Scroll sideways to see everyone &rarr;</div>
  <div class="table-wrap" id="tableWrap">
    <table>
      <thead>
        <tr><th class="daterow">Date</th>{header_cells}</tr>
      </thead>
      {past_tbody}
      {toggle_row}
      <tbody>
        {''.join(current_rows)}
      </tbody>
    </table>
  </div>"""

    scroll_hint_script = """
  <script>
    (function () {
      var wrap = document.getElementById('tableWrap');
      var hint = document.getElementById('scrollHint');
      if (!wrap || !hint) return;
      function checkOverflow() {
        if (wrap.scrollWidth > wrap.clientWidth + 2) {
          hint.classList.add('visible');
        } else {
          hint.classList.remove('visible');
        }
      }
      checkOverflow();
      window.addEventListener('resize', checkOverflow);
      wrap.addEventListener('scroll', function () {
        // Hide the hint once the person's actually scrolled, so it
        // doesn't sit there nagging after they've found it.
        if (wrap.scrollLeft > 10) {
          hint.classList.remove('visible');
        }
      });
    })();
  </script>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="{AUTO_REFRESH_SECONDS}">
{THEME_BOOTSTRAP_SCRIPT}
<title>{html.escape(page_title)}</title>
<style>{THEME_VARS_CSS}{THEME_PICKER_CSS}{PAGE_STYLE}</style>
</head>
<body>
  <div class="top-row">
    {back_html}
    {THEME_PICKER_HTML}
  </div>
  <h1>{html.escape(page_title)}</h1>
  <div class="meta">Last updated {generated_at} &middot; refreshes automatically every {AUTO_REFRESH_SECONDS // 60} minutes &middot; keep this tab open for a live view</div>
  {table_html}
  {scroll_hint_script if people else ""}
  {THEME_PICKER_SCRIPT}
</body>
</html>
"""


def build_index_html(links) -> str:
    """links: list of (label, filename, description) tuples."""
    items = "".join(
        f'<li><a href="{fn}">{html.escape(label)}</a><div class="desc">{html.escape(desc)}</div></li>'
        for label, fn, desc in links
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carlam Schedules</title>
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 24px 16px;
    background: #fafafa;
    color: #1a1a1a;
    max-width: 480px;
  }}
  h1 {{
    font-size: 22px;
    margin: 0 0 20px 0;
  }}
  ul {{
    list-style: none;
    margin: 0;
    padding: 0;
  }}
  li {{
    margin-bottom: 12px;
  }}
  li a {{
    display: block;
    padding: 14px 16px;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    text-decoration: none;
    color: #1a1a1a;
    font-weight: 600;
    font-size: 15px;
  }}
  li a:hover {{
    border-color: #999;
  }}
  .desc {{
    font-size: 12px;
    color: #777;
    padding: 4px 16px 0 16px;
  }}
</style>
</head>
<body>
  <h1>Carlam Schedules</h1>
  <ul>
    {items}
  </ul>
</body>
</html>
"""


def main():
    print("Fetching rows from Notion...")
    pages = fetch_all_rows()
    rows = [extract_row(p) for p in pages]
    print(f"Fetched {len(rows)} rows.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    index_links = []

    # Master page - everyone, every team
    master_suffix = page_suffix("schedule-master")
    master_filename = f"schedule-master-{master_suffix}.html"
    master_html = build_html(rows, "Carlam Team Schedule - All Teams", back_link="index.html")
    (OUTPUT_DIR / master_filename).write_text(master_html, encoding="utf-8")
    print(f"Wrote {master_filename} ({len(rows)} rows, all teams)")
    index_links.append(("All Teams (Master)", master_filename, "Everyone, every team, in one grid"))

    # One page per team
    for team in TEAMS:
        team_rows = [r for r in rows if r["team"] == team]
        suffix = page_suffix(f"schedule-{team}")
        filename = f"schedule-{slugify(team)}-{suffix}.html"
        team_html = build_html(team_rows, f"Carlam Team Schedule - {team}", back_link="index.html")
        (OUTPUT_DIR / filename).write_text(team_html, encoding="utf-8")
        print(f"Wrote {filename} ({len(team_rows)} rows, {team})")
        index_links.append((team, filename, f"{team} team schedule"))

    # Annual Leave - a special cross-team page showing only rows with
    # Status = A/L, across every team. Restricted to a small list of people
    # via its own Cloudflare Access policy (see worker.js's homepage link
    # logic and the matching Access application), not shown to everyone.
    al_rows = [r for r in rows if r["status"] in ("A/L", "A/L (Half Day)")]
    al_suffix = page_suffix("schedule-annual-leave")
    al_filename = f"schedule-annual-leave-{al_suffix}.html"
    al_html = build_html(al_rows, "Carlam Team Schedule - Annual Leave", back_link="index.html")
    (OUTPUT_DIR / al_filename).write_text(al_html, encoding="utf-8")
    print(f"Wrote {al_filename} ({len(al_rows)} A/L rows)")

    # Landing page - deliberately at a fixed, unsalted name (index.html) since
    # it's meant to be found. Actual privacy is enforced per-page by
    # Cloudflare Access policies, not by hiding this list.
    index_html = build_index_html(index_links)
    (OUTPUT_DIR / "index.html").write_text(index_html, encoding="utf-8")
    print("Wrote index.html")

    # A small timestamp file so the Worker's personalized homepage can show
    # a real "last synced" readout, not just the visitor's own clock.
    # Uses Europe/London so it automatically shows the correct time whether
    # it's GMT or British Summer Time, rather than a fixed UTC offset.
    import json as _json
    uk_now = datetime.now(ZoneInfo("Europe/London"))
    sync_info = {
        "synced_at": uk_now.strftime("%H:%M:%S"),
        "synced_at_iso": datetime.now(ZoneInfo("UTC")).isoformat(),
    }
    (OUTPUT_DIR / "last-sync.json").write_text(_json.dumps(sync_info), encoding="utf-8")
    print("Wrote last-sync.json")

    # Raw row data as JSON, so the Worker can build a personalised "My
    # Schedule" page on the fly for whoever's actually logged in, without
    # needing a separate static file per person.
    (OUTPUT_DIR / "schedule-data.json").write_text(_json.dumps(rows), encoding="utf-8")
    print(f"Wrote schedule-data.json ({len(rows)} rows)")


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"Notion API error: {e.response.status_code} {e.response.text}", file=sys.stderr)
        sys.exit(1)
