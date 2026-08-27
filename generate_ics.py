#!/usr/bin/env python3
"""
Pulls every row from the Carlam Team Schedule Notion database and writes
one .ics calendar file per person into docs/, ready to be served for
free by GitHub Pages and subscribed to from Outlook, Google Calendar,
Apple Calendar, etc.

Runs on a schedule via GitHub Actions - see .github/workflows/sync.yml
No paid service is involved anywhere in this pipeline.
"""

import hashlib
import os
import re
import sys
import unicodedata
from datetime import datetime, date
from pathlib import Path

import requests

# The full staff roster, used to expand a "Everyone" tag on a row into every
# individual person - so a single company-wide event (e.g. an all-staff
# meeting) shows up on every calendar and personal schedule automatically,
# without needing multi-select tagging. Keep this in step with the actual
# options on the "Person Name" select field in Notion.
ALL_STAFF = [
    "Iestyn O'Leary", "Bethan Evans", "Ceri Siggins", "Cerys Pinkman",
    "Derwena Burt", "Elin Jones", "Euros Llyr Morgan", "Hannah Holton",
    "Jason Lye-Phillips", "Lara Hughes", "Osian Lewis", "Owain Jones",
    "Rhodri Lewis", "Wil Williams",
]

# A private, unguessable suffix mixed into every filename, so links can't be
# derived just by knowing someone's name - even by someone reading this
# script, since the actual value is never stored here. It must be supplied
# as the FILENAME_SALT secret (see .github/workflows/sync.yml). Without it
# set, the script refuses to run rather than silently using a public value.
FILENAME_SALT = os.environ.get("FILENAME_SALT")
if not FILENAME_SALT:
    print(
        "FILENAME_SALT is not set. Refusing to run: without a private salt, "
        "filenames would be guessable from names alone. Add a FILENAME_SALT "
        "repository secret in GitHub (Settings -> Secrets and variables -> "
        "Actions) and re-run.",
        file=sys.stderr,
    )
    sys.exit(1)

NOTION_TOKEN = os.environ["NOTION_TOKEN"]
DATABASE_ID = os.environ["NOTION_DATABASE_ID"]
NOTION_VERSION = "2022-06-28"
OUTPUT_DIR = Path(__file__).parent / "docs"

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
}


def slugify(name: str) -> str:
    """Turn a person's name into a safe filename, e.g. 'Ceri S' -> 'ceri-s'."""
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return slug or "unknown"


def fetch_all_rows():
    """Query the Notion database, following pagination until done."""
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
    start_date = date_prop["start"] if date_prop else None
    end_date = date_prop.get("end") if date_prop else None
    is_datetime = bool(date_prop and "T" in (date_prop.get("start") or ""))

    programme = (props.get("Programme", {}).get("select") or {}).get("name", "")
    status = (props.get("Status", {}).get("status") or props.get("Status", {}).get("select") or {}).get("name", "")
    notes = get_plain_text(props.get("Notes", {}).get("rich_text", []))

    # Real Notion members/guests linked via the Person property
    people = [p.get("name", "Unknown") for p in props.get("Person", {}).get("people", [])]

    # Fallback: temporary plain-text name for anyone not yet added to Notion
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
        "end_date": end_date,
        "is_datetime": is_datetime,
        "programme": programme,
        "status": status,
        "notes": notes,
        "people": people,
        "page_id": page["id"],
        "last_edited": page.get("last_edited_time", ""),
    }


def fold_ics_line(line: str) -> str:
    """iCalendar spec: lines must be folded at 75 octets."""
    if len(line) <= 75:
        return line
    parts = [line[:75]]
    rest = line[75:]
    while rest:
        parts.append(" " + rest[:74])
        rest = rest[74:]
    return "\r\n".join(parts)


def escape_ics_text(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def build_vevent(row) -> str:
    if not row["start_date"]:
        return ""

    start = row["start_date"].replace("-", "")[:8]
    if row["end_date"]:
        end_date_obj = date.fromisoformat(row["end_date"][:10])
    else:
        end_date_obj = date.fromisoformat(row["start_date"][:10])
    end = end_date_obj.strftime("%Y%m%d")

    summary_parts = [p for p in [row["programme"], row["status"], row["title"]] if p]
    summary = escape_ics_text(" - ".join(summary_parts) or "Untitled")

    description_lines = []
    if row["programme"]:
        description_lines.append(f"Programme: {row['programme']}")
    if row["status"]:
        description_lines.append(f"Status: {row['status']}")
    if row["notes"]:
        description_lines.append(f"Notes: {row['notes']}")
    description = escape_ics_text("\\n".join(description_lines))

    uid = f"{row['page_id']}@carlam-schedule"
    dtstamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;VALUE=DATE:{start}",
        f"DTEND;VALUE=DATE:{end}",
        f"SUMMARY:{summary}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{description}")
    if row["programme"]:
        lines.append(f"CATEGORIES:{escape_ics_text(row['programme'])}")
    lines.append("END:VEVENT")

    return "\r\n".join(fold_ics_line(l) for l in lines)


def build_calendar(person_name: str, rows) -> str:
    header = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Carlam Schedule Sync//Notion to ICS//EN",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:Carlam Schedule - {escape_ics_text(person_name)}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
        "X-PUBLISHED-TTL:PT30M",
    ]
    body = [build_vevent(r) for r in rows if r["start_date"]]
    footer = ["END:VCALENDAR"]
    return "\r\n".join(header + [b for b in body if b] + footer) + "\r\n"


def main():
    print("Fetching rows from Notion...")
    pages = fetch_all_rows()
    rows = [extract_row(p) for p in pages]
    print(f"Fetched {len(rows)} rows.")

    by_person: dict[str, list] = {}
    for row in rows:
        if not row["people"]:
            continue
        for person in row["people"]:
            by_person.setdefault(person, []).append(row)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # No index/README is written here on purpose - listing everyone's name and
    # filename on the public site would be the one thing pointing people at
    # each other's calendar links. Keeping the docs folder free of any index
    # means the only way to find a link is if you were personally given it.
    for person, person_rows in sorted(by_person.items()):
        slug = slugify(person)
        suffix = hashlib.sha256(f"{FILENAME_SALT}:{person}".encode()).hexdigest()[:8]
        ics_content = build_calendar(person, person_rows)
        out_path = OUTPUT_DIR / f"{slug}-{suffix}.ics"
        out_path.write_text(ics_content, encoding="utf-8")
        print(f"Wrote {out_path} ({len(person_rows)} events) for {person}")

    (OUTPUT_DIR / ".nojekyll").write_text("", encoding="utf-8")

    print("Done.")


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"Notion API error: {e.response.status_code} {e.response.text}", file=sys.stderr)
        sys.exit(1)
