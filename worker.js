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

// --- Shared theming system --------------------------------------------
// Three colour themes, chosen via a small picker on every page and
// remembered via a cookie (so it applies consistently across the homepage,
// team/master schedules, personal schedule, and both trackers - all of
// which are otherwise rendered by two different systems, JS here and
// Python in generate_webpage.py). Only layout colours are themed - task
// and programme colours are always set as direct inline styles elsewhere
// and never reference these variables, so they stay exactly the same
// regardless of theme.
const THEME_VARS_CSS = `
  :root, [data-mode="dark"][data-colour="blue"] {
    --bg: #0b0b0c;
    --surface: #17171a;
    --surface-hover: #1f1f23;
    --border: #2a2a2e;
    --text: #f5f5f3;
    --text-dim: #8b8b90;
    --accent: #3f7fd1;
  }
  [data-mode="light"][data-colour="blue"] {
    --bg: #fafafa;
    --surface: #ffffff;
    --surface-hover: #f0f0f0;
    --border: #e0e0e0;
    --text: #1a1a1a;
    --text-dim: #666666;
    --accent: #3f7fd1;
  }
  [data-mode="dark"][data-colour="pink"] {
    --bg: hsl(330, 25%, 7%); --surface: hsl(330, 20%, 12%); --surface-hover: hsl(330, 18%, 16%);
    --border: hsl(330, 16%, 20%); --text: hsl(330, 12%, 95%); --text-dim: hsl(330, 10%, 63%); --accent: hsl(330, 70%, 58%);
  }
  [data-mode="light"][data-colour="pink"] {
    --bg: hsl(330, 45%, 96%); --surface: hsl(330, 35%, 99%); --surface-hover: hsl(330, 35%, 92%);
    --border: hsl(330, 30%, 85%); --text: hsl(330, 35%, 15%); --text-dim: hsl(330, 15%, 42%); --accent: hsl(330, 75%, 45%);
  }
  [data-mode="dark"][data-colour="red"] {
    --bg: hsl(355, 25%, 7%); --surface: hsl(355, 20%, 12%); --surface-hover: hsl(355, 18%, 16%);
    --border: hsl(355, 16%, 20%); --text: hsl(355, 12%, 95%); --text-dim: hsl(355, 10%, 63%); --accent: hsl(355, 70%, 58%);
  }
  [data-mode="light"][data-colour="red"] {
    --bg: hsl(355, 45%, 96%); --surface: hsl(355, 35%, 99%); --surface-hover: hsl(355, 35%, 92%);
    --border: hsl(355, 30%, 85%); --text: hsl(355, 35%, 15%); --text-dim: hsl(355, 15%, 42%); --accent: hsl(355, 75%, 45%);
  }
  [data-mode="dark"][data-colour="green"] {
    --bg: hsl(150, 25%, 7%); --surface: hsl(150, 20%, 12%); --surface-hover: hsl(150, 18%, 16%);
    --border: hsl(150, 16%, 20%); --text: hsl(150, 12%, 95%); --text-dim: hsl(150, 10%, 63%); --accent: hsl(150, 70%, 58%);
  }
  [data-mode="light"][data-colour="green"] {
    --bg: hsl(150, 45%, 96%); --surface: hsl(150, 35%, 99%); --surface-hover: hsl(150, 35%, 92%);
    --border: hsl(150, 30%, 85%); --text: hsl(150, 35%, 15%); --text-dim: hsl(150, 15%, 42%); --accent: hsl(150, 75%, 45%);
  }
  [data-mode="dark"][data-colour="purple"] {
    --bg: hsl(265, 25%, 7%); --surface: hsl(265, 20%, 12%); --surface-hover: hsl(265, 18%, 16%);
    --border: hsl(265, 16%, 20%); --text: hsl(265, 12%, 95%); --text-dim: hsl(265, 10%, 63%); --accent: hsl(265, 70%, 58%);
  }
  [data-mode="light"][data-colour="purple"] {
    --bg: hsl(265, 45%, 96%); --surface: hsl(265, 35%, 99%); --surface-hover: hsl(265, 35%, 92%);
    --border: hsl(265, 30%, 85%); --text: hsl(265, 35%, 15%); --text-dim: hsl(265, 15%, 42%); --accent: hsl(265, 75%, 45%);
  }
  [data-mode="dark"][data-colour="orange"] {
    --bg: hsl(25, 25%, 7%); --surface: hsl(25, 20%, 12%); --surface-hover: hsl(25, 18%, 16%);
    --border: hsl(25, 16%, 20%); --text: hsl(25, 12%, 95%); --text-dim: hsl(25, 10%, 63%); --accent: hsl(25, 70%, 58%);
  }
  [data-mode="light"][data-colour="orange"] {
    --bg: hsl(25, 45%, 96%); --surface: hsl(25, 35%, 99%); --surface-hover: hsl(25, 35%, 92%);
    --border: hsl(25, 30%, 85%); --text: hsl(25, 35%, 15%); --text-dim: hsl(25, 15%, 42%); --accent: hsl(25, 75%, 45%);
  }
`;

// Placed first thing in <head>, before any other styling, so the page
// never flashes the wrong theme before this runs. Cookie stores
// "mode:colour" (e.g. "dark:blue"), so the two are remembered together
// but chosen independently on the page.
const THEME_BOOTSTRAP_SCRIPT = `<script>
(function () {
  var m = document.cookie.match(/(?:^|; )carlam_theme=([^;]+)/);
  var parts = (m ? decodeURIComponent(m[1]) : 'dark:blue').split(':');
  document.documentElement.setAttribute('data-mode', parts[0] || 'dark');
  document.documentElement.setAttribute('data-colour', parts[1] || 'blue');
})();
</script>`;

const THEME_PICKER_CSS = `
  .theme-picker-fixed {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 100;
  }
  .theme-toggle-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--accent);
    cursor: pointer;
    padding: 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }
  .theme-panel {
    position: absolute;
    top: 42px;
    right: 0;
    display: none;
    flex-wrap: wrap;
    gap: 6px;
    width: 128px;
    padding: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.3);
  }
  .theme-panel.open { display: flex; }
  .theme-swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--border);
    cursor: pointer;
    padding: 0;
  }
  .theme-swatch[data-colour-btn="pink"] { background: hsl(330, 70%, 58%); }
  .theme-swatch[data-colour-btn="red"] { background: hsl(355, 70%, 58%); }
  .theme-swatch[data-colour-btn="green"] { background: hsl(150, 70%, 58%); }
  .theme-swatch[data-colour-btn="blue"] { background: hsl(215, 70%, 58%); }
  .theme-swatch[data-colour-btn="purple"] { background: hsl(265, 70%, 58%); }
  .theme-swatch[data-colour-btn="orange"] { background: hsl(25, 70%, 58%); }
  .theme-swatch.active { border-color: #fff; box-shadow: 0 0 0 1px var(--accent); }
  .mode-toggle-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    padding: 0;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
`;

const THEME_PICKER_HTML = `<div class="theme-picker-fixed" style="display:flex; gap:8px; align-items:flex-start;">
  <button class="mode-toggle-btn" id="modeToggleBtn" aria-label="Toggle light or dark mode" title="Light / Dark"></button>
  <div style="position:relative;">
    <button class="theme-toggle-btn" id="themeToggleBtn" aria-label="Choose colour" title="Colour"></button>
    <div class="theme-panel" id="themePanel">
      <button class="theme-swatch" data-colour-btn="blue" aria-label="Blue"></button>
      <button class="theme-swatch" data-colour-btn="pink" aria-label="Pink"></button>
      <button class="theme-swatch" data-colour-btn="red" aria-label="Red"></button>
      <button class="theme-swatch" data-colour-btn="green" aria-label="Green"></button>
      <button class="theme-swatch" data-colour-btn="purple" aria-label="Purple"></button>
      <button class="theme-swatch" data-colour-btn="orange" aria-label="Orange"></button>
    </div>
  </div>
</div>`;

const THEME_PICKER_SCRIPT = `<script>
(function () {
  function applyTheme(mode, colour) {
    document.cookie = 'carlam_theme=' + mode + ':' + colour + '; path=/; max-age=31536000';
    location.reload();
  }

  var modeBtn = document.getElementById('modeToggleBtn');
  if (modeBtn) {
    var currentMode = document.documentElement.getAttribute('data-mode') || 'dark';
    var currentColour = document.documentElement.getAttribute('data-colour') || 'blue';
    modeBtn.textContent = currentMode === 'light' ? '\u2600\ufe0f' : '\ud83c\udf19';
    modeBtn.addEventListener('click', function () {
      applyTheme(currentMode === 'light' ? 'dark' : 'light', currentColour);
    });
  }

  var toggleBtn = document.getElementById('themeToggleBtn');
  var panel = document.getElementById('themePanel');
  if (!toggleBtn || !panel) return;

  toggleBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== toggleBtn) {
      panel.classList.remove('open');
    }
  });

  var mode = document.documentElement.getAttribute('data-mode') || 'dark';
  var colour = document.documentElement.getAttribute('data-colour') || 'blue';
  document.querySelectorAll('.theme-swatch').forEach(function (btn) {
    if (btn.getAttribute('data-colour-btn') === colour) btn.classList.add('active');
    btn.addEventListener('click', function () {
      applyTheme(mode, this.getAttribute('data-colour-btn'));
    });
  });
})();
</script>`;

// --- User badge (top-left, on every page) ---------------------------------
// Shows the logged-in person's name with a dropdown to log out of
// Cloudflare Access. Rather than threading the name through every single
// render function, this fetches it client-side from a tiny /whoami
// endpoint - the same mechanism works identically whether the page came
// from the Worker directly or is a static file generated by Python, since
// both are served through the same Access-protected domain.
const CF_TEAM_DOMAIN = "iestyn-041.cloudflareaccess.com";
const AZURE_TENANT_ID = "ac47462c-3ba4-4ca5-87e7-8ff3021d4ba7";

const USER_BADGE_CSS = `
  .user-badge-fixed {
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 100;
  }
  .user-badge-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 6px 12px 6px 10px;
    cursor: pointer;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
  .user-badge-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .user-badge-panel {
    position: absolute;
    top: 42px;
    left: 0;
    display: none;
    min-width: 140px;
    padding: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.3);
  }
  .user-badge-panel.open { display: block; }
  .user-badge-panel a {
    display: block;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--text);
    text-decoration: none;
    border-radius: 6px;
  }
  .user-badge-panel a:hover { background: var(--surface-hover); }
`;

const USER_BADGE_HTML = `<div class="user-badge-fixed">
  <button class="user-badge-btn" id="userBadgeBtn"><span class="user-badge-dot"></span><span id="userBadgeName">&hellip;</span></button>
  <div class="user-badge-panel" id="userBadgePanel">
    <a href="#" id="fullLogoutLink">Log out</a>
  </div>
</div>`;

const USER_BADGE_SCRIPT = `<script>
(function () {
  var btn = document.getElementById('userBadgeBtn');
  var nameEl = document.getElementById('userBadgeName');
  var panel = document.getElementById('userBadgePanel');
  var logoutLink = document.getElementById('fullLogoutLink');
  if (!btn || !nameEl || !panel) return;

  fetch('/whoami')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      nameEl.textContent = data.name || 'Not signed in';
    })
    .catch(function () {
      nameEl.textContent = 'Not signed in';
    });

  // A single "Log out" click needs to clear two separate sessions: the
  // Cloudflare Access session (this site's login) AND the underlying
  // Microsoft session in this browser (since Access just checks whether
  // that Microsoft session is still valid). Clearing only the first one
  // means the very next visit silently signs you straight back in via
  // Microsoft's own single sign-on, which looks like logout "didn't work".
  if (logoutLink) {
    logoutLink.addEventListener('click', function (e) {
      e.preventDefault();
      fetch('https://${CF_TEAM_DOMAIN}/cdn-cgi/access/logout', { mode: 'no-cors', credentials: 'include' })
        .catch(function () {})
        .finally(function () {
          var msLogout = 'https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/logout?post_logout_redirect_uri=' + encodeURIComponent(window.location.origin + '/index.html');
          window.location.href = msLogout;
        });
    });
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.remove('open');
    }
  });
})();
</script>`;

const PAGE_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap');

  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px) 0 0/26px 26px,
      var(--bg);
    color: var(--text);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    display: flex;
    justify-content: center;
    padding: 64px 24px 80px;
  }
  .page { width: 100%; max-width: 780px; }
  .logo-wrap { text-align: center; margin-bottom: 36px; }
  /* The logo asset is a white silhouette on transparent. For light-background
     themes, inverting the colours turns it black - visible against a light
     page - while transparent areas stay transparent (invert doesn't touch
     alpha), so no second image file is needed. */
  [data-mode="light"] .logo {
    filter: invert(1);
  }
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
    background: var(--dot-color, #2ecc71);
    box-shadow: 0 0 0 0 var(--dot-glow, rgba(46, 204, 113, 0.6));
    animation: pulse 2.2s infinite;
    flex-shrink: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; }
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 var(--dot-glow, rgba(46, 204, 113, 0.55)); }
    70%  { box-shadow: 0 0 0 7px rgba(0, 0, 0, 0); }
    100% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
  }
  .sync-error {
    display: none;
    margin: -20px auto 24px;
    max-width: 420px;
    background: rgba(231, 76, 60, 0.12);
    border: 1px solid rgba(231, 76, 60, 0.4);
    color: #ff8a80;
    font-size: 12px;
    text-align: center;
    padding: 8px 14px;
    border-radius: 8px;
  }
  .incident-banner {
    max-width: 420px;
    margin: 0 auto 24px;
    background: rgba(241, 196, 15, 0.1);
    border: 1px solid rgba(241, 196, 15, 0.4);
    border-radius: 8px;
    padding: 12px 14px;
    text-align: left;
  }
  .incident-title {
    font-size: 13px;
    font-weight: 600;
    color: #f1c40f;
    margin-bottom: 4px;
  }
  .incident-detail {
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .incident-update {
    font-size: 12px;
    color: var(--text);
    margin-bottom: 8px;
    line-height: 1.4;
  }
  .incident-link {
    font-size: 12px;
    color: #f1c40f;
    text-decoration: none;
  }
  .incident-link:hover { text-decoration: underline; }
  .widgets {
    display: flex;
    justify-content: center;
    margin-bottom: 32px;
  }
  .widgets .widget {
    width: 100%;
    max-width: 320px;
  }
  .widget {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .widget-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin-bottom: 8px;
  }
  .widget-body { font-size: 13px; color: var(--text); }
  .weather-main {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .weather-icon { font-size: 30px; line-height: 1; }
  .weather-temp { font-size: 22px; font-weight: 600; font-family: 'Space Grotesk', sans-serif; }
  .weather-desc { font-size: 12px; color: var(--text-dim); }
  .weather-details {
    margin-top: 8px;
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: var(--text-dim);
    flex-wrap: wrap;
  }
  .bbc-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    background: #bb1919;
    color: #fff;
    font-size: 8px;
    font-weight: 700;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .headlines {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .headline-item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border);
  }
  .headline-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
  .headline-item a {
    color: var(--text);
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.45;
    display: block;
  }
  .headline-item a:hover { color: var(--accent); }
  .headline-desc {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 4px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .link-group { margin-bottom: 28px; }
  .link-group:last-child { margin-bottom: 0; }
  .group-title {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin: 0 0 12px 0;
  }
  ul.links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }
  ul.links li { margin-bottom: 0; }
  ul.links a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    min-height: 76px;
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

function barHtml(label, value, max, suffix) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `<div class="bar-row">
    <div class="bar-label">${escapeHtml(label)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    <div class="bar-value">${escapeHtml(String(value))}${suffix ? escapeHtml(suffix) : ""}</div>
  </div>`;
}

function renderAnalytics(pageviews, requests, scheduleRows, syncedAt) {
  const total = pageviews.total || 0;
  const byPath = pageviews.byPath || {};
  const byDay = pageviews.byDay || {};
  const recent = pageviews.recent || [];

  const topPaths = Object.entries(byPath)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const maxPathViews = topPaths.length ? topPaths[0][1] : 1;

  const today = new Date();
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7.push({ key, label: d.toLocaleDateString("en-GB", { weekday: "short" }), count: byDay[key] || 0 });
  }
  const maxDayViews = Math.max(1, ...last7.map((d) => d.count));
  const viewsToday = byDay[today.toISOString().slice(0, 10)] || 0;
  const viewsThisWeek = last7.reduce((sum, d) => sum + d.count, 0);

  const uniqueVisitorNames = new Set(recent.filter((r) => r.name).map((r) => r.name));

  const totalRequests = requests.length;
  const accepted = requests.filter((r) => r.status === "accepted").length;
  const rejected = requests.filter((r) => r.status === "rejected").length;
  const pending = requests.filter((r) => r.status === "pending").length;
  const decided = requests.filter((r) => r.decidedAt && r.submittedAt);
  const avgTurnaroundHrs = decided.length
    ? (
        decided.reduce((sum, r) => sum + (new Date(r.decidedAt) - new Date(r.submittedAt)), 0) /
        decided.length /
        (1000 * 60 * 60)
      ).toFixed(1)
    : null;

  const statusCounts = {};
  const teamCounts = {};
  const programmeCounts = {};
  const personCounts = {};
  for (const r of scheduleRows) {
    if (r.status) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    if (r.team) teamCounts[r.team] = (teamCounts[r.team] || 0) + 1;
    if (r.programme) programmeCounts[r.programme] = (programmeCounts[r.programme] || 0) + 1;
    for (const p of r.people || []) personCounts[p] = (personCounts[p] || 0) + 1;
  }
  const topStatuses = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topProgrammes = Object.entries(programmeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topPeople = Object.entries(personCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxStatus = topStatuses.length ? topStatuses[0][1] : 1;
  const maxProgramme = topProgrammes.length ? topProgrammes[0][1] : 1;
  const maxPerson = topPeople.length ? topPeople[0][1] : 1;

  const recentHtml = recent.slice(0, 15).map(
    (r) => `<div class="recent-row">
      <span class="recent-time">${escapeHtml(formatLogTime(r.time))}</span>
      <span class="recent-name">${escapeHtml(r.name || "Unknown")}</span>
      <span class="recent-path">${escapeHtml(r.path)}</span>
    </div>`
  ).join("");

  const dayBarsHtml = last7
    .map((d) => {
      const h = Math.max(4, Math.round((d.count / maxDayViews) * 80));
      return `<div class="daybar"><div class="daybar-fill" style="height:${h}px" title="${d.count} views"></div><div class="daybar-label">${escapeHtml(d.label)}</div></div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
${THEME_BOOTSTRAP_SCRIPT}
<title>Analytics</title>
<style>
${THEME_VARS_CSS}
${THEME_PICKER_CSS}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    max-width: 900px;
  }
  a.back { display: inline-block; font-size: 13px; color: var(--text-dim); text-decoration: none; margin-bottom: 12px; }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: var(--text-dim); margin-bottom: 24px; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 28px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; text-align: center; }
  .stat-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .stat-value { font-size: 24px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; margin-top: 4px; }
  .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 20px; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .panel-title { font-size: 13px; font-weight: 600; margin: 0 0 12px; }
  .bar-row { display: grid; grid-template-columns: 110px 1fr 40px; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
  .bar-label { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { background: var(--surface-hover); border-radius: 4px; height: 10px; overflow: hidden; }
  .bar-fill { background: var(--accent); height: 100%; border-radius: 4px; }
  .bar-value { text-align: right; color: var(--text); }
  .daychart { display: flex; align-items: flex-end; gap: 10px; height: 100px; padding-top: 10px; }
  .daybar { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
  .daybar-fill { width: 100%; background: var(--accent); border-radius: 3px 3px 0 0; }
  .daybar-label { font-size: 10px; color: var(--text-dim); }
  .recent-row { display: flex; gap: 10px; font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .recent-row:last-child { border-bottom: none; }
  .recent-time { color: var(--text-dim); min-width: 130px; }
  .recent-name { font-weight: 600; min-width: 100px; }
  .recent-path { color: var(--accent); font-family: 'JetBrains Mono', monospace; font-size: 11px; }
  .empty { color: var(--text-dim); font-size: 13px; padding: 10px 0; }
</style>
</head>
<body>
  ${THEME_PICKER_HTML}
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>Analytics</h1>
  <div class="meta">Everything the system has tracked about itself &middot; schedule last synced ${escapeHtml(syncedAt || "unknown")}</div>

  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Total Page Views</div><div class="stat-value">${total}</div></div>
    <div class="stat-card"><div class="stat-label">Views Today</div><div class="stat-value">${viewsToday}</div></div>
    <div class="stat-card"><div class="stat-label">Views This Week</div><div class="stat-value">${viewsThisWeek}</div></div>
    <div class="stat-card"><div class="stat-label">Recent Unique Visitors</div><div class="stat-value">${uniqueVisitorNames.size}</div></div>
    <div class="stat-card"><div class="stat-label">Schedule Rows</div><div class="stat-value">${scheduleRows.length}</div></div>
    <div class="stat-card"><div class="stat-label">Leave Requests</div><div class="stat-value">${totalRequests}</div></div>
  </div>

  <div class="panels">
    <div class="panel">
      <div class="panel-title">Views over the last 7 days</div>
      <div class="daychart">${dayBarsHtml}</div>
    </div>
    <div class="panel">
      <div class="panel-title">Most visited pages</div>
      ${topPaths.length ? topPaths.map(([path, count]) => barHtml(path, count, maxPathViews)).join("") : '<div class="empty">No data yet.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Leave requests</div>
      <div class="bar-row"><div class="bar-label">Accepted</div><div class="bar-track"><div class="bar-fill" style="width:${totalRequests ? (accepted / totalRequests) * 100 : 0}%;background:#2a9d4a"></div></div><div class="bar-value">${accepted}</div></div>
      <div class="bar-row"><div class="bar-label">Rejected</div><div class="bar-track"><div class="bar-fill" style="width:${totalRequests ? (rejected / totalRequests) * 100 : 0}%;background:#c0392b"></div></div><div class="bar-value">${rejected}</div></div>
      <div class="bar-row"><div class="bar-label">Pending</div><div class="bar-track"><div class="bar-fill" style="width:${totalRequests ? (pending / totalRequests) * 100 : 0}%;background:#d18a1f"></div></div><div class="bar-value">${pending}</div></div>
      ${avgTurnaroundHrs !== null ? `<div class="empty" style="padding-top:8px;">Average decision time: ${escapeHtml(avgTurnaroundHrs)} hours</div>` : ""}
    </div>
    <div class="panel">
      <div class="panel-title">Schedule by status</div>
      ${topStatuses.length ? topStatuses.map(([s, c]) => barHtml(s, c, maxStatus)).join("") : '<div class="empty">No data yet.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Busiest programmes</div>
      ${topProgrammes.length ? topProgrammes.map(([p, c]) => barHtml(p, c, maxProgramme)).join("") : '<div class="empty">No data yet.</div>'}
    </div>
    <div class="panel">
      <div class="panel-title">Most scheduled people</div>
      ${topPeople.length ? topPeople.map(([p, c]) => barHtml(p, c, maxPerson)).join("") : '<div class="empty">No data yet.</div>'}
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Recent activity</div>
    ${recentHtml || '<div class="empty">No activity recorded yet.</div>'}
  </div>

  ${THEME_PICKER_SCRIPT}
</body>
</html>`;
}

function renderIndex(email, syncedAt, headlines, syncedAtIso, incidentInfo) {
  const entry = email ? ACCESS_MAP[email] : undefined;

  const myScheduleLinks = [];
  const masterLinks = [];
  const trackerLinks = [];
  const teamLinks = [];

  if (email && EMAIL_TO_NAME[email]) {
    myScheduleLinks.push(["My Schedule", "my-schedule", "Just your own tasks, day by day"]);
    myScheduleLinks.push(["My Annual Leave", "my-annual-leave", "Days used, remaining, and your reset date"]);
    myScheduleLinks.push(["Request Annual Leave", "request-leave", "Submit a new leave request"]);
    myScheduleLinks.push(["My Leave Requests", "my-leave-requests", "Track the status of your requests"]);
  }

  if (email && ANNUAL_LEAVE_VIEWERS.has(email)) {
    masterLinks.push(["Annual Leave", ANNUAL_LEAVE_FILE, "Everyone's annual leave, all teams, in one view"]);
    trackerLinks.push(["Annual Leave Tracker", LEAVE_TRACKER_PATH.slice(1), "Set allowances and see days used"]);
    trackerLinks.push(["Sick Days Tracker", SICK_TRACKER_PATH.slice(1), "Set allowances and see sick days used"]);
    trackerLinks.push(["Approve Leave Requests", "approve-leave", "Review and decide on pending requests"]);
  }

  if (email === "iestyn@carlamltd.com") {
    trackerLinks.push(["Analytics", "analytics", "Traffic, usage, and system stats - just for you"]);
  }

  if (entry === "ALL") {
    masterLinks.unshift(["All Teams (Master)", MASTER_FILE, "Everyone, every team, in one grid"]);
    for (const [team, file] of Object.entries(TEAM_PAGES)) {
      teamLinks.push([team, file, `${team} team schedule`]);
    }
  } else if (Array.isArray(entry)) {
    for (const team of entry) {
      if (TEAM_PAGES[team]) {
        teamLinks.push([team, TEAM_PAGES[team], `${team} team schedule`]);
      }
    }
  }

  function renderLinkGroup(title, groupLinks) {
    if (!groupLinks.length) return "";
    const itemsHtml = groupLinks
      .map(
        ([label, file, desc]) => `<li><a href="${file}">
          <span class="tri"></span>
          <span class="link-text">
            <span class="link-label">${escapeHtml(label)}</span>
            <span class="link-desc">${escapeHtml(desc)}</span>
          </span>
        </a></li>`
      )
      .join("");
    return `<div class="link-group">
      <h2 class="group-title">${escapeHtml(title)}</h2>
      <ul class="links">${itemsHtml}</ul>
    </div>`;
  }

  const allEmpty = !myScheduleLinks.length && !masterLinks.length && !trackerLinks.length && !teamLinks.length;
  const itemsHtml = allEmpty
    ? `<div class="empty">No schedules are assigned to your account yet.<br>If this looks wrong, check with Iestyn.</div>`
    : renderLinkGroup("My Schedule", myScheduleLinks) +
      renderLinkGroup("Master Schedule", masterLinks) +
      renderLinkGroup("Trackers", trackerLinks) +
      renderLinkGroup("Team Schedules", teamLinks);

  const statusHtml = syncedAt
    ? `<div class="status"><span class="dot" id="syncDot"></span>synced <span id="syncedTimeText">${escapeHtml(syncedAt)}</span></div>`
    : `<div class="status"><span class="dot" id="syncDot"></span>live</div>`;

  const syncErrorHtml = `<div class="sync-error" id="syncError">Hasn't updated in a while &mdash; try refreshing the page. Still stale after that? Contact the admin (Iestyn).</div>`;

  const incidentHtml = incidentInfo
    ? `<div class="incident-banner">
        <div class="incident-title">&#9888;&#65039; Cloudflare is experiencing issues &mdash; automatic syncing may be temporarily delayed.</div>
        <div class="incident-detail">${escapeHtml(incidentInfo.name)} &middot; ${escapeHtml(incidentInfo.statusLabel)}</div>
        <div class="incident-update">${escapeHtml(incidentInfo.latestUpdate)}</div>
        <a class="incident-link" href="${escapeHtml(incidentInfo.url)}" target="_blank" rel="noopener">View live status on Cloudflare's status page &rarr;</a>
      </div>`
    : "";

  const headlinesHtml = (headlines && headlines.length)
    ? headlines
        .map(
          (h) => `<li class="headline-item">
            <span class="bbc-badge">BBC</span>
            <div>
              <a href="${escapeHtml(h.link)}" target="_blank" rel="noopener">${escapeHtml(h.title)}</a>
              ${h.description ? `<div class="headline-desc">${escapeHtml(h.description)}</div>` : ""}
            </div>
          </li>`
        )
        .join("")
    : `<li style="color:var(--text-dim);font-size:12px;">Headlines unavailable right now.</li>`;

  const widgetsHtml = `<div class="widgets">
    <div class="widget">
      <div class="widget-label">Weather</div>
      <div class="widget-body" id="weatherBody">Checking your location&hellip;</div>
    </div>
  </div>`;

  const weatherScript = `<script>
    (function () {
      var body = document.getElementById('weatherBody');
      if (body) {
        if (!navigator.geolocation) {
          body.textContent = 'Location not available in this browser.';
        } else {
          var iconMap = {
            0: '\\u2600\\uFE0F', 1: '\\uD83C\\uDF24\\uFE0F', 2: '\\u26C5', 3: '\\u2601\\uFE0F',
            45: '\\uD83C\\uDF2B\\uFE0F', 48: '\\uD83C\\uDF2B\\uFE0F',
            51: '\\uD83C\\uDF26\\uFE0F', 53: '\\uD83C\\uDF26\\uFE0F', 55: '\\uD83C\\uDF27\\uFE0F',
            61: '\\uD83C\\uDF26\\uFE0F', 63: '\\uD83C\\uDF27\\uFE0F', 65: '\\uD83C\\uDF27\\uFE0F',
            71: '\\uD83C\\uDF28\\uFE0F', 73: '\\uD83C\\uDF28\\uFE0F', 75: '\\uD83C\\uDF28\\uFE0F',
            80: '\\uD83C\\uDF26\\uFE0F', 81: '\\uD83C\\uDF27\\uFE0F', 82: '\\u26C8\\uFE0F',
            95: '\\u26C8\\uFE0F',
          };
          var codeMap = {
            0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
            45: 'Foggy', 48: 'Foggy', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
            61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow',
            75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
            95: 'Thunderstorm',
          };
          navigator.geolocation.getCurrentPosition(function (pos) {
            var lat = pos.coords.latitude, lon = pos.coords.longitude;
            var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon
              + '&current_weather=true&hourly=relative_humidity_2m,apparent_temperature'
              + '&daily=temperature_2m_max,temperature_2m_min&timezone=auto';
            fetch(url)
              .then(function (r) { return r.json(); })
              .then(function (data) {
                var cw = data && data.current_weather;
                if (!cw) { body.textContent = 'Could not load weather.'; return; }
                var icon = iconMap[cw.weathercode] || '\\uD83C\\uDF24\\uFE0F';
                var desc = codeMap[cw.weathercode] || 'Weather';
                var feelsLike = null, humidity = null;
                if (data.hourly && data.hourly.time) {
                  var idx = data.hourly.time.indexOf(cw.time);
                  if (idx === -1) idx = 0;
                  if (data.hourly.apparent_temperature) feelsLike = Math.round(data.hourly.apparent_temperature[idx]);
                  if (data.hourly.relative_humidity_2m) humidity = data.hourly.relative_humidity_2m[idx];
                }
                var hi = null, lo = null;
                if (data.daily && data.daily.temperature_2m_max) {
                  hi = Math.round(data.daily.temperature_2m_max[0]);
                  lo = Math.round(data.daily.temperature_2m_min[0]);
                }
                var html = '<div class="weather-main">'
                  + '<span class="weather-icon">' + icon + '</span>'
                  + '<div><div class="weather-temp">' + Math.round(cw.temperature) + '\\u00b0C</div>'
                  + '<div class="weather-desc">' + desc + '</div></div></div>';
                var details = [];
                if (feelsLike !== null) details.push('Feels ' + feelsLike + '\\u00b0');
                if (hi !== null) details.push('H:' + hi + '\\u00b0 L:' + lo + '\\u00b0');
                if (humidity !== null) details.push(humidity + '% humidity');
                if (details.length) html += '<div class="weather-details">' + details.join(' &middot; ') + '</div>';
                body.innerHTML = html;
              })
              .catch(function () { body.textContent = 'Could not load weather.'; });
          }, function () {
            body.textContent = 'Location permission denied.';
          });
        }
      }

      // Sync status dot: green when fresh, fading through yellow to red the
      // longer it's been since the last successful sync. Past 10 minutes
      // (double the normal 5-minute sync interval), shows a clear error.
      var syncedAtMs = ${syncedAtIso ? `new Date(${JSON.stringify(syncedAtIso)}).getTime()` : "null"};
      var dot = document.getElementById('syncDot');
      var errorBox = document.getElementById('syncError');
      if (syncedAtMs && dot) {
        var GREEN = [46, 204, 113], YELLOW = [241, 196, 15], RED = [231, 76, 60];
        function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
        function mix(c1, c2, t) {
          return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
        }
        function updateDot() {
          var elapsed = (Date.now() - syncedAtMs) / 1000;
          var c, isError = false;
          if (elapsed <= 300) {
            c = mix(GREEN, YELLOW, elapsed / 300);
          } else if (elapsed <= 600) {
            c = mix(YELLOW, RED, (elapsed - 300) / 300);
          } else {
            c = RED;
            isError = true;
          }
          var rgb = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
          var rgba = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.55)';
          document.documentElement.style.setProperty('--dot-color', rgb);
          document.documentElement.style.setProperty('--dot-glow', rgba);
          if (errorBox) errorBox.style.display = isError ? 'block' : 'none';
        }
        updateDot();
        setInterval(updateDot, 5000);
      }
    })();
  </script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
${THEME_BOOTSTRAP_SCRIPT}
<title>Carlam Schedules</title>
<style>${THEME_VARS_CSS}${THEME_PICKER_CSS}${USER_BADGE_CSS}${PAGE_STYLE}</style>
</head>
<body>
  ${THEME_PICKER_HTML}
  ${USER_BADGE_HTML}
  <div class="page">
    <div class="logo-wrap"><img class="logo" src="/carlam-logo.png" alt="Carlam"></div>
    <h1>Schedules</h1>
    ${statusHtml}
    ${syncErrorHtml}
    ${incidentHtml}
    ${widgetsHtml}

    ${itemsHtml}
  </div>
  ${weatherScript}
  ${THEME_PICKER_SCRIPT}
  ${USER_BADGE_SCRIPT}
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

  function renderEntry(r) {
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
  }

  const pastRows = myRows.filter((r) => r.start_date < today.toISOString().slice(0, 10));
  const currentRows = myRows.filter((r) => r.start_date >= today.toISOString().slice(0, 10));

  let itemsHtml;
  if (myRows.length === 0) {
    itemsHtml = `<div class="empty">Nothing tagged to you yet. If this looks wrong, check with Iestyn.</div>`;
  } else {
    const pastToggleHtml = pastRows.length
      ? `<button type="button" class="past-toggle" id="pastToggle">&darr; Show earlier (${pastRows.length})</button>
         <div class="past-entries" id="pastEntries">${pastRows.map(renderEntry).join("")}</div>`
      : "";
    const currentHtml = currentRows.length
      ? currentRows.map(renderEntry).join("")
      : `<div class="empty">Nothing upcoming right now.</div>`;
    itemsHtml = `${pastToggleHtml}${currentHtml}`;
  }

  const generatedAt = syncedAt ? escapeHtml(syncedAt) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
${THEME_BOOTSTRAP_SCRIPT}
<title>My Schedule - ${escapeHtml(personName)}</title>
<style>
${THEME_VARS_CSS}
${THEME_PICKER_CSS}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    max-width: 560px;
  }
  .top-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  a.back {
    display: inline-block;
    font-size: 13px;
    color: var(--text-dim);
    text-decoration: none;
  }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: var(--text-dim); margin-bottom: 20px; }
  .entry { margin-bottom: 10px; }
  .entry-date { font-size: 12px; font-weight: 600; color: var(--text-dim); margin-bottom: 4px; }
  .entry-body {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .entry-line { font-size: 14px; color: #1a1a1a; }
  .entry-notes { font-size: 12px; color: #444; font-style: italic; margin-top: 4px; }
  .entry.today .entry-date { color: var(--accent); }
  .entry.today .entry-body { border: 2px solid var(--accent); }
  .entry.past { opacity: 0.55; }
  .empty { color: var(--text-dim); font-size: 14px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .past-toggle {
    display: block;
    width: 100%;
    font-size: 13px;
    font-family: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 14px;
    margin-bottom: 14px;
    cursor: pointer;
    color: var(--text);
  }
  .past-toggle:hover { background: var(--surface-hover); }
  .past-entries { display: none; margin-bottom: 14px; }
  .past-entries.visible { display: block; }
</style>
</head>
<body>
  ${THEME_PICKER_HTML}
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>My Schedule</h1>
  <div class="meta">${escapeHtml(personName)} &middot; synced ${generatedAt} &middot; refreshes automatically every 2 minutes</div>
  ${itemsHtml}
  ${THEME_PICKER_SCRIPT}
  <script>
    (function () {
      var btn = document.getElementById('pastToggle');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var panel = document.getElementById('pastEntries');
        var beforeHeight = document.documentElement.scrollHeight;
        var expanded = panel.classList.toggle('visible');
        var afterHeight = document.documentElement.scrollHeight;
        window.scrollBy(0, afterHeight - beforeHeight);
        var count = panel.children.length;
        this.textContent = expanded ? '\u2191 Hide earlier' : '\u2193 Show earlier (' + count + ')';
      });
    })();
  </script>
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
const PAGEVIEW_KV_KEY = "analytics-pageviews";

// The specific incident this banner tracks - see
// https://www.cloudflarestatus.com/incidents/sjs8s0q2x4hw (Workers Cron
// Triggers degraded). Checked live against Cloudflare's own status API on
// every homepage load, so the banner disappears on its own once Cloudflare
// actually resolves it - nothing to manually remove later.
const TRACKED_INCIDENT_ID = "sjs8s0q2x4hw";

async function fetchCloudflareIncidentStatus() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch("https://www.cloudflarestatus.com/api/v2/incidents/unresolved.json", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;

    const data = await resp.json();
    const incident = (data.incidents || []).find((i) => i.id === TRACKED_INCIDENT_ID);
    if (!incident) return null;

    const statusLabels = {
      investigating: "Investigating",
      identified: "Identified \u2013 fix in progress",
      monitoring: "Monitoring the fix",
    };
    const latestUpdate =
      incident.incident_updates && incident.incident_updates[0] ? incident.incident_updates[0].body : "";

    return {
      name: incident.name,
      statusLabel: statusLabels[incident.status] || incident.status,
      latestUpdate,
      url: incident.shortlink || `https://www.cloudflarestatus.com/incidents/${incident.id}`,
    };
  } catch (err) {
    console.error("Failed to fetch Cloudflare incident status:", err);
    return null;
  }
}

async function trackPageView(env, pathname, viewerName) {
  if (!env.LEAVE_KV) return;
  try {
    const stored = await env.LEAVE_KV.get(PAGEVIEW_KV_KEY);
    const data = stored ? JSON.parse(stored) : { total: 0, byPath: {}, byDay: {}, recent: [] };

    data.total = (data.total || 0) + 1;
    data.byPath = data.byPath || {};
    data.byPath[pathname] = (data.byPath[pathname] || 0) + 1;

    const today = new Date().toISOString().slice(0, 10);
    data.byDay = data.byDay || {};
    data.byDay[today] = (data.byDay[today] || 0) + 1;
    // Keep roughly the last 60 days of daily buckets, no need to grow forever.
    const dayKeys = Object.keys(data.byDay).sort();
    if (dayKeys.length > 60) {
      for (const oldKey of dayKeys.slice(0, dayKeys.length - 60)) delete data.byDay[oldKey];
    }

    data.recent = data.recent || [];
    data.recent.unshift({ path: pathname, name: viewerName, time: new Date().toISOString() });
    data.recent = data.recent.slice(0, 60);

    await env.LEAVE_KV.put(PAGEVIEW_KV_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to track page view:", err);
  }
}

const LEAVE_LOG_KEY = "leave-changelog";
const DEFAULT_ALLOWANCE = 25;

const SICK_TRACKER_PATH = "/sick-tracker";
const SICK_KV_KEY = "sick-allowances";
const SICK_LOG_KEY = "sick-changelog";
const DEFAULT_SICK_ALLOWANCE = 10;

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
  let total = 0;
  for (const r of rows) {
    if (!Array.isArray(r.people) || !r.people.includes(personName)) continue;
    if (!r.start_date || r.start_date < sinceISODate) continue;
    if (r.status === "A/L") total += 1;
    else if (r.status === "A/L (Half Day)") total += 0.5;
  }
  return total;
}

function countUsedSickDays(personName, rows, sinceISODate) {
  if (!sinceISODate) return 0;
  let total = 0;
  for (const r of rows) {
    if (!Array.isArray(r.people) || !r.people.includes(personName)) continue;
    if (!r.start_date || r.start_date < sinceISODate) continue;
    if (r.status === "Sick") total += 1;
  }
  return total;
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

function renderMyAnnualLeave(personName, allowance, resetDate, sinceISO, usedDays, takenRows) {
  const remaining = allowance - usedDays;
  const remainingClass = remaining < 0 ? "over" : remaining <= 3 ? "low" : "";

  const sortedTaken = [...takenRows].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const datesHtml = sortedTaken.length
    ? sortedTaken
        .map((r) => {
          const d = new Date(r.start_date + "T00:00:00");
          const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
          const halfTag = r.status === "A/L (Half Day)" ? " (half day)" : "";
          return `<div class="taken-row"><span class="taken-date">${escapeHtml(label)}</span><span class="taken-tag">${escapeHtml(r.status)}${escapeHtml(halfTag)}</span></div>`;
        })
        .join("")
    : `<div class="empty">No annual leave taken since your last reset.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
${THEME_BOOTSTRAP_SCRIPT}
<title>My Annual Leave</title>
<style>
${THEME_VARS_CSS}
${THEME_PICKER_CSS}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    max-width: 480px;
  }
  a.back { display: inline-block; font-size: 13px; color: var(--text-dim); text-decoration: none; margin-bottom: 12px; }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: var(--text-dim); margin-bottom: 20px; }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 20px;
  }
  .summary-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 10px;
    text-align: center;
  }
  .summary-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .summary-value { font-size: 22px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; margin-top: 4px; }
  .summary-value.over { color: #e05a5a; }
  .summary-value.low { color: #e0a938; }
  .reset-note { font-size: 12px; color: var(--text-dim); margin-bottom: 20px; }
  .section-title { font-size: 14px; font-weight: 600; margin: 0 0 10px; }
  .taken-list { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .taken-row { display: flex; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
  .taken-row:last-child { border-bottom: none; }
  .taken-tag { color: var(--text-dim); }
  .empty { color: var(--text-dim); font-size: 13px; padding: 14px; }
</style>
</head>
<body>
  ${THEME_PICKER_HTML}
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>My Annual Leave</h1>
  <div class="meta">${escapeHtml(personName)} &middot; view only</div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-label">Allowance</div>
      <div class="summary-value">${allowance}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Used</div>
      <div class="summary-value">${usedDays}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Remaining</div>
      <div class="summary-value ${remainingClass}">${remaining}</div>
    </div>
  </div>
  <div class="reset-note">${sinceISO ? `Counted since your last reset on ${escapeHtml(sinceISO)}${resetDate ? ` (resets annually on ${escapeHtml(resetDate)})` : ""}` : "No reset date has been set for you yet - check with Iestyn."}</div>

  <div class="section-title">Days taken</div>
  <div class="taken-list">${datesHtml}</div>

  ${THEME_PICKER_SCRIPT}
</body>
</html>`;
}

function renderLeaveTracker(leaveData, rows, changeLog) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Everyone with a real name is eligible to appear here, in a stable order.
  // People excluded from this specific tracker (not removed from the
  // system generally - they still keep their normal schedule access etc).
  const LEAVE_TRACKER_EXCLUDED = new Set(["Ceri Siggins"]);
  const people = Object.values(EMAIL_TO_NAME)
    .filter((name) => !LEAVE_TRACKER_EXCLUDED.has(name))
    .sort();

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
        <td><input type="number" class="allowance-input" min="0" step="0.5" value="${allowance}"></td>
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
${THEME_BOOTSTRAP_SCRIPT}
<title>Annual Leave Tracker</title>
<style>
${THEME_VARS_CSS}
${THEME_PICKER_CSS}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
  }
  .top-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  a.back {
    display: inline-block;
    font-size: 13px;
    color: var(--text-dim);
    text-decoration: none;
  }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: var(--text-dim); margin-bottom: 16px; }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }
  table { border-collapse: collapse; min-width: 100%; }
  th, td {
    border: 1px solid var(--border);
    padding: 8px 10px;
    text-align: left;
    font-size: 13px;
    white-space: nowrap;
    color: var(--text);
  }
  thead th {
    background: #333;
    color: #fff;
  }
  .name-cell { font-weight: 600; }
  input.allowance-input { width: 60px; padding: 4px; font-size: 13px; }
  input.reset-input { padding: 4px; font-size: 13px; }
  .reset-note { color: var(--text-dim); font-size: 12px; }
  td.over { color: #c0392b; font-weight: 700; }
  td.low { color: #d18a1f; font-weight: 700; }
  .save-bar { margin-top: 16px; display: flex; align-items: center; gap: 12px; }
  button.save-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }
  button.save-btn:hover { opacity: 0.9; }
  button.save-btn:disabled { background: #999; cursor: default; }
  .save-message { font-size: 13px; color: #2a7a2a; }
  .log-toggle-wrap { margin-top: 24px; }
  .log-toggle {
    font-size: 13px;
    font-family: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 14px;
    cursor: pointer;
    color: var(--text);
  }
  .log-toggle:hover { background: var(--surface-hover); }
  .log-panel {
    display: none;
    margin-top: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    max-height: 320px;
    overflow-y: auto;
  }
  .log-panel.visible { display: block; }
  .log-entry {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    flex-wrap: wrap;
  }
  .log-entry:last-child { border-bottom: none; }
  .log-time { color: var(--text-dim); min-width: 140px; }
  .log-by { font-weight: 600; min-width: 110px; }
  .log-desc { color: var(--text); }
  .log-empty { padding: 14px; color: var(--text-dim); font-size: 13px; }
</style>
</head>
<body>
  ${THEME_PICKER_HTML}
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
        const allowance = parseFloat(row.querySelector('.allowance-input').value) || 0;
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
  ${THEME_PICKER_SCRIPT}
</body>
</html>`;
}

function renderSickTracker(sickData, rows, changeLog) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const people = Object.values(EMAIL_TO_NAME).sort();

  const rowsHtml = people
    .map((name) => {
      const saved = sickData[name] || {};
      const allowance = typeof saved.allowance === "number" ? saved.allowance : DEFAULT_SICK_ALLOWANCE;
      const resetDate = saved.resetDate || "";
      const mostRecent = mostRecentResetDate(resetDate, today);
      const sinceISO = mostRecent ? toISODateString(mostRecent) : null;
      const used = countUsedSickDays(name, rows, sinceISO);
      const remaining = allowance - used;
      const remainingClass = remaining < 0 ? "over" : remaining <= 2 ? "low" : "";

      return `<tr data-person="${escapeHtml(name)}">
        <td class="name-cell">${escapeHtml(name)}</td>
        <td><input type="number" class="allowance-input" min="0" step="0.5" value="${allowance}"></td>
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
${THEME_BOOTSTRAP_SCRIPT}
<title>Sick Days Tracker</title>
<style>
${THEME_VARS_CSS}
${THEME_PICKER_CSS}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
  }
  .top-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  a.back {
    display: inline-block;
    font-size: 13px;
    color: var(--text-dim);
    text-decoration: none;
  }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: var(--text-dim); margin-bottom: 16px; }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
  }
  table { border-collapse: collapse; min-width: 100%; }
  th, td {
    border: 1px solid var(--border);
    padding: 8px 10px;
    text-align: left;
    font-size: 13px;
    white-space: nowrap;
    color: var(--text);
  }
  thead th {
    background: #333;
    color: #fff;
  }
  .name-cell { font-weight: 600; }
  input.allowance-input { width: 60px; padding: 4px; font-size: 13px; }
  input.reset-input { padding: 4px; font-size: 13px; }
  .reset-note { color: var(--text-dim); font-size: 12px; }
  td.over { color: #c0392b; font-weight: 700; }
  td.low { color: #d18a1f; font-weight: 700; }
  .save-bar { margin-top: 16px; display: flex; align-items: center; gap: 12px; }
  button.save-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }
  button.save-btn:hover { opacity: 0.9; }
  button.save-btn:disabled { background: #999; cursor: default; }
  .save-message { font-size: 13px; color: #2a7a2a; }
  .log-toggle-wrap { margin-top: 24px; }
  .log-toggle {
    font-size: 13px;
    font-family: inherit;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 14px;
    cursor: pointer;
    color: var(--text);
  }
  .log-toggle:hover { background: var(--surface-hover); }
  .log-panel {
    display: none;
    margin-top: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    max-height: 320px;
    overflow-y: auto;
  }
  .log-panel.visible { display: block; }
  .log-entry {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    flex-wrap: wrap;
  }
  .log-entry:last-child { border-bottom: none; }
  .log-time { color: var(--text-dim); min-width: 140px; }
  .log-by { font-weight: 600; min-width: 110px; }
  .log-desc { color: var(--text); }
  .log-empty { padding: 14px; color: var(--text-dim); font-size: 13px; }
</style>
</head>
<body>
  ${THEME_PICKER_HTML}
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>Sick Days Tracker</h1>
  <div class="meta">Allowance and reset dates are editable here directly. "Used" counts Sick days since each person's most recent reset date.</div>
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
        const allowance = parseFloat(row.querySelector('.allowance-input').value) || 0;
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
  ${THEME_PICKER_SCRIPT}
</body>
</html>`;
}

function parseRssHeadlines(xmlText, limit) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null && items.length < limit) {
    const block = match[1];
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    if (titleMatch && linkMatch) {
      let title = titleMatch[1].trim();
      title = title.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
      const link = linkMatch[1].trim();
      let description = "";
      if (descMatch) {
        description = descMatch[1]
          .replace(/^<!\[CDATA\[/, "")
          .replace(/\]\]>$/, "")
          .replace(/<[^>]+>/g, "")
          .trim();
      }
      items.push({ title, link, description });
    }
  }
  return items;
}

// --- Annual Leave Requests --------------------------------------------
// A full request -> approve/deny -> auto-create schedule rows workflow.
// Requests are stored in the same LEAVE_KV namespace as the trackers.
// Approving a request writes real rows into Notion directly via its REST
// API (not through GitHub Actions), and both submission and decision
// trigger a real email via Microsoft Graph, sent through the
// system@carlamltd.com shared mailbox.

const REQUEST_KV_KEY = "leave-requests";
const NOTION_DATABASE_ID = "cb3f71d4936942aeba976fd6a3b17e8a";
const MAIL_FROM = "system@carlamltd.com";
const APPROVER_EMAILS = ["eurosllyr@carlamltd.com"];

function generateRequestId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// Expands a start/end date range into individual weekday dates (weekends
// are skipped, since leave isn't normally booked against non-working
// days), applying the half-day flag only to the first and/or last day.
function expandLeaveDates(startDate, endDate, halfDayStart, halfDayEnd) {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const days = [];
  let current = new Date(start);
  while (current.getTime() <= end.getTime()) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) {
      const iso = toISODateString(current);
      const isFirst = iso === startDate;
      const isLast = iso === endDate;
      const isHalf = (isFirst && halfDayStart) || (isLast && halfDayEnd);
      days.push({ date: iso, status: isHalf ? "A/L (Half Day)" : "A/L" });
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
}

async function createNotionLeavePage(env, personName, dateStr, status, noteText) {
  const resp = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        Task: { title: [{ text: { content: "Annual Leave" } }] },
        "Person Name": { select: { name: personName } },
        Status: { select: { name: status } },
        Date: { date: { start: dateStr } },
        Notes: { rich_text: [{ text: { content: noteText } }] },
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("Notion create page failed:", resp.status, text);
    throw new Error("Failed to create Notion row: " + text);
  }
  return resp.json();
}

async function createNotionRowsForRequest(env, request) {
  const days = expandLeaveDates(request.startDate, request.endDate, request.halfDayStart, request.halfDayEnd);
  const decidedAtFormatted = formatLogTime(request.decidedAt);
  const noteText = `Approved by ${request.decidedBy} on ${decidedAtFormatted}`;
  for (const day of days) {
    await createNotionLeavePage(env, request.personName, day.date, day.status, noteText);
  }
  return days.length;
}

function renderRequestForm(personName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${THEME_BOOTSTRAP_SCRIPT}
<title>Request Annual Leave</title>
<style>
${THEME_VARS_CSS}
${THEME_PICKER_CSS}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    max-width: 480px;
  }
  a.back { display: inline-block; font-size: 13px; color: var(--text-dim); text-decoration: none; margin-bottom: 12px; }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: var(--text-dim); margin-bottom: 20px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input[type="date"], textarea {
    width: 100%;
    padding: 8px 10px;
    font-size: 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    box-sizing: border-box;
  }
  textarea { min-height: 80px; resize: vertical; }
  .half-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; font-weight: 400; }
  .half-row input { width: auto; }
  button.submit-btn {
    margin-top: 20px;
    background: var(--accent);
    color: #fff;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    width: 100%;
  }
  button.submit-btn:hover { opacity: 0.9; }
  button.submit-btn:disabled { background: #999; cursor: default; }
  .form-message { margin-top: 14px; font-size: 13px; padding: 10px 12px; border-radius: 6px; }
  .form-message.success { background: #d9ead3; color: #1a4d1a; }
  .form-message.error { background: #f4cccc; color: #7a1a1a; }
</style>
</head>
<body>
  ${THEME_PICKER_HTML}
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>Request Annual Leave</h1>
  <div class="meta">Requesting as ${escapeHtml(personName)}</div>

  <form id="leaveForm">
    <label for="startDate">Start date</label>
    <input type="date" id="startDate" name="startDate" required>

    <label for="endDate">End date</label>
    <input type="date" id="endDate" name="endDate" required>

    <div class="half-row">
      <input type="checkbox" id="halfDayStart" name="halfDayStart">
      <label for="halfDayStart" style="margin:0; font-weight:400;" id="halfStartLabel">First day is a half day</label>
    </div>
    <div class="half-row" id="halfEndRow" style="display:none;">
      <input type="checkbox" id="halfDayEnd" name="halfDayEnd">
      <label for="halfDayEnd" style="margin:0; font-weight:400;">Last day is a half day</label>
    </div>

    <label for="reason">Reason</label>
    <textarea id="reason" name="reason" required></textarea>

    <button type="submit" class="submit-btn" id="submitBtn">Submit Request</button>
    <div id="formMessage"></div>
  </form>

  ${THEME_PICKER_SCRIPT}
  <script>
    (function () {
      var startInput = document.getElementById('startDate');
      var endInput = document.getElementById('endDate');
      var halfEndRow = document.getElementById('halfEndRow');
      var halfStartLabel = document.getElementById('halfStartLabel');

      function syncHalfDayUI() {
        var single = startInput.value && startInput.value === endInput.value;
        halfEndRow.style.display = single ? 'none' : 'flex';
        halfStartLabel.textContent = single ? 'Half day' : 'First day is a half day';
      }
      startInput.addEventListener('change', function () {
        if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value;
        syncHalfDayUI();
      });
      endInput.addEventListener('change', syncHalfDayUI);

      document.getElementById('leaveForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = document.getElementById('submitBtn');
        var msg = document.getElementById('formMessage');
        btn.disabled = true;
        msg.innerHTML = '';

        var payload = {
          startDate: startInput.value,
          endDate: endInput.value,
          halfDayStart: document.getElementById('halfDayStart').checked,
          halfDayEnd: document.getElementById('halfDayEnd').checked,
          reason: document.getElementById('reason').value,
        };

        try {
          var resp = await fetch('/request-leave', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          var data = await resp.json();
          if (resp.ok) {
            msg.innerHTML = '<div class="form-message success">Request submitted. <a href="my-leave-requests">View your requests</a></div>';
            document.getElementById('leaveForm').reset();
          } else {
            msg.innerHTML = '<div class="form-message error">' + (data.error || 'Something went wrong.') + '</div>';
            btn.disabled = false;
          }
        } catch (err) {
          msg.innerHTML = '<div class="form-message error">Could not submit - check your connection.</div>';
          btn.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`;
}

async function getGraphToken(env) {
  const resp = await fetch(`https://login.microsoftonline.com/${env.MAIL_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MAIL_CLIENT_ID,
      client_secret: env.MAIL_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error("Graph token error:", data);
    throw new Error("Failed to get mail token");
  }
  return data.access_token;
}

async function sendMail(env, toAddresses, subject, htmlBody) {
  try {
    const token = await getGraphToken(env);
    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${MAIL_FROM}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: htmlBody },
          toRecipients: toAddresses.map((a) => ({ emailAddress: { address: a } })),
        },
        saveToSentItems: false,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("sendMail failed:", resp.status, text);
    }
  } catch (err) {
    console.error("sendMail error:", err);
  }
}

async function getLeaveRequests(env) {
  try {
    const stored = await env.LEAVE_KV.get(REQUEST_KV_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.error("Failed to read leave requests:", err);
    return [];
  }
}

async function saveLeaveRequests(env, requests) {
  await env.LEAVE_KV.put(REQUEST_KV_KEY, JSON.stringify(requests));
}

function formatDateRangeLabel(startDate, endDate, halfDayStart, halfDayEnd) {
  const fmt = (d) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  let label = startDate === endDate ? fmt(startDate) : `${fmt(startDate)} \u2192 ${fmt(endDate)}`;
  const halves = [];
  if (halfDayStart) halves.push("first day half");
  if (halfDayEnd && endDate !== startDate) halves.push("last day half");
  if (halfDayStart && startDate === endDate) return `${label} (half day)`;
  if (halves.length) label += ` (${halves.join(", ")})`;
  return label;
}

function renderMyRequests(personName, requests) {
  const mine = requests
    .filter((r) => r.personName === personName)
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  const itemsHtml = mine.length
    ? mine
        .map((r) => {
          const label = formatDateRangeLabel(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd);
          let statusHtml;
          if (r.status === "pending") {
            statusHtml = `<span class="req-status pending">In Progress</span>`;
          } else if (r.status === "accepted") {
            statusHtml = `<span class="req-status accepted">Accepted</span> <span class="req-decided">by ${escapeHtml(r.decidedBy)}, ${escapeHtml(formatLogTime(r.decidedAt))}</span>`;
          } else {
            statusHtml = `<span class="req-status rejected">Rejected</span> <span class="req-decided">by ${escapeHtml(r.decidedBy)}, ${escapeHtml(formatLogTime(r.decidedAt))}</span>`;
          }
          const noteHtml = r.status === "rejected" && r.rejectionNote
            ? `<div class="req-note">Reason: ${escapeHtml(r.rejectionNote)}</div>`
            : "";
          return `<div class="req-card">
            <div class="req-dates">${escapeHtml(label)}</div>
            <div class="req-reason">${escapeHtml(r.reason)}</div>
            <div class="req-status-row">${statusHtml}</div>
            ${noteHtml}
          </div>`;
        })
        .join("")
    : `<div class="empty">You haven't requested any annual leave yet.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
${THEME_BOOTSTRAP_SCRIPT}
<title>My Leave Requests</title>
<style>
${THEME_VARS_CSS}
${THEME_PICKER_CSS}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    max-width: 560px;
  }
  a.back { display: inline-block; font-size: 13px; color: var(--text-dim); text-decoration: none; margin-bottom: 12px; }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: var(--text-dim); margin-bottom: 20px; }
  .req-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 10px;
  }
  .req-dates { font-weight: 600; font-size: 14px; }
  .req-reason { font-size: 13px; color: var(--text-dim); margin-top: 4px; }
  .req-status-row { margin-top: 8px; font-size: 12px; }
  .req-status { font-weight: 700; padding: 2px 8px; border-radius: 10px; }
  .req-status.pending { background: #fff2cc; color: #7a5b00; }
  .req-status.accepted { background: #d9ead3; color: #1a4d1a; }
  .req-status.rejected { background: #f4cccc; color: #7a1a1a; }
  .req-decided { color: var(--text-dim); }
  .req-note { font-size: 12px; color: var(--text-dim); font-style: italic; margin-top: 6px; }
  .empty { color: var(--text-dim); font-size: 14px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
</style>
</head>
<body>
  ${THEME_PICKER_HTML}
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>My Leave Requests</h1>
  <div class="meta">${escapeHtml(personName)}</div>
  ${itemsHtml}
  ${THEME_PICKER_SCRIPT}
</body>
</html>`;
}

function renderApprovalsPage(requests, message) {
  const pending = requests.filter((r) => r.status === "pending").sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : 1));
  const decided = requests.filter((r) => r.status !== "pending").sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));

  const pendingHtml = pending.length
    ? pending
        .map((r) => {
          const label = formatDateRangeLabel(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd);
          return `<div class="req-card" data-id="${escapeHtml(r.id)}">
            <div class="req-summary" onclick="toggleDetail('${escapeHtml(r.id)}')">
              <div>
                <div class="req-dates">${escapeHtml(r.personName)} &middot; ${escapeHtml(label)}</div>
                <div class="req-reason-preview">${escapeHtml(r.reason.slice(0, 60))}${r.reason.length > 60 ? "\u2026" : ""}</div>
              </div>
              <span class="expand-arrow">&darr;</span>
            </div>
            <div class="req-detail" id="detail-${escapeHtml(r.id)}">
              <div class="req-reason">${escapeHtml(r.reason)}</div>
              <div class="req-submitted">Submitted ${escapeHtml(formatLogTime(r.submittedAt))}</div>
              <div class="decision-row">
                <button class="approve-btn" onclick="decide('${escapeHtml(r.id)}', 'accept')">Approve</button>
                <button class="deny-btn" onclick="showDenyNote('${escapeHtml(r.id)}')">Deny</button>
              </div>
              <div class="deny-note-row" id="denyRow-${escapeHtml(r.id)}" style="display:none;">
                <textarea id="denyNote-${escapeHtml(r.id)}" placeholder="Reason for declining (required)"></textarea>
                <button class="confirm-deny-btn" onclick="decide('${escapeHtml(r.id)}', 'reject')">Confirm Deny</button>
              </div>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="empty">No pending requests.</div>`;

  const decidedHtml = decided.length
    ? decided
        .map((r) => {
          const label = formatDateRangeLabel(r.startDate, r.endDate, r.halfDayStart, r.halfDayEnd);
          const statusClass = r.status === "accepted" ? "accepted" : "rejected";
          return `<div class="log-entry">
            <span class="log-time">${escapeHtml(formatLogTime(r.decidedAt))}</span>
            <span class="req-status ${statusClass}">${r.status === "accepted" ? "Accepted" : "Rejected"}</span>
            <span class="log-desc">${escapeHtml(r.personName)} \u2014 ${escapeHtml(label)}, decided by ${escapeHtml(r.decidedBy)}</span>
          </div>`;
        })
        .join("")
    : `<div class="log-empty">No decisions yet.</div>`;

  const messageHtml = message ? `<div class="page-message">${escapeHtml(message)}</div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${THEME_BOOTSTRAP_SCRIPT}
<title>Approve Leave Requests</title>
<style>
${THEME_VARS_CSS}
${THEME_PICKER_CSS}
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    max-width: 560px;
  }
  a.back { display: inline-block; font-size: 13px; color: var(--text-dim); text-decoration: none; margin-bottom: 12px; }
  a.back:hover { text-decoration: underline; }
  h1 { font-size: 20px; margin: 0 0 4px 0; }
  .meta { font-size: 13px; color: var(--text-dim); margin-bottom: 16px; }
  .page-message { font-size: 13px; padding: 10px 12px; border-radius: 6px; background: #d9ead3; color: #1a4d1a; margin-bottom: 14px; }
  .req-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
  .req-summary { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; cursor: pointer; }
  .req-dates { font-weight: 600; font-size: 14px; }
  .req-reason-preview { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
  .expand-arrow { color: var(--text-dim); }
  .req-detail { display: none; padding: 0 14px 14px; border-top: 1px solid var(--border); }
  .req-detail.open { display: block; }
  .req-reason { font-size: 13px; padding-top: 10px; }
  .req-submitted { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
  .decision-row { display: flex; gap: 10px; margin-top: 12px; }
  .approve-btn, .deny-btn, .confirm-deny-btn {
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
    color: #fff;
  }
  .approve-btn { background: #2a9d4a; }
  .deny-btn { background: #c0392b; }
  .confirm-deny-btn { background: #c0392b; margin-top: 8px; }
  .deny-note-row { margin-top: 10px; }
  .deny-note-row textarea {
    width: 100%;
    min-height: 60px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
    box-sizing: border-box;
  }
  .empty { color: var(--text-dim); font-size: 14px; padding: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .decided-heading { font-size: 14px; font-weight: 600; margin: 24px 0 10px; }
  .log-entry { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12px; flex-wrap: wrap; background: var(--surface); border-radius: 6px; margin-bottom: 6px; }
  .log-time { color: var(--text-dim); min-width: 130px; }
  .log-desc { color: var(--text); }
  .log-empty { padding: 14px; color: var(--text-dim); font-size: 13px; }
  .req-status { font-weight: 700; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
  .req-status.accepted { background: #d9ead3; color: #1a4d1a; }
  .req-status.rejected { background: #f4cccc; color: #7a1a1a; }
</style>
</head>
<body>
  ${THEME_PICKER_HTML}
  <a class="back" href="index.html">&larr; All schedules</a>
  <h1>Approve Leave Requests</h1>
  <div class="meta">Click a request to see full details and decide.</div>
  ${messageHtml}
  ${pendingHtml}
  <div class="decided-heading">Recent decisions</div>
  ${decidedHtml}
  ${THEME_PICKER_SCRIPT}
  <script>
    function toggleDetail(id) {
      document.getElementById('detail-' + id).classList.toggle('open');
    }
    function showDenyNote(id) {
      document.getElementById('denyRow-' + id).style.display = 'block';
    }
    async function decide(id, action) {
      var note = '';
      if (action === 'reject') {
        note = document.getElementById('denyNote-' + id).value.trim();
        if (!note) {
          alert('Please add a reason before denying.');
          return;
        }
      }
      try {
        var resp = await fetch('/approve-leave', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: id, action: action, note: note }),
        });
        if (resp.ok) {
          location.reload();
        } else {
          var data = await resp.json();
          alert(data.error || 'Something went wrong.');
        }
      } catch (err) {
        alert('Could not submit - check your connection.');
      }
    }
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Track this as a page view - runs for every single request (dynamic
    // Worker routes and static schedule pages alike, since both pass
    // through this same handler), but skipped for data/asset files that
    // aren't really "pages" a person is browsing, and never blocks the
    // actual response.
    if (
      request.method === "GET" &&
      !url.pathname.match(/\.(json|ics|png|xlsx|jpg|svg|ico)$/)
    ) {
      const viewerEmail = decodeAccessEmail(request);
      const viewerName = viewerEmail ? EMAIL_TO_NAME[viewerEmail] || null : null;
      ctx.waitUntil(trackPageView(env, url.pathname, viewerName));
    }

    if (url.pathname === "/whoami") {
      const email = decodeAccessEmail(request);
      const name = email ? EMAIL_TO_NAME[email] || null : null;
      return new Response(JSON.stringify({ name, email: email || null }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/analytics") {
      const email = decodeAccessEmail(request);
      if (email !== "iestyn@carlamltd.com") {
        return new Response("Not authorised.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      let pageviews = { total: 0, byPath: {}, byDay: {}, recent: [] };
      let requests = [];
      let scheduleRows = [];
      let syncedAt = null;

      try {
        if (env.LEAVE_KV) {
          const stored = await env.LEAVE_KV.get(PAGEVIEW_KV_KEY);
          if (stored) pageviews = JSON.parse(stored);
          const storedRequests = await env.LEAVE_KV.get(REQUEST_KV_KEY);
          if (storedRequests) requests = JSON.parse(storedRequests);
        }
      } catch (err) {
        console.error("Failed to load analytics KV data:", err);
      }

      try {
        const dataResp = await env.ASSETS.fetch(new URL("/schedule-data.json", request.url));
        if (dataResp.ok) scheduleRows = await dataResp.json();
        const syncResp = await env.ASSETS.fetch(new URL("/last-sync.json", request.url));
        if (syncResp.ok) {
          const syncData = await syncResp.json();
          syncedAt = syncData.synced_at || null;
        }
      } catch (err) {
        console.error("Failed to load schedule data for analytics:", err);
      }

      return new Response(renderAnalytics(pageviews, requests, scheduleRows, syncedAt), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/my-annual-leave") {
      const email = decodeAccessEmail(request);
      const personName = email ? EMAIL_TO_NAME[email] : null;

      if (!personName) {
        return new Response("Your account isn't linked to a name yet. Check with Iestyn.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let saved = {};
      try {
        if (env.LEAVE_KV) {
          const stored = await env.LEAVE_KV.get(LEAVE_KV_KEY);
          const leaveData = stored ? JSON.parse(stored) : {};
          saved = leaveData[personName] || {};
        }
      } catch (err) {
        console.error("Failed to read leave allowance for /my-annual-leave:", err);
      }

      const allowance = typeof saved.allowance === "number" ? saved.allowance : DEFAULT_ALLOWANCE;
      const resetDate = saved.resetDate || "";
      const mostRecent = mostRecentResetDate(resetDate, today);
      const sinceISO = mostRecent ? toISODateString(mostRecent) : null;

      let rows = [];
      try {
        const dataResp = await env.ASSETS.fetch(new URL("/schedule-data.json", request.url));
        if (dataResp.ok) rows = await dataResp.json();
      } catch (err) {
        console.error("Failed to load schedule data for /my-annual-leave:", err);
      }

      const usedDays = countUsedALDays(personName, rows, sinceISO);
      const takenRows = rows.filter(
        (r) =>
          Array.isArray(r.people) &&
          r.people.includes(personName) &&
          (r.status === "A/L" || r.status === "A/L (Half Day)") &&
          r.start_date &&
          (!sinceISO || r.start_date >= sinceISO)
      );

      return new Response(renderMyAnnualLeave(personName, allowance, resetDate, sinceISO, usedDays, takenRows), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const email = decodeAccessEmail(request);

      let syncedAt = null;
      let syncedAtIso = null;
      try {
        const syncResp = await env.ASSETS.fetch(new URL("/last-sync.json", request.url));
        if (syncResp.ok) {
          const data = await syncResp.json();
          syncedAt = data.synced_at || null;
          syncedAtIso = data.synced_at_iso || null;
        }
      } catch (err) {
        // If this fails for any reason, the page still renders fine without it.
      }

      const headlines = [];
      const incidentInfo = await fetchCloudflareIncidentStatus();

      return new Response(renderIndex(email, syncedAt, headlines, syncedAtIso, incidentInfo), {
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

    if (url.pathname === SICK_TRACKER_PATH) {
      const email = decodeAccessEmail(request);

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

        const clean = {};
        for (const [name, val] of Object.entries(incoming || {})) {
          if (typeof name !== "string") continue;
          const allowance = Number(val && val.allowance);
          const resetDate = typeof (val && val.resetDate) === "string" ? val.resetDate : "";
          if (!Number.isFinite(allowance) || allowance < 0) continue;
          clean[name] = { allowance, resetDate };
        }

        let previous = {};
        try {
          const stored = await env.LEAVE_KV.get(SICK_KV_KEY);
          if (stored) previous = JSON.parse(stored);
        } catch (err) {
          console.error("Failed to read previous sick data for diffing:", err);
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
            const storedLog = await env.LEAVE_KV.get(SICK_LOG_KEY);
            if (storedLog) log = JSON.parse(storedLog);
          } catch (err) {
            console.error("Failed to read existing sick change log:", err);
          }
          log = [...newLogEntries.reverse(), ...log].slice(0, 300);
          await env.LEAVE_KV.put(SICK_LOG_KEY, JSON.stringify(log));
        }

        await env.LEAVE_KV.put(SICK_KV_KEY, JSON.stringify(clean));
        return new Response(JSON.stringify({ ok: true, changes: newLogEntries.length }), {
          headers: { "content-type": "application/json" },
        });
      }

      let sickData = {};
      let sickChangeLog = [];
      try {
        const stored = await env.LEAVE_KV.get(SICK_KV_KEY);
        if (stored) sickData = JSON.parse(stored);
        const storedLog = await env.LEAVE_KV.get(SICK_LOG_KEY);
        if (storedLog) sickChangeLog = JSON.parse(storedLog);
      } catch (err) {
        console.error("Failed to read sick data from KV:", err);
      }

      let sickRows = [];
      try {
        const dataResp = await env.ASSETS.fetch(new URL("/schedule-data.json", request.url));
        if (dataResp.ok) sickRows = await dataResp.json();
      } catch (err) {
        console.error("Failed to load schedule data for sick tracker:", err);
      }

      return new Response(renderSickTracker(sickData, sickRows, sickChangeLog), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/request-leave") {
      const email = decodeAccessEmail(request);
      const personName = email ? EMAIL_TO_NAME[email] : null;

      if (!personName) {
        return new Response("Your account isn't linked to a name yet. Check with Iestyn.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      if (request.method === "POST") {
        if (!env.LEAVE_KV) {
          return new Response(JSON.stringify({ error: "Storage isn't set up (missing LEAVE_KV binding)." }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        let body;
        try {
          body = await request.json();
        } catch (err) {
          return new Response(JSON.stringify({ error: "Invalid data." }), { status: 400, headers: { "content-type": "application/json" } });
        }

        const startDate = typeof body.startDate === "string" ? body.startDate : "";
        const endDate = typeof body.endDate === "string" ? body.endDate : "";
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        const halfDayStart = !!body.halfDayStart;
        const halfDayEnd = !!body.halfDayEnd;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          return new Response(JSON.stringify({ error: "Please provide valid dates." }), { status: 400, headers: { "content-type": "application/json" } });
        }
        if (endDate < startDate) {
          return new Response(JSON.stringify({ error: "End date can't be before the start date." }), { status: 400, headers: { "content-type": "application/json" } });
        }
        if (!reason) {
          return new Response(JSON.stringify({ error: "Please add a reason." }), { status: 400, headers: { "content-type": "application/json" } });
        }

        const newRequest = {
          id: generateRequestId(),
          personEmail: email,
          personName,
          startDate,
          endDate,
          halfDayStart,
          halfDayEnd,
          reason,
          submittedAt: new Date().toISOString(),
          status: "pending",
          decidedBy: null,
          decidedAt: null,
          rejectionNote: null,
        };

        const requests = await getLeaveRequests(env);
        requests.push(newRequest);
        await saveLeaveRequests(env, requests);

        const label = formatDateRangeLabel(startDate, endDate, halfDayStart, halfDayEnd);
        ctx.waitUntil(
          sendMail(
            env,
            APPROVER_EMAILS,
            `Annual leave request - ${personName}`,
            `<p><strong>${escapeHtml(personName)}</strong> has requested annual leave.</p>
             <p><strong>Dates:</strong> ${escapeHtml(label)}<br>
             <strong>Reason:</strong> ${escapeHtml(reason)}</p>
             <p><a href="https://carlam-schedule.iestyn-041.workers.dev/approve-leave">Review this request</a></p>`
          )
        );

        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }

      return new Response(renderRequestForm(personName), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/my-leave-requests") {
      const email = decodeAccessEmail(request);
      const personName = email ? EMAIL_TO_NAME[email] : null;

      if (!personName) {
        return new Response("Your account isn't linked to a name yet. Check with Iestyn.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      const requests = env.LEAVE_KV ? await getLeaveRequests(env) : [];
      return new Response(renderMyRequests(personName, requests), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }

    if (url.pathname === "/approve-leave") {
      const email = decodeAccessEmail(request);

      if (!email || !ANNUAL_LEAVE_VIEWERS.has(email)) {
        return new Response("Not authorised.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      if (!env.LEAVE_KV) {
        return new Response("Leave data storage isn't set up yet (missing LEAVE_KV binding).", {
          status: 500,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      if (request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch (err) {
          return new Response(JSON.stringify({ error: "Invalid data." }), { status: 400, headers: { "content-type": "application/json" } });
        }

        const { id, action, note } = body;
        if (!id || (action !== "accept" && action !== "reject")) {
          return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400, headers: { "content-type": "application/json" } });
        }
        if (action === "reject" && !(note && note.trim())) {
          return new Response(JSON.stringify({ error: "A reason is required to deny a request." }), { status: 400, headers: { "content-type": "application/json" } });
        }

        const requests = await getLeaveRequests(env);
        const idx = requests.findIndex((r) => r.id === id);
        if (idx === -1) {
          return new Response(JSON.stringify({ error: "Request not found." }), { status: 404, headers: { "content-type": "application/json" } });
        }
        if (requests[idx].status !== "pending") {
          return new Response(JSON.stringify({ error: "This request has already been decided." }), { status: 400, headers: { "content-type": "application/json" } });
        }

        const decidedBy = EMAIL_TO_NAME[email] || email;
        const nowISO = new Date().toISOString();
        const reqRecord = requests[idx];

        reqRecord.status = action === "accept" ? "accepted" : "rejected";
        reqRecord.decidedBy = decidedBy;
        reqRecord.decidedAt = nowISO;
        reqRecord.rejectionNote = action === "reject" ? note.trim() : null;

        await saveLeaveRequests(env, requests);

        if (action === "accept") {
          try {
            await createNotionRowsForRequest(env, reqRecord);
          } catch (err) {
            console.error("Failed to create Notion rows for approved leave:", err);
            return new Response(
              JSON.stringify({ error: "Approved, but failed to write to the schedule. Check the logs." }),
              { status: 500, headers: { "content-type": "application/json" } }
            );
          }
        }

        const label = formatDateRangeLabel(reqRecord.startDate, reqRecord.endDate, reqRecord.halfDayStart, reqRecord.halfDayEnd);
        const outcomeText = action === "accept" ? "accepted" : "declined";
        const noteBlock = action === "reject" ? `<p><strong>Reason:</strong> ${escapeHtml(reqRecord.rejectionNote)}</p>` : "";
        ctx.waitUntil(
          sendMail(
            env,
            [reqRecord.personEmail],
            `Your annual leave request has been ${outcomeText}`,
            `<p>Your annual leave request for <strong>${escapeHtml(label)}</strong> has been <strong>${outcomeText}</strong> by ${escapeHtml(decidedBy)}.</p>
             ${noteBlock}`
          )
        );

        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }

      const requests = await getLeaveRequests(env);
      return new Response(renderApprovalsPage(requests, null), {
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
