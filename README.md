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
- **Settings**: change your password and manage who has access.

## Logins and access

- Passwords are hashed (PBKDF2). Sessions use secure, HttpOnly cookies.
- 5 wrong passwords lock the account for 15 minutes.
- Access is role-based (`src/permissions.js`). Right now there's one role, **owner**, which has full access. Twurt and Britney are both owners.
- When the publicist and social manager join, a new role gets added for each one, listing only the areas they need. Then build their interfaces.

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

If you change the database later, add a new file in `migrations/` and run it in the D1 console, or run `npm run db:migrate:remote`.

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
