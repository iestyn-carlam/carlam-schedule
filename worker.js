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

const ACCESS_MAP = {
  "iestyn@carlamltd.com": "ALL",
  "bethan@carlamltd.com": "ALL",
  "ceri@carlamltd.com": ["Digital", "Admin"],
  "cerys@carlamltd.com": ["Children", "Admin"],
  "derwena@carlamltd.com": "ALL",
  "elin@carlamltd.com": "ALL",
  "eurosllyr@carlamltd.com": "ALL",
  "hannah@carlamltd.com": ["Factual", "Admin"],
  "jason@carlamltd.com": ["Children", "Technical", "Admin", "Factual"],
  "lara@carlamltd.com": "ALL",
  "osh@carlamltd.com": ["Digital", "Corporate", "Admin"],
  "owain@carlamltd.com": ["Digital", "Admin"],
  "rhodri@carlamltd.com": ["Digital", "Admin"],
  "wil@carlamltd.com": ["Digital", "Corporate", "Admin"],
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

    return env.ASSETS.fetch(request);
  },
};
