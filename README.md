# Carlam Schedule → Outlook (100% free, unlimited people)

This little pipeline pulls every row out of your Notion "Team Schedule"
database and republishes it as a free calendar link per person, hosted on
GitHub Pages. No third-party connector, no per-feed pricing, no per-person
cost, ever — the only "cost" is a few minutes of one-time setup.

Every 30 minutes it re-checks Notion and updates the calendars automatically.

---

## What you need (all free)

- A GitHub account — https://github.com/join (free, no card needed)
- 10-15 minutes for the one-time setup below

---

## Step 1 — Create a Notion integration (gives the script read access)

1. Go to https://www.notion.so/my-integrations
2. Click **New integration**.
3. Name it something like `Carlam Schedule Sync`, pick your workspace, click **Submit**.
4. Copy the **Internal Integration Secret** shown — you'll need this in Step 4.
   Treat it like a password.
5. Go to the **Team Schedule** database in Notion. Click **···** (top right) →
   **Connections** → add your new `Carlam Schedule Sync` integration. This gives
   the script permission to read the database.

## Step 2 — Get your database ID

1. Open the Team Schedule database in Notion as a full page.
2. Copy the URL. It looks like:
   `https://www.notion.so/yourworkspace/1234567890abcdef1234567890abcdef?v=...`
3. The 32-character chunk right after your workspace name (before the `?v=`)
   is your **database ID**. Copy it — you'll need it in Step 4.

## Step 3 — Create your GitHub repository

1. Go to https://github.com/new
2. Name it e.g. `carlam-schedule`.
3. Set it to **Public** (needed for free GitHub Pages hosting — see note below).
4. Click **Create repository**.
5. Upload all the files from this project (drag and drop `generate_ics.py`,
   `requirements.txt`, and the `.github` folder into the GitHub web upload page,
   keeping the folder structure intact) and commit them.

> **Note on privacy:** Public repo/Pages means the .ics links aren't indexed
> or listed anywhere, but they aren't access-controlled either — anyone who
> guesses or is given the exact URL could view that person's schedule. This
> is the same privacy model as the paid connector tools use for their free
> tier. If that's not good enough for your data's sensitivity, this free
> route isn't the right fit — see the note at the bottom of this file.

## Step 4 — Add your secrets

1. In your new GitHub repo, go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**. Add:
   - Name: `NOTION_TOKEN` → Value: the integration secret from Step 1
   - Name: `NOTION_DATABASE_ID` → Value: the database ID from Step 2

## Step 5 — Turn on GitHub Pages

1. In the repo, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Branch: `main`, folder: `/docs`. Save.
4. GitHub will give you a URL like:
   `https://yourusername.github.io/carlam-schedule/`

## Step 6 — Run it for the first time

1. Go to the **Actions** tab in your repo.
2. Click the **Sync Notion schedule to calendar feeds** workflow.
3. Click **Run workflow** → **Run workflow** (this is the manual trigger —
   after this it runs itself every 30 minutes automatically).
4. Wait about a minute, then check `https://yourusername.github.io/carlam-schedule/`
   — you should see a list of people and their `.ics` filenames.

## Step 7 — Subscribe in Outlook

Each person's link will look like:
`https://yourusername.github.io/carlam-schedule/iestyn.ics`

1. In Outlook, go to **Calendar → Add calendar → Subscribe from web**.
2. Paste in their personal link.
3. Name it "Carlam Schedule" and import.

Their shifts now appear in Outlook, refreshing automatically as Notion changes.

---

## FAQ

**Does this cost anything, ever?**
No. GitHub public repos, Actions minutes, and Pages hosting are free with no
event or feed caps, regardless of how many people you add.

**What if I add more people to the Notion database later?**
Nothing to change — the script automatically creates a new .ics file for
anyone new who appears in the Person or Person Name field on the next run.

**What if I want it more private than a public repo allows?**
GitHub Pages access control requires a paid GitHub plan (Pro/Team). If that
matters, the free-but-public setup above is the trade-off — worth deciding
if your schedule data needs to be locked down that tightly.
