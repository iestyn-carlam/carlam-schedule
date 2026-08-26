/**
 * Intercepts requests to the homepage and builds a personalized list of
 * schedule links based on who's actually logged in (read from the
 * Cloudflare Access login), instead of showing every team to everyone.
 *
 * Every other file (the actual team pages, calendars, spreadsheet) is left
 * completely alone and served as a normal static file - and, importantly,
 * each of those pages is STILL independently protected by its own
 * Cloudflare Access policy. This script only changes what's *displayed* on
 * the homepage menu; it is not what makes pages secure. Even if this script
 * had a bug and showed someone a link they shouldn't have, Access would
 * still block them from actually opening that page - the real security
 * boundary lives in Access, not here.
 *
 * IMPORTANT - keep two places in sync when you add a new person:
 *   1. The Cloudflare Access policy for their team (this is what actually
 *      grants or denies access - it's the real lock).
 *   2. The ACCESS_MAP below (this only decides what shows up on their
 *      homepage menu - it's just for a tidy display).
 * If you forget step 2, that person can still open their team's link
 * directly (e.g. if you send it to them) - they just won't see it listed
 * on the homepage. If you forget step 1, they won't get in at all,
 * regardless of what this file says.
 */

// Every team page currently generated, and its actual filename in docs/.
// These filenames change if generate_webpage.py's TEAMS list or the salt
// changes - keep this in step with what's actually in your docs/ folder.
const TEAM_PAGES = {
  Kids: "schedule-kids-5a092c1e.html",
  Digital: "schedule-digital-fe835502.html",
  Corporate: "schedule-corporate-d2a0bfc5.html",
  Technical: "schedule-technical-62ca0dbf.html",
  Admin: "schedule-admin-578fa55d.html",
  Factual: "schedule-factual-6b97711e.html",
};
const MASTER_FILE = "schedule-master-6bc54781.html";

// Who sees what on the homepage menu.
//   "ALL"                 -> sees Master + every team
//   ["Kids", "Digital"]   -> sees just those specific teams (no Master)
// Add a lowercase email entry for every person here. Anyone not listed
// (or not logged in) sees a plain "no schedules assigned" message.
const ACCESS_MAP = {
  "iestyn@carlamltd.com": "ALL",
  "wil@carlamltd.com": ["Digital", "Corporate", "Admin"],
  // "someone.else@carlamltd.com": ["Digital", "Technical"],
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

function renderIndex(email) {
  const entry = email ? ACCESS_MAP[email] : undefined;
  const links = [];

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
          ([label, file, desc]) =>
            `<li><a href="${file}">${escapeHtml(label)}</a><div class="desc">${escapeHtml(desc)}</div></li>`
        )
        .join("")
    : `<li><div class="empty">No schedules are assigned to your account yet. If this looks wrong, check with Iestyn.</div></li>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carlam Schedules</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 24px 16px;
    background: #fafafa;
    color: #1a1a1a;
    max-width: 480px;
  }
  h1 { font-size: 22px; margin: 0 0 20px 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { margin-bottom: 12px; }
  li a {
    display: block;
    padding: 14px 16px;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    text-decoration: none;
    color: #1a1a1a;
    font-weight: 600;
    font-size: 15px;
  }
  li a:hover { border-color: #999; }
  .desc { font-size: 12px; color: #777; padding: 4px 16px 0 16px; }
  .empty {
    padding: 14px 16px;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    color: #555;
    font-size: 14px;
  }
</style>
</head>
<body>
  <h1>Carlam Schedules</h1>
  <ul>${itemsHtml}</ul>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const email = decodeAccessEmail(request);
      return new Response(renderIndex(email), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    // Everything else (team pages, calendars, spreadsheet) is served as a
    // normal static file, completely unchanged - and still separately
    // protected by its own Cloudflare Access policy.
    return env.ASSETS.fetch(request);
  },
};
