# Team Twurt

Private business hub for Twurt Chamberlain: money, shows, merch inventory and goals.
It runs on Cloudflare Pages, with Pages Functions for the API and a D1 database for storage.

## What's in it

- **Dashboard**: revenue, expenses and net for the year and the current month, a month-by-month chart, where money comes from and goes, active goals, upcoming shows, low-stock merch.
- **Money**: every revenue and expense entry, with category, payment method and optional show. Filter by period, type, category, show or search text. **Export CSV** gives your accountant a spreadsheet at tax time.
- **Shows**: each show's revenue minus expenses (door, guarantee, merch vs. gas, hotel, food). Click a show to see and add its entries.
- **Merch**: inventory by item and size, cost and price, margin, and stock value. **Adjust** records sales, restocks, giveaways, damage and count corrections. A sale can create the Merch revenue entry automatically, and a restock can create the inventory expense. Every change is kept in the item's history.
- **Goals**:
  - Financial goals track progress automatically from transactions: revenue earned, net profit, or a spending budget. They can also be tracked by hand, for example a savings reserve.
  - Project goals have checklist steps.
- **Social** (owners + social media manager):
  - **Overview:** shows what's waiting for review, what's coming up, follower growth and active campaigns.
  - **Content:** the social manager drafts a post (caption, hashtags, platforms, planned time, and Google Drive links to the photos/videos) and sends it to Twurt for review. Twurt or Britney approves it or requests changes, and each post has its own comment thread. Then it gets marked scheduled or posted, with the live link and results.
  - **Calendar:** a month view of planned posts.
  - **Campaigns:** groups posts around a goal, with dates, platforms, an optional ad budget and progress.
  - **Metrics:** weekly follower, view and engagement numbers per platform, a growth chart, and the top posts.
- **Messages**: a team-wide `# General` chat plus private direct messages. A direct message can only be read by the two people in it, including when one of them is an owner.
  - Unread messages show as a red count next to Messages, and in the browser tab title.
  - A new direct message also pops up in the corner of whatever page you're on, with a **Reply** button.
- **Settings**: change your password and manage who has access.

## Logins and access

- Passwords are hashed (PBKDF2). Sessions use secure, HttpOnly cookies.
- 5 wrong passwords lock the account for 15 minutes.
- Access is role-based (`src/permissions.js`):
  - **Owner** (Twurt and Britney): full access.
  - **Social media manager**: only Social and Messages. Can't approve posts and can't see money, shows, merch or goals.
  - New roles, such as a publicist, get added there with only the areas they need.

## Deploying to Cloudflare (one-time setup)

1. **Create the database.** In the Cloudflare dashboard, go to **Storage & Databases → D1 → Create**, name it `twurtteam`, and copy its **Database ID**. Put the ID in `wrangler.toml` in place of the zeros.
2. **Tables.** Nothing to do: the site creates its own tables on first use.
3. **Connect the site.** Go to **Workers & Pages → Create → Pages → Connect to Git** and pick `aguidedjourney/twurtteam`.
   - Framework preset: *None*
   - Build command: *(leave empty)*
   - Build output directory: `public`
4. **Add the setup key.** In the Pages project, go to **Settings → Variables and secrets** and add a **Secret** named `SETUP_KEY`. Use a long random phrase only you know. Redeploy afterward.
5. **Create the first account.** Open the site. It shows a first-time setup screen, where you enter the setup key and create the first owner account.
6. **Add the other owner.** Sign in, go to **Settings → Team access → Add person**, and create Twurt's login as an owner.

After this, every push to the production branch redeploys the site automatically.

### Database updates
These are automatic. When the site deploys, it applies any new files in `migrations/` by itself the first time it's used, so nobody needs the D1 console. After adding or editing a migration, run `npm run schema` to regenerate `src/schema.generated.js`, and keep every statement safe to re-run.

### Sharing photos and videos
Content is shared with **Google Drive links**, which keeps everything free. Paste one link per line on a post. Google Drive file links preview right inside the review screen, as long as Drive sharing is set to "Anyone with the link can view" or the file is shared with the viewer's Google account. Folder links and other sites (Dropbox, WeTransfer) open in a new tab.

Direct uploads via Cloudflare R2 are built in but switched off (R2 requires a card on file). See the note in `wrangler.toml` if you ever want them.

## Running locally

```sh
npm install
cp .dev.vars.example .dev.vars      # set a SETUP_KEY
npm run db:migrate:local
npm run dev                         # http://localhost:8788
```

## Project layout

```
public/                  the website (index.html, app.js, styles.css, logo)
functions/api/[[route]].js   API router: every /api/* request comes through here
src/                     server code: auth, permissions, and one file per area in routes/
migrations/              database schema
archive/                 the original ChatGPT prototype, for reference (not deployed)
```
