#!/usr/bin/env python3
"""
Pulls every row from the Carlam Team Schedule Notion database and writes a
single self-contained HTML page (docs/schedule-<salt>.html) showing the same
grid layout as the Excel version - people across, dates down - but viewable
directly in a browser with no download step.

The page auto-refreshes itself every couple of minutes, so as long as
someone keeps the tab open (or reopens the link), they're looking at data
that's at most a few minutes old, in step with the sync schedule.

Runs alongside generate_ics.py and generate_grid.py in the same GitHub
Actions workflow - same Notion data feeds all three outputs.
"""

import hashlib
import html
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

# Reuses the same private salt as the other scripts, so this page's filename
# is just as unguessable as the calendar and spreadsheet links.
FILENAME_SALT = os.environ.get("FILENAME_SALT")
if not FILENAME_SALT:
    print(
        "FILENAME_SALT is not set. Refusing to run: without a private salt, "
        "the page filename would be guessable. Add a FILENAME_SALT repository "
        "secret in GitHub (Settings -> Secrets and variables -> Actions) and "
        "re-run.",
        file=sys.stderr,
    )
    sys.exit(1)

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
DATABASE_ID = os.environ["NOTION_DATABASE_ID"]
NOTION_VERSION = "2022-06-28"
OUTPUT_DIR = Path(__file__).parent / "docs"
PAGE_SUFFIX = hashlib.sha256(f"{FILENAME_SALT}:schedule-page".encode()).hexdigest()[:8]
OUTPUT_FILE = OUTPUT_DIR / f"schedule-{PAGE_SUFFIX}.html"

# How often the page reloads itself in the browser, in seconds. Keep this in
# step with the GitHub Actions sync interval (currently every 5 minutes).
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
    people = [p.get("name", "Unknown") for p in props.get("Person", {}).get("people", [])]
    person_name_text = get_plain_text(props.get("Person Name", {}).get("rich_text", []))
    if not people and person_name_text:
        people = [person_name_text]
    return {
        "title": title,
        "start_date": start_date,
        "programme": programme,
        "status": status,
        "notes": notes,
        "people": people,
    }


def cell_html(entries) -> str:
    if not entries:
        return ""
    blocks = []
    for e in entries:
        parts = [p for p in [e["status"], e["programme"] or e["title"]] if p]
        main = html.escape(" - ".join(parts) if parts else (e["title"] or ""))
        block = f'<div class="entry">{main}'
        if e["notes"]:
            block += f'<div class="notes">{html.escape(e["notes"])}</div>'
        block += "</div>"
        blocks.append(block)
    return "".join(blocks)


def build_html(rows) -> str:
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

    body_rows = []
    current = min_date
    today = date.today()
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

        # Only show the year when it's the first row, or when it changes from
        # the row before - like a normal calendar, the year is implied
        # otherwise and just adds clutter to every single row.
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
        body_rows.append(f"<tr{row_class_attr}>{''.join(cells)}</tr>")

        current += timedelta(days=1)

    generated_at = datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="{AUTO_REFRESH_SECONDS}">
<title>Carlam Team Schedule</title>
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: #fafafa;
    color: #1a1a1a;
  }}
  h1 {{
    font-size: 20px;
    margin: 0 0 4px 0;
  }}
  .meta {{
    font-size: 13px;
    color: #666;
    margin-bottom: 16px;
  }}
  .table-wrap {{
    overflow-x: auto;
    border: 1px solid #ddd;
    border-radius: 6px;
  }}
  table {{
    border-collapse: collapse;
    min-width: 100%;
  }}
  th, td {{
    border: 1px solid #e0e0e0;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
    font-size: 13px;
    white-space: nowrap;
  }}
  td {{
    white-space: normal;
    min-width: 140px;
  }}
  thead th {{
    position: sticky;
    top: 0;
    background: #333;
    color: #fff;
    z-index: 2;
  }}
  .daterow {{
    position: sticky;
    left: 0;
    background: #f0f0f0;
    z-index: 1;
    font-weight: 600;
  }}
  thead th.daterow {{
    background: #333;
    color: #fff;
    z-index: 3;
  }}
  tr.weekend .daterow {{
    background: #d6d6d6;
    border-left: 4px solid #999;
  }}
  tr.weekend td {{
    border-top: 1px solid #ccc;
    border-bottom: 1px solid #ccc;
  }}
  tr.today .daterow {{
    background: #ffe08a;
  }}
  .entry {{
    margin-bottom: 4px;
  }}
  .entry:last-child {{
    margin-bottom: 0;
  }}
  .notes {{
    font-size: 11px;
    color: #555;
    font-style: italic;
  }}
</style>
</head>
<body>
  <h1>Carlam Team Schedule</h1>
  <div class="meta">Last updated {generated_at} &middot; refreshes automatically every {AUTO_REFRESH_SECONDS // 60} minutes &middot; keep this tab open for a live view</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th class="daterow">Date</th>{header_cells}</tr>
      </thead>
      <tbody>
        {''.join(body_rows)}
      </tbody>
    </table>
  </div>
</body>
</html>
"""


def main():
    print("Fetching rows from Notion...")
    pages = fetch_all_rows()
    rows = [extract_row(p) for p in pages]
    print(f"Fetched {len(rows)} rows.")

    page_html = build_html(rows)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(page_html, encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE}")


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"Notion API error: {e.response.status_code} {e.response.text}", file=sys.stderr)
        sys.exit(1)
