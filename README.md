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
  - **Content:** the social manager drafts a post (caption, hashtags, platforms, planned time, photos/videos or a Drive link) and sends it to Twurt for review. Twurt or Britney approves it or requests changes, and each post has its own comment thread. Then it gets marked scheduled or posted, with the live link and results.
  - **Calendar:** a month view of planned posts.
  - **Campaigns:** groups posts around a goal, with dates, platforms, an optional ad budget and progress.
  - **Metrics:** weekly follower, view and engagement numbers per platform, a growth chart, and the top posts.
- **Messages**: a team-wide `# General` chat plus private direct messages. A direct message can only be read by the two people in it, including when one of them is an owner.
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
2. **Create the tables.** Open the database's **Console** tab, paste the full contents of `migrations/0001_init.sql`, and run it.
3. **Connect the site.** Go to **Workers & Pages → Create → Pages → Connect to Git** and pick `aguidedjourney/twurtteam`.
   - Framework preset: *None*
   - Build command: *(leave empty)*
   - Build output directory: `public`
4. **Add the setup key.** In the Pages project, go to **Settings → Variables and secrets** and add a **Secret** named `SETUP_KEY`. Use a long random phrase only you know. Redeploy afterward.
5. **Create the first account.** Open the site. It shows a first-time setup screen, where you enter the setup key and create the first owner account.
6. **Add the other owner.** Sign in, go to **Settings → Team access → Add person**, and create Twurt's login as an owner.

After this, every push to the production branch redeploys the site automatically.

### Database updates
When a new file appears in `migrations/`, open the D1 database's **Console** tab and run the matching file from `docs/d1-console/`. Those versions have the comments stripped out because the console rejects them. They're safe to run more than once.

### Photo/video uploads (Cloudflare R2)
1. In Cloudflare, go to **R2 Object Storage**, click **Create bucket** and name it `twurtteam-media`. Cloudflare asks for a payment method to turn on R2, but the first 10 GB are free.
2. In `wrangler.toml`, remove the `#` from the three `[[r2_buckets]]` lines and push.

Until then, posts can link to files in Google Drive or Dropbox instead. Files must be under 95 MB each; use a link for anything bigger.

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
