/**
 * Intercepts requests to the homepage and builds a personalized, styled
 * list of schedule links based on who's actually logged in (read from the
 * Cloudflare Access login), instead of showing every team to everyone.
 *
 * Every other file (the actual team pages, calendars, spreadsheet) is left
 * completely alone and served as a normal static file - and, importantly,
 * each of those pages is STILL independently protected by its own
 * Cloudflare Access policy. This script only changes what's *displayed* on
 * the homepage menu; it is not what makes pages secure.
 *
 * IMPORTANT - keep two places in sync when you add a new person:
 *   1. The Cloudflare Access policy for their team (the real lock).
 *   2. The ACCESS_MAP below (just for what shows on their homepage menu).
 */

const TEAM_PAGES = {
  Children: "schedule-children-64585b7f.html",
  Digital: "schedule-digital-fe835502.html",
  Corporate: "schedule-corporate-d2a0bfc5.html",
  Technical: "schedule-technical-62ca0dbf.html",
  Admin: "schedule-admin-578fa55d.html",
  Factual: "schedule-factual-6b97711e.html",
};
const MASTER_FILE = "schedule-master-6bc54781.html";

// A special cross-team page, restricted to a small named list rather than
// the general team/ALL access groups above - only these specific people
// see the link, and (separately) only these people are actually let in via
// their own dedicated Cloudflare Access policy on this exact page path.
const ANNUAL_LEAVE_FILE = "schedule-annual-leave-4b42cdc7.html";
const ANNUAL_LEAVE_VIEWERS = new Set([
  "iestyn@carlamltd.com",
  "eurosllyr@carlamltd.com",
  "derwena@carlamltd.com",
]);

const ACCESS_MAP = {
  "iestyn@carlamltd.com": "ALL",
  "bethan@carlamltd.com": "ALL",
  "ceri@carlamltd.com": ["Digital", "Admin"],
  "cerys@carlamltd.com": ["Children", "Admin"],
  "derwena@carlamltd.com": "ALL",
  "elin@carlamltd.com": "ALL",
  "eurosllyr@carlamltd.com": "ALL",
  "jason@carlamltd.com": ["Children", "Technical", "Admin", "Factual"],
  "lara@carlamltd.com": "ALL",
  "osh@carlamltd.com": ["Digital", "Corporate", "Admin"],
  "owain@carlamltd.com": ["Digital", "Admin"],
  "rhodri@carlamltd.com": ["Digital", "Admin"],
  "wil@carlamltd.com": ["Digital", "Corporate", "Admin"],
};

// Maps each login email to the exact name used in Notion's "Person Name"
// select field, so /my-schedule knows whose rows to show. Must match that
// select field's option spelling exactly (case-sensitive).
const EMAIL_TO_NAME = {
  "iestyn@carlamltd.com": "Iestyn O'Leary",
  "bethan@carlamltd.com": "Bethan Evans",
  "ceri@carlamltd.com": "Ceri Siggins",
  "cerys@carlamltd.com": "Cerys Pinkman",
  "derwena@carlamltd.com": "Derwena Burt",
  "elin@carlamltd.com": "Elin Jones",
  "eurosllyr@carlamltd.com": "Euros Llyr Morgan",
  "jason@carlamltd.com": "Jason Lye-Phillips",
  "lara@carlamltd.com": "Lara Hughes",
  "osh@carlamltd.com": "Osian Lewis",
  "owain@carlamltd.com": "Owain Jones",
  "rhodri@carlamltd.com": "Rhodri Lewis",
  "wil@carlamltd.com": "Wil Williams",
};

function decodeAccessEmail(request) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return null;
  try {
    const payloadPart = jwt.split(".")[1];
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json);
    return (payload.email || "").toLowerCase();
  } catch (err) {
    return null;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PAGE_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');

  :root {
    --bg: #0b0b0c;
    --surface: #17171a;
    --surface-hover: #1f1f23;
    --border: #2a2a2e;
    --text: #f5f5f3;
    --text-dim: #8b8b90;
    --accent: #3f7fd1;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    display: flex;
    justify-content: center;
    padding: 48px 20px 64px;
  }
  .page { width: 100%; max-width: 440px; }
  .logo-wrap { text-align: center; margin-bottom: 28px; }
  .logo-wrap img { width: 120px; height: auto; display: inline-block; }
  h1 {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 26px;
    letter-spacing: -0.01em;
    margin: 0 0 10px 0;
    text-align: center;
  }
  .status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 32px;
    letter-spacing: 0.02em;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 0 rgba(63, 127, 209, 0.6);
    animation: pulse 2.2s infinite;
    flex-shrink: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; }
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(63, 127, 209, 0.55); }
    70%  { box-shadow: 0 0 0 7px rgba(63, 127, 209, 0); }
    100% { box-shadow: 0 0 0 0 rgba(63, 127, 209, 0); }
  }
  ul.links { list-style: none; margin: 0; padding: 0; }
  ul.links li { margin-bottom: 10px; }
  ul.links a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  ul.links a:hover, ul.links a:focus-visible {
    background: var(--surface-hover);
    border-color: #3a3a3f;
  }
  ul.links a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .tri {
    flex-shrink: 0;
    width: 0;
    height: 0;
    border-top: 6px solid transparent;
    border-bottom: 6px solid transparent;
    border-left: 9px solid var(--accent);
  }
  .link-text { display: flex; flex-direction: column; gap: 2px; }
  .link-label {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 500;
    font-size: 15px;
  }
  .link-desc { font-size: 12px; color: var(--text-dim); }
  .empty {
    padding: 16px 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text-dim);
    font-size: 14px;
    text-align: center;
  }
`;

function renderIndex(email, syncedAt) {
  const entry = email ? ACCESS_MAP[email] : undefined;
  const links = [];

  if (email && EMAIL_TO_NAME[email]) {
    links.push(["My Schedule", "my-schedule", "Just your own tasks, day by day"]);
  }

  if (email && ANNUAL_LEAVE_VIEWERS.has(email)) {
    links.push(["Annual Leave", ANNUAL_LEAVE_FILE, "Everyone's annual leave, all teams, in one view"]);
    links.push(["Annual Leave Tracker", LEAVE_TRACKER_PATH.slice(1), "Set allowances and see days used"]);
  }

  if (entry === "ALL") {
    links.push(["All Teams (Master)", MASTER_FILE, "Everyone, every team, in one grid"]);
    for (const [team, file] of Object.entries(TEAM_PAGES)) {
      links.push([team, file, `${team} team schedule`]);
    }
  } else if (Array.isArray(entry)) {
    for (const team of entry) {
      if (TEAM_PAGES[team]) {
        links.push([team, TEAM_PAGES[team], `${team} team schedule`]);
      }
    }
  }

  const itemsHtml = links.length
    ? links
        .map(
          ([label, file, desc]) => `<li><a href="${file}">
            <span class="tri"></span>
            <span class="link-text">
              <span class="link-label">${escapeHtml(label)}</span>
              <span class="link-desc">${escapeHtml(desc)}</span>
            </span>
          </a></li>`
        )
        .join("")
    : `<li><div class="empty">No schedules are assigned to your account yet.<br>If this looks wrong, check with Iestyn.</div></li>`;

  const statusHtml = syncedAt
    ? `<div class="status"><span class="dot"></span>synced <span>${escapeHtml(syncedAt)}</span></div>`
    : `<div class="status"><span class="dot"></span>live</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carlam Schedules</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="page">
    <div class="logo-wrap"><img src="/carlam-logo.png" alt="Carlam"></div>
    <h1>Schedules</h1>
    ${statusHtml}
    <ul class="links">${itemsHtml}</ul>
  </div>
</body>
</html>`;
}

// These two statuses matter more operationally than which programme they're
// under, so they override the programme colour - a strong blue for
// Delivery, a strong amber for anyone off/on leave. Must match the
// constants in generate_webpage.py exactly.
const DELIVERY_COLOUR = "#e63946";
const LEAVE_COLOUR = "#f5a623";
const LEAVE_STATUSES = new Set(["A/L", "TOIL", "OFF"]);

// Same formula as generate_webpage.py's programme_colour(), so a given
// programme always renders the same pastel colour on both the team grids
// and this personal view - and automatically works for any programme
// added in future, with no list to keep updated.
function programmeColour(name) {
  if (!name) return "";
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return `hsl(${h}, 60%, 85%)`;
}

function entryColour(status, programme) {
  if (LEAVE_STATUSES.has(status)) return LEAVE_COLOUR;
  if (status === "Delivery") return DELIVERY_COLOUR;
  return programmeColour(programme) || "#f2f2f2";
}

function renderPersonalSchedule(personName, rows, syncedAt) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const myRows = rows
    .filter((r) => r.start_date && Array.isArray(r.people) && r.people.includes(personName))
    .sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));

  let itemsHtml;
  if (myRows.length === 0) {
    itemsHtml = `<div class="empty">Nothing tagged to you yet. If this looks wrong, check with Iestyn.</div>`;
  } else {
    itemsHtml = myRows
      .map((r) => {
        const d = new Date(r.start_date + "T00:00:00");
        const isToday = d.getTime() === today.getTime();
        const isPast = d.getTime() < today.getTime();
        const dateLabel = d.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "2-digit",
          month: "short",
          year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
        });
        const parts = [r.programme, r.status, r.title].filter(Boolean);
        const line = escapeHtml(parts.join(" - ") || "Untitled");
        const colour = entryColour(r.status, r.programme);
        const rowClass = isToday ? "today" : isPast ? "past" : "";
        return `<div class="entry ${rowClass}">
          <div class="entry-date">${escapeHtml(dateLabel)}</div>
          <div class="entry-body" style="background:${colour}">
            <div class="entry-line">${line}</div>
            ${r.notes ? `<div class="entry-notes">${escapeHtml(r.notes)}</div>` : ""}
          </div>
        </div>`;
      })
      .join("");
  }

  const generatedAt = syncedAt ? escapeHtml(syncedAt) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
<title>My Schedule - ${escapeHtml(personName)}</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: #fafafa;
    color: #1a1a1a;
    max-width: 560px;
  }
  a.back {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: #333;
    text-decoration: none;
  }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: #666; margin-bottom: 20px; }
  .entry { margin-bottom: 10px; }
  .entry-date { font-size: 12px; font-weight: 600; color: #555; margin-bottom: 4px; }
  .entry-body {
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .entry-line { font-size: 14px; }
  .entry-notes { font-size: 12px; color: #555; font-style: italic; margin-top: 4px; }
  .entry.today .entry-date { color: #26518f; }
  .entry.today .entry-body { border: 2px solid #3f7fd1; }
  .entry.past { opacity: 0.55; }
  .empty { color: #666; font-size: 14px; padding: 16px; background: #fff; border: 1px solid #ddd; border-radius: 8px; }
</style>
</head>
<body>
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>My Schedule</h1>
  <div class="meta">${escapeHtml(personName)} &middot; synced ${generatedAt} &middot; refreshes automatically every 2 minutes</div>
  ${itemsHtml}
</body>
</html>`;
}

// --- Annual Leave Tracker -------------------------------------------------
// A genuinely editable page (not just a generated view) for a small named
// group to set each person's annual leave allowance and reset date, and see
// how many A/L days they've used since their most recent reset. Data is
// stored in Cloudflare Workers KV (see wrangler.jsonc's LEAVE_KV binding),
// since - unlike everything else in this system - it needs to persist edits
// made directly on the page, not just be regenerated from Notion each sync.

const LEAVE_TRACKER_PATH = "/annual-leave-tracker";
const LEAVE_KV_KEY = "leave-allowances";
const LEAVE_LOG_KEY = "leave-changelog";
const DEFAULT_ALLOWANCE = 25;

// Given a stored reset date (any year - only the month/day matter, since
// this repeats annually) and today's date, works out the most recent
// occurrence of that anniversary on or before today.
function mostRecentResetDate(resetDateStr, today) {
  if (!resetDateStr) return null;
  const reset = new Date(resetDateStr + "T00:00:00");
  if (isNaN(reset.getTime())) return null;
  const month = reset.getMonth();
  const day = reset.getDate();
  let candidate = new Date(today.getFullYear(), month, day);
  if (candidate.getTime() > today.getTime()) {
    candidate = new Date(today.getFullYear() - 1, month, day);
  }
  return candidate;
}

function toISODateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function countUsedALDays(personName, rows, sinceISODate) {
  if (!sinceISODate) return 0;
  return rows.filter(
    (r) =>
      r.status === "A/L" &&
      Array.isArray(r.people) &&
      r.people.includes(personName) &&
      r.start_date &&
      r.start_date >= sinceISODate
  ).length;
}

function formatLogTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (err) {
    return isoString;
  }
}

function renderLeaveTracker(leaveData, rows, changeLog) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Everyone with a real name is eligible to appear here, in a stable order.
  const people = Object.values(EMAIL_TO_NAME).sort();

  const rowsHtml = people
    .map((name) => {
      const saved = leaveData[name] || {};
      const allowance = typeof saved.allowance === "number" ? saved.allowance : DEFAULT_ALLOWANCE;
      const resetDate = saved.resetDate || "";
      const mostRecent = mostRecentResetDate(resetDate, today);
      const sinceISO = mostRecent ? toISODateString(mostRecent) : null;
      const used = countUsedALDays(name, rows, sinceISO);
      const remaining = allowance - used;
      const remainingClass = remaining < 0 ? "over" : remaining <= 3 ? "low" : "";

      return `<tr data-person="${escapeHtml(name)}">
        <td class="name-cell">${escapeHtml(name)}</td>
        <td><input type="number" class="allowance-input" min="0" step="1" value="${allowance}"></td>
        <td>${used}</td>
        <td class="${remainingClass}">${remaining}</td>
        <td><input type="date" class="reset-input" value="${escapeHtml(resetDate)}"></td>
        <td class="reset-note">${sinceISO ? `since ${sinceISO}` : "no reset date set"}</td>
      </tr>`;
    })
    .join("");

  const logHtml = (changeLog || []).length
    ? (changeLog || [])
        .map(
          (entry) => `<div class="log-entry">
            <span class="log-time">${escapeHtml(formatLogTime(entry.time))}</span>
            <span class="log-by">${escapeHtml(entry.by)}</span>
            <span class="log-desc">${escapeHtml(entry.person)}: ${escapeHtml(entry.summary)}</span>
          </div>`
        )
        .join("")
    : `<div class="log-empty">No changes logged yet.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Annual Leave Tracker</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: #fafafa;
    color: #1a1a1a;
  }
  a.back {
    display: inline-block;
    margin-bottom: 12px;
    font-size: 13px;
    color: #333;
    text-decoration: none;
  }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: #666; margin-bottom: 16px; }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
  }
  table { border-collapse: collapse; min-width: 100%; }
  th, td {
    border: 1px solid #e0e0e0;
    padding: 8px 10px;
    text-align: left;
    font-size: 13px;
    white-space: nowrap;
  }
  thead th {
    background: #333;
    color: #fff;
  }
  .name-cell { font-weight: 600; }
  input.allowance-input { width: 60px; padding: 4px; font-size: 13px; }
  input.reset-input { padding: 4px; font-size: 13px; }
  .reset-note { color: #888; font-size: 12px; }
  td.over { color: #c0392b; font-weight: 700; }
  td.low { color: #d18a1f; font-weight: 700; }
  .save-bar { margin-top: 16px; display: flex; align-items: center; gap: 12px; }
  button.save-btn {
    background: #3f7fd1;
    color: #fff;
    border: none;
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }
  button.save-btn:hover { background: #2f6bb8; }
  button.save-btn:disabled { background: #999; cursor: default; }
  .save-message { font-size: 13px; color: #2a7a2a; }
  .log-toggle-wrap { margin-top: 24px; }
  .log-toggle {
    font-size: 13px;
    font-family: inherit;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 6px;
    padding: 8px 14px;
    cursor: pointer;
    color: #333;
  }
  .log-toggle:hover { background: #f0f0f0; }
  .log-panel {
    display: none;
    margin-top: 10px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fff;
    max-height: 320px;
    overflow-y: auto;
  }
  .log-panel.visible { display: block; }
  .log-entry {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid #eee;
    font-size: 12px;
    flex-wrap: wrap;
  }
  .log-entry:last-child { border-bottom: none; }
  .log-time { color: #888; min-width: 140px; }
  .log-by { font-weight: 600; min-width: 110px; }
  .log-desc { color: #333; }
  .log-empty { padding: 14px; color: #888; font-size: 13px; }
</style>
</head>
<body>
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>Annual Leave Tracker</h1>
  <div class="meta">Allowance and reset dates are editable here directly. "Used" counts A/L days since each person's most recent reset date.</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Person</th>
          <th>Allowance (days)</th>
          <th>Used</th>
          <th>Remaining</th>
          <th>Resets on</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
  <div class="save-bar">
    <button class="save-btn" id="saveBtn">Save Changes</button>
    <span id="saveStatus" style="font-size:13px;color:#666;"></span>
  </div>

  <div class="log-toggle-wrap">
    <button type="button" class="log-toggle" id="logToggle">&darr; View change log</button>
  </div>
  <div class="log-panel" id="logPanel">${logHtml}</div>

  <script>
    document.getElementById('saveBtn').addEventListener('click', async function () {
      const btn = this;
      const status = document.getElementById('saveStatus');
      btn.disabled = true;
      status.textContent = 'Saving...';

      const data = {};
      document.querySelectorAll('tr[data-person]').forEach(function (row) {
        const person = row.getAttribute('data-person');
        const allowance = parseInt(row.querySelector('.allowance-input').value, 10) || 0;
        const resetDate = row.querySelector('.reset-input').value || '';
        data[person] = { allowance: allowance, resetDate: resetDate };
      });

      try {
        const resp = await fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (resp.ok) {
          status.textContent = 'Saved - reloading...';
          setTimeout(function () { window.location.reload(); }, 600);
        } else {
          status.textContent = 'Save failed - try again.';
          btn.disabled = false;
        }
      } catch (err) {
        status.textContent = 'Save failed - check your connection.';
        btn.disabled = false;
      }
    });

    document.getElementById('logToggle').addEventListener('click', function () {
      const panel = document.getElementById('logPanel');
      const expanded = panel.classList.toggle('visible');
      this.textContent = expanded ? '\u2191 Hide change log' : '\u2193 View change log';
    });
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const email = decodeAccessEmail(request);

      let syncedAt = null;
      try {
        const syncResp = await env.ASSETS.fetch(new URL("/last-sync.json", request.url));
        if (syncResp.ok) {
          const data = await syncResp.json();
          syncedAt = data.synced_at || null;
        }
      } catch (err) {
        // If this fails for any reason, the page still renders fine without it.
      }

      return new Response(renderIndex(email, syncedAt), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/my-schedule") {
      const email = decodeAccessEmail(request);
      const personName = email ? EMAIL_TO_NAME[email] : null;

      if (!personName) {
        return new Response(
          "Your account isn't linked to a personal schedule yet. Check with Iestyn.",
          { status: 200, headers: { "content-type": "text/plain; charset=UTF-8" } }
        );
      }

      let rows = [];
      let syncedAt = null;
      try {
        const dataResp = await env.ASSETS.fetch(new URL("/schedule-data.json", request.url));
        if (dataResp.ok) rows = await dataResp.json();
        const syncResp = await env.ASSETS.fetch(new URL("/last-sync.json", request.url));
        if (syncResp.ok) {
          const data = await syncResp.json();
          syncedAt = data.synced_at || null;
        }
      } catch (err) {
        console.error("Failed to load schedule data for /my-schedule:", err);
      }

      return new Response(renderPersonalSchedule(personName, rows, syncedAt), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === LEAVE_TRACKER_PATH) {
      const email = decodeAccessEmail(request);

      // Cloudflare Access should already be blocking anyone else from
      // reaching this path at all - this is a second, explicit check
      // directly in the code, since this route can WRITE data (not just
      // display it), and that's worth double-checking rather than trusting
      // a single layer of protection.
      if (!email || !ANNUAL_LEAVE_VIEWERS.has(email)) {
        return new Response("Not authorised.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      if (!env.LEAVE_KV) {
        return new Response(
          "Leave data storage isn't set up yet (missing LEAVE_KV binding). Check wrangler.jsonc and the Cloudflare KV namespace setup.",
          { status: 500, headers: { "content-type": "text/plain; charset=UTF-8" } }
        );
      }

      if (request.method === "POST") {
        let incoming;
        try {
          incoming = await request.json();
        } catch (err) {
          return new Response("Invalid data.", { status: 400 });
        }

        // Basic validation - only accept the shape we expect, don't just
        // trust and store whatever arrives.
        const clean = {};
        for (const [name, val] of Object.entries(incoming || {})) {
          if (typeof name !== "string") continue;
          const allowance = Number(val && val.allowance);
          const resetDate = typeof (val && val.resetDate) === "string" ? val.resetDate : "";
          if (!Number.isFinite(allowance) || allowance < 0) continue;
          clean[name] = { allowance, resetDate };
        }

        // Work out exactly what changed, compared to what was there before,
        // so the log only records real edits, not the whole save action.
        let previous = {};
        try {
          const stored = await env.LEAVE_KV.get(LEAVE_KV_KEY);
          if (stored) previous = JSON.parse(stored);
        } catch (err) {
          console.error("Failed to read previous leave data for diffing:", err);
        }

        const changedBy = EMAIL_TO_NAME[email] || email;
        const nowISO = new Date().toISOString();
        const newLogEntries = [];

        for (const [name, val] of Object.entries(clean)) {
          const before = previous[name];
          if (!before) {
            newLogEntries.push({
              time: nowISO, by: changedBy, person: name,
              summary: `Added, allowance ${val.allowance}${val.resetDate ? `, resets ${val.resetDate}` : ""}`,
            });
            continue;
          }
          if (before.allowance !== val.allowance) {
            newLogEntries.push({
              time: nowISO, by: changedBy, person: name,
              summary: `Allowance changed: ${before.allowance} \u2192 ${val.allowance}`,
            });
          }
          if ((before.resetDate || "") !== (val.resetDate || "")) {
            newLogEntries.push({
              time: nowISO, by: changedBy, person: name,
              summary: `Reset date changed: ${before.resetDate || "(none)"} \u2192 ${val.resetDate || "(none)"}`,
            });
          }
        }

        if (newLogEntries.length > 0) {
          let log = [];
          try {
            const storedLog = await env.LEAVE_KV.get(LEAVE_LOG_KEY);
            if (storedLog) log = JSON.parse(storedLog);
          } catch (err) {
            console.error("Failed to read existing leave change log:", err);
          }
          log = [...newLogEntries.reverse(), ...log].slice(0, 300);
          await env.LEAVE_KV.put(LEAVE_LOG_KEY, JSON.stringify(log));
        }

        await env.LEAVE_KV.put(LEAVE_KV_KEY, JSON.stringify(clean));
        return new Response(JSON.stringify({ ok: true, changes: newLogEntries.length }), {
          headers: { "content-type": "application/json" },
        });
      }

      let leaveData = {};
      let changeLog = [];
      try {
        const stored = await env.LEAVE_KV.get(LEAVE_KV_KEY);
        if (stored) leaveData = JSON.parse(stored);
        const storedLog = await env.LEAVE_KV.get(LEAVE_LOG_KEY);
        if (storedLog) changeLog = JSON.parse(storedLog);
      } catch (err) {
        console.error("Failed to read leave data from KV:", err);
      }

      let rows = [];
      try {
        const dataResp = await env.ASSETS.fetch(new URL("/schedule-data.json", request.url));
        if (dataResp.ok) rows = await dataResp.json();
      } catch (err) {
        console.error("Failed to load schedule data for leave tracker:", err);
      }

      return new Response(renderLeaveTracker(leaveData, rows, changeLog), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    return env.ASSETS.fetch(request);
  },

  // Runs on Cloudflare's own reliable Cron Trigger (see wrangler.jsonc),
  // every 5 minutes. GitHub's own "schedule:" trigger in sync.yml is
  // documented as best-effort and can silently drift by 20-40+ minutes, so
  // instead this pings GitHub's API to fire the same workflow on demand
  // (workflow_dispatch), which - unlike the schedule trigger - runs
  // promptly every time, since it's treated as a normal on-demand request
  // rather than being queued in GitHub's deprioritised scheduler.
  //
  // Requires a GITHUB_PAT secret set in this Worker's environment
  // (Cloudflare dashboard -> this Worker -> Settings -> Variables and
  // Secrets -> Add -> name it GITHUB_PAT, type Secret), a GitHub fine-
  // grained token scoped to just this repo with Actions: Read and write.
  async scheduled(controller, env, ctx) {
    if (!env.GITHUB_PAT) {
      console.error("GITHUB_PAT secret is not set - cannot trigger sync workflow.");
      return;
    }

    const resp = await fetch(
      "https://api.github.com/repos/iestyn-carlam/carlam-schedule/actions/workflows/sync.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "carlam-schedule-worker",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Failed to trigger sync workflow: ${resp.status} ${text}`);
    }
  },
};
