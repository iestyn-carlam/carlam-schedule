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
        people = [person_name_text]
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
        block = f'<div class="entry">{main}'
        if e["notes"]:
            block += f'<div class="notes">{html.escape(e["notes"])}</div>'
        block += "</div>"
        blocks.append(block)
    return "".join(blocks)


PAGE_STYLE = """
  body {
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: #fafafa;
    color: #1a1a1a;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  h1 {
    font-size: 20px;
    margin: 0 0 4px 0;
    flex-shrink: 0;
  }
  .meta {
    font-size: 13px;
    color: #666;
    margin-bottom: 16px;
    flex-shrink: 0;
  }
  .table-wrap {
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    border: 1px solid #ddd;
    border-radius: 6px;
  }
  table {
    border-collapse: collapse;
    min-width: 100%;
  }
  th, td {
    border: 1px solid #e0e0e0;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
    font-size: 13px;
    white-space: nowrap;
    min-width: 140px;
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
    color: #666;
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
    background: #f0f0f0;
    z-index: 1;
    font-weight: 600;
  }
  thead th.daterow {
    background: #333;
    color: #fff;
    z-index: 3;
  }
  tr.weekend .daterow {
    background: #d6d6d6;
    border-left: 4px solid #999;
  }
  tr.weekend td {
    border-top: 1px solid #ccc;
    border-bottom: 1px solid #ccc;
  }
  tr.today .daterow {
    background: #3f7fd1;
    color: #fff;
    border-left: 4px solid #26518f;
  }
  tr.today td {
    background: rgba(63, 127, 209, 0.10);
    border-top: 1px solid #3f7fd1;
    border-bottom: 1px solid #3f7fd1;
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
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 6px;
    padding: 8px 14px;
    cursor: pointer;
    color: #333;
  }
  .past-toggle:hover {
    background: #f0f0f0;
  }
  tbody.past-weeks {
    display: none;
  }
  tbody.past-weeks.expanded {
    display: table-row-group;
  }
  .entry {
    margin-bottom: 4px;
  }
  .entry:last-child {
    margin-bottom: 0;
  }
  .notes {
    font-size: 11px;
    color: #555;
    font-style: italic;
  }
  a.back {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: #333;
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
            if entries:
                colour = STATUS_COLOURS.get(entries[0]["status"], DEFAULT_COLOUR)
            elif is_weekend:
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
              var pw = document.getElementById('past-weeks');
              var expanded = pw.classList.toggle('expanded');
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
<title>{html.escape(page_title)}</title>
<style>{PAGE_STYLE}</style>
</head>
<body>
  {back_html}
  <h1>{html.escape(page_title)}</h1>
  <div class="meta">Last updated {generated_at} &middot; refreshes automatically every {AUTO_REFRESH_SECONDS // 60} minutes &middot; keep this tab open for a live view</div>
  {table_html}
  {scroll_hint_script if people else ""}
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
    sync_info = {"synced_at": uk_now.strftime("%H:%M:%S")}
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
