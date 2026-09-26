'use strict';
(() => {
  // ---------------------------------------------------------------- helpers
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(s);
  const part = (v) => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v);
  // Tagged template: interpolated values are HTML-escaped unless wrapped in raw()/html``.
  const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const money = (cents) => usd.format((cents || 0) / 100);
  const signed = (cents) => (cents < 0 ? '−' : '') + money(Math.abs(cents));
  const dollars = (cents) => cents == null ? '' : (cents / 100).toFixed(2);
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => iso(new Date());
  const fmtDate = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const shortDate = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pct = (x) => Math.round(x * 100) + '%';
  const opts = (list, selected) => list.map((o) => {
    const [value, label] = Array.isArray(o) ? o : [o, o];
    return html`<option value="${value}" ${String(value) === String(selected ?? '') ? raw('selected') : ''}>${label}</option>`;
  });

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 401 && state.user && !path.startsWith('/api/auth/')) {
      state.user = null;
      closeModal();
      render();
    }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(msg, bad = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, 2600);
  }

  // ---------------------------------------------------------------- constants
  const CATEGORIES = {
    revenue: ['Shows / performance', 'Merch sales', 'Streaming & royalties', 'Sync & licensing', 'Sponsorships', 'Tips & donations', 'Other income'],
    expense: ['Travel', 'Lodging', 'Food & per diem', 'Merch (inventory)', 'Marketing & ads', 'PR & publicity', 'Content & production',
      'Recording & studio', 'Equipment & gear', 'Team pay', 'Fees & commissions', 'Software & subscriptions', 'Other expense'],
  };
  const PAYMENT = ['Cash', 'Card', 'Venmo', 'Cash App', 'PayPal', 'Zelle', 'Bank transfer', 'Check', 'Other'];
  const SHOW_STATUS = { booked: ['Booked', 'yellow'], completed: ['Completed', 'green'], cancelled: ['Cancelled', 'red'] };
  const GOAL_STATUS = { active: ['Active', 'yellow'], achieved: ['Achieved', 'green'], paused: ['Paused', ''], dropped: ['Dropped', 'red'] };
  const METRICS = { revenue: 'Revenue earned', net: 'Net profit', expenses: 'Spending budget', manual: 'Tracked manually' };
  const REASONS = { sale: 'Sold', restock: 'Restocked', giveaway: 'Gave away', damaged: 'Damaged / lost', correction: 'Count correction', initial: 'Starting stock' };

  // ---------------------------------------------------------------- state + routing
  const state = { user: null, needsSetup: false, roles: {}, shows: null };

  const PAGES = {
    dashboard: { label: 'Dashboard', area: 'finance', render: pageDashboard },
    money: { label: 'Money', area: 'finance', render: pageMoney },
    shows: { label: 'Shows', area: 'shows', render: pageShows },
    merch: { label: 'Merch', area: 'merch', render: pageMerch },
    goals: { label: 'Goals', area: 'goals', render: pageGoals },
    settings: { label: 'Settings', area: null, render: pageSettings },
  };

  function can(area) {
    const role = state.roles[state.user?.role];
    return !area || (role && (role.areas === '*' || role.areas.includes(area)));
  }
  const allowedPages = () => Object.keys(PAGES).filter((p) => can(PAGES[p].area));

  function currentPage() {
    const p = location.hash.replace(/^#\/?/, '').split('?')[0];
    const allowed = allowedPages();
    return allowed.includes(p) ? p : allowed[0];
  }

  async function render() {
    const root = $('#root');
    if (!state.user) {
      root.innerHTML = (state.needsSetup ? setupView() : loginView()).s;
      $('input', root)?.focus();
      return;
    }
    const page = currentPage();
    const nav = allowedPages().map((p) => html`<a href="#/${p}" class="${p === page ? 'active' : ''}">${PAGES[p].label}</a>`);
    root.innerHTML = html`
      <div class="mobilebar">
        <div class="row1"><img src="/logo.png" alt="Twurt"><button class="btn sm" data-action="logout">Sign out</button></div>
        <nav class="nav">${nav}</nav>
      </div>
      <div class="app">
        <aside class="side">
          <img src="/logo.png" alt="Twurt">
          <div class="sub">Team Twurt</div>
          <div class="accent-strip" style="margin:0 8px 18px"><span class="r"></span><span class="y"></span><span class="g"></span></div>
          <nav class="nav">${nav}</nav>
          <div class="me"><b>${state.user.name}</b>${state.user.email}<br>
            <button class="btn link" style="padding-left:0;margin-top:6px" data-action="logout">Sign out</button></div>
        </aside>
        <main class="main" id="view"><div class="empty">Loading…</div></main>
      </div>`.s;
    await refresh();
  }

  async function refresh() {
    const view = $('#view');
    if (!view) return;
    try {
      await PAGES[currentPage()].render(view);
    } catch (err) {
      view.innerHTML = html`<div class="error">${err.message}</div>`.s;
    }
  }

  async function loadShows(force = false) {
    if (!state.shows || force) state.shows = (await api('/api/shows')).shows;
    return state.shows;
  }
  const showOptions = (selected) => [
    html`<option value="">— Not tied to a show —</option>`,
    ...(state.shows || []).map((s) => html`<option value="${s.id}" ${String(s.id) === String(selected ?? '') ? raw('selected') : ''}>${fmtDate(s.date)} — ${s.name}${s.city ? ', ' + s.city : ''}</option>`),
  ];

  // ---------------------------------------------------------------- modal
  let modalSubmit = null;
  function openModal({ title, body, foot = '', wide = false, submitLabel = 'Save', onSubmit, onDelete }) {
    const dlg = $('#modal');
    modalSubmit = onSubmit ? { onSubmit, onDelete } : { onDelete };
    dlg.className = wide ? 'wide' : '';
    $('#modalBody').innerHTML = html`
      <form data-submit="modal" novalidate>
        <div class="modal-head"><h3>${title}</h3><button type="button" class="btn link" data-action="close-modal" aria-label="Close">✕</button></div>
        <div class="modal-body"><div class="error" id="modalError" hidden></div>${body}</div>
        <div class="modal-foot">
          ${onDelete ? html`<button type="button" class="btn danger" data-action="modal-delete">Delete</button>` : ''}
          ${foot}
          <div class="right">
            <button type="button" class="btn" data-action="close-modal">${onSubmit ? 'Cancel' : 'Close'}</button>
            ${onSubmit ? html`<button type="submit" class="btn primary">${submitLabel}</button>` : ''}
          </div>
        </div>
      </form>`.s;
    if (!dlg.open) dlg.showModal();
    const first = $('.modal-body input:not([type=hidden]):not([type=radio]):not([type=checkbox]), .modal-body select', dlg);
    if (first && onSubmit) first.focus();
  }
  function closeModal() {
    const dlg = $('#modal');
    if (dlg.open) dlg.close();
    modalSubmit = null;
  }
  function modalError(msg) {
    const e = $('#modalError');
    if (!e) return toast(msg, true);
    e.textContent = msg;
    e.hidden = !msg;
    if (msg) e.scrollIntoView({ block: 'nearest' });
  }

  function formData(form) {
    const data = Object.fromEntries(new FormData(form));
    $$('input[type=checkbox][name]', form).forEach((c) => { data[c.name] = c.checked; });
    return data;
  }

  // ---------------------------------------------------------------- auth views
  const loginCard = (inner) => html`
    <div class="login"><div class="login-card">
      <div class="accent-strip"><span class="r"></span><span class="y"></span><span class="g"></span></div>
      <img src="/logo.png" alt="Twurt">
      <div class="t">TEAM TWURT</div>
      ${inner}
    </div></div>`;

  const loginView = () => loginCard(html`
    <form data-submit="login">
      <label class="f"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
      <label class="f"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
      <div class="error" id="authError" hidden></div>
      <button class="btn primary" style="width:100%">Sign in</button>
    </form>`);

  const setupView = () => loginCard(html`
    <form data-submit="setup">
      <div class="hint">First-time setup: create the first owner account. You'll need the <b>SETUP_KEY</b> you saved in Cloudflare.</div>
      <label class="f"><span>Setup key</span><input name="setupKey" type="password" required></label>
      <label class="f"><span>Your name</span><input name="name" required autocomplete="name"></label>
      <label class="f"><span>Email</span><input name="email" type="email" required autocomplete="username"></label>
      <label class="f"><span>Password (10+ characters)</span><input name="password" type="password" minlength="10" required autocomplete="new-password"></label>
      <label class="f"><span>Confirm password</span><input name="confirm" type="password" required autocomplete="new-password"></label>
      <div class="error" id="authError" hidden></div>
      <button class="btn primary" style="width:100%">Create owner account</button>
    </form>`);

  function authError(msg) {
    const e = $('#authError');
    e.textContent = msg;
    e.hidden = false;
  }

  // ---------------------------------------------------------------- dashboard
  let dashYear = null;

  async function pageDashboard(el) {
    const today = todayStr();
    const d = await api(`/api/summary?today=${today}` + (dashYear ? `&year=${dashYear}` : ''));
    dashYear = d.year;
    const net = d.totals.revenue_cents - d.totals.expense_cents;
    const mNet = d.month.revenue_cents - d.month.expense_cents;
    const max = Math.max(1, ...d.months.flatMap((m) => [m.revenue_cents, m.expense_cents]));
    const rev = d.byCategory.filter((c) => c.type === 'revenue');
    const exp = d.byCategory.filter((c) => c.type === 'expense');
    const catBars = (rows, total, cls) => rows.length
      ? rows.map((c) => html`<div class="hbar"><div class="row"><span>${c.category}</span><b>${money(c.amount_cents)}</b></div>
          <div class="track"><div class="fill ${cls}" style="width:${(c.amount_cents / Math.max(1, total)) * 100}%"></div></div></div>`)
      : html`<div class="empty">Nothing recorded for ${d.year}</div>`;
    const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });

    el.innerHTML = html`
      <div class="top">
        <div><div class="eyebrow">Team Twurt · ${d.year}</div><div class="title">Know the business.</div></div>
        <div class="actions">
          <select data-change="dash-year" style="width:auto">${opts(d.years, d.year)}</select>
          <button class="btn rev" data-action="new-tx" data-type="revenue">+ Revenue</button>
          <button class="btn exp" data-action="new-tx" data-type="expense">+ Expense</button>
        </div>
      </div>
      <div class="grid g4">
        <div class="card metric"><div class="label">Revenue ${d.year}</div><div class="value pos">${money(d.totals.revenue_cents)}</div></div>
        <div class="card metric"><div class="label">Expenses ${d.year}</div><div class="value neg">${money(d.totals.expense_cents)}</div></div>
        <div class="card metric"><div class="label">Net ${d.year}</div><div class="value ${net < 0 ? 'neg' : ''}">${signed(net)}</div></div>
        <div class="card metric"><div class="label">${monthName} net</div><div class="value ${mNet < 0 ? 'neg' : ''}">${signed(mNet)}</div>
          <div class="small">${money(d.month.revenue_cents)} in · ${money(d.month.expense_cents)} out</div></div>
      </div>

      <div class="grid g21 section">
        <div class="card">
          <div class="card-head"><h2>Month by month</h2>
            <div class="legend"><span><i style="background:var(--rev)"></i>Revenue</span><span><i style="background:var(--exp)"></i>Expenses</span></div></div>
          <div class="bars">${d.months.map((m) => html`<div class="col" title="${MONTHS[m.month - 1]}: ${money(m.revenue_cents)} in, ${money(m.expense_cents)} out">
            <div class="pair"><div class="b r" style="height:${(m.revenue_cents / max) * 100}%"></div><div class="b e" style="height:${(m.expense_cents / max) * 100}%"></div></div>
            <div class="m">${MONTHS[m.month - 1].slice(0, 1)}<span class="hide-sm">${MONTHS[m.month - 1].slice(1)}</span></div></div>`)}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Active goals</h2><a class="btn sm" href="#/goals">All goals</a></div>
          ${d.goals.length ? d.goals.map(goalMini) : html`<div class="empty">No active goals yet. <a href="#/goals">Set one</a>.</div>`}
        </div>
      </div>

      <div class="grid g3 section">
        <div class="card"><h2>Where money comes from</h2>${catBars(rev, d.totals.revenue_cents, 'rev')}</div>
        <div class="card"><h2>Where money goes</h2>${catBars(exp, d.totals.expense_cents, 'exp')}</div>
        <div class="card">
          <div class="card-head"><h2>Upcoming shows</h2><a class="btn sm" href="#/shows">Shows</a></div>
          ${d.upcomingShows.length ? d.upcomingShows.map((s) => html`<div class="list-item clickable" data-action="show-detail" data-id="${s.id}" style="cursor:pointer">
              <div class="grow"><b>${s.name}</b><div class="small">${s.city || ''}</div></div><span class="tag">${fmtDate(s.date)}</span></div>`)
            : html`<div class="empty">No booked shows ahead</div>`}
          <h2 style="margin-top:18px">Merch</h2>
          <div class="small">${d.inventory.units} units in stock · ${money(d.inventory.retail_cents)} retail value</div>
          ${d.lowStock.length ? d.lowStock.map((i) => html`<div class="list-item"><div class="grow">${i.name}${i.variant ? ' · ' + i.variant : ''}</div>
              <span class="tag ${i.quantity === 0 ? 'red' : 'yellow'}">${i.quantity === 0 ? 'Out' : i.quantity + ' left'}</span></div>`)
            : html`<div class="small" style="margin-top:6px">Nothing running low.</div>`}
        </div>
      </div>

      <div class="card section">
        <div class="card-head"><h2>Recent transactions</h2><a class="btn sm" href="#/money">All transactions</a></div>
        ${txTable(d.recent)}
      </div>`.s;
  }

  function goalMini(g) {
    return html`<div class="hbar"><div class="row"><span>${g.title}</span><b>${pct(g.progress)}</b></div>
      <div class="track"><div class="fill ${progressClass(g)}" style="width:${Math.min(100, g.progress * 100)}%"></div></div>
      <div class="small" style="margin-top:3px">${goalNumbers(g)}${g.due_date ? ' · due ' + shortDate(g.due_date) : ''}</div></div>`;
  }

  function txTable(rows, { showCol = true, totals } = {}) {
    if (!rows.length) return html`<div class="empty">No transactions yet</div>`;
    return html`<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>What</th>${showCol ? html`<th class="hide-sm">Show</th>` : ''}<th class="hide-sm">Paid via</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows.map((t) => html`<tr class="clickable" data-action="edit-tx" data-id="${t.id}">
        <td style="white-space:nowrap">${shortDate(t.date)}<div class="small">${t.date.slice(0, 4)}</div></td>
        <td><span class="tag ${t.type}">${t.category}</span>${t.description ? html`<div style="margin-top:3px">${t.description}</div>` : ''}</td>
        ${showCol ? html`<td class="hide-sm small">${t.show_name || ''}</td>` : ''}
        <td class="hide-sm small">${t.payment_method || ''}</td>
        <td class="num ${t.type === 'revenue' ? 'pos' : 'neg'}">${t.type === 'expense' ? '−' : '+'}${money(t.amount_cents)}</td></tr>`)}</tbody>
      ${totals != null ? html`<tfoot><tr><td colspan="2">Net</td>${showCol ? html`<td class="hide-sm"></td>` : ''}<td class="hide-sm"></td><td class="num ${totals < 0 ? 'neg' : 'pos'}">${signed(totals)}</td></tr></tfoot>` : ''}
    </table></div>`;
  }

  // ---------------------------------------------------------------- money
  const moneyState = { period: 'year', from: '', to: '', type: '', category: '', show_id: '', q: '' };
  let lastTx = [];

  function periodRange(p) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (p) {
      case 'month': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
      case 'lastmonth': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
      case 'quarter': { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))]; }
      case 'year': return [`${y}-01-01`, `${y}-12-31`];
      case 'lastyear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
      case 'custom': return [moneyState.from, moneyState.to];
      default: return ['', ''];
    }
  }

  function moneyQuery() {
    const [from, to] = periodRange(moneyState.period);
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    for (const k of ['type', 'category', 'show_id', 'q']) if (moneyState[k]) q.set(k, moneyState[k]);
    return q.toString();
  }

  async function pageMoney(el) {
    const [data] = await Promise.all([api('/api/transactions?' + moneyQuery()), loadShows()]);
    lastTx = data.transactions;
    const t = data.totals;
    const cats = [...new Set([...CATEGORIES.revenue, ...CATEGORIES.expense, ...data.usedCategories.map((c) => c.category)])];
    const s = moneyState;
    el.innerHTML = html`
      <div class="top">
        <div><div class="eyebrow">Money</div><div class="title">Revenue & expenses.</div></div>
        <div class="actions">
          <a class="btn" href="/api/transactions/export?${moneyQuery()}" download>Export CSV</a>
          <button class="btn rev" data-action="new-tx" data-type="revenue">+ Revenue</button>
          <button class="btn exp" data-action="new-tx" data-type="expense">+ Expense</button>
        </div>
      </div>
      <form class="filters" data-submit="money-filter">
        <label class="f"><span>Period</span><select name="period" data-change="money-filter">${opts([['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['year', 'This year'], ['lastyear', 'Last year'], ['all', 'All time'], ['custom', 'Custom dates']], s.period)}</select></label>
        ${s.period === 'custom' ? html`
          <label class="f"><span>From</span><input type="date" name="from" value="${s.from}" data-change="money-filter"></label>
          <label class="f"><span>To</span><input type="date" name="to" value="${s.to}" data-change="money-filter"></label>` : ''}
        <label class="f"><span>Type</span><select name="type" data-change="money-filter">${opts([['', 'All'], ['revenue', 'Revenue'], ['expense', 'Expenses']], s.type)}</select></label>
        <label class="f"><span>Category</span><select name="category" data-change="money-filter">${opts([['', 'All'], ...cats], s.category)}</select></label>
        <label class="f"><span>Show</span><select name="show_id" data-change="money-filter">${opts([['', 'All'], ...state.shows.map((x) => [x.id, `${shortDate(x.date)} ${x.name}`])], s.show_id)}</select></label>
        <label class="f"><span>Search</span><input name="q" value="${s.q}" placeholder="Description or notes"></label>
      </form>
      <div class="grid g4">
        <div class="card metric"><div class="label">Revenue</div><div class="value pos">${money(t.revenue_cents)}</div></div>
        <div class="card metric"><div class="label">Expenses</div><div class="value neg">${money(t.expense_cents)}</div></div>
        <div class="card metric"><div class="label">Net</div><div class="value">${signed(t.revenue_cents - t.expense_cents)}</div></div>
        <div class="card metric"><div class="label">Transactions</div><div class="value">${t.count}</div></div>
      </div>
      <div class="card section">${txTable(lastTx, { totals: lastTx.length ? t.revenue_cents - t.expense_cents : null })}
        ${lastTx.length >= 2000 ? html`<div class="small">Showing the latest 2,000 — narrow the filters to see more.</div>` : ''}</div>`.s;
  }

  async function txForm(tx) {
    await loadShows();
    const type = tx.type || 'revenue';
    const catList = CATEGORIES[type].includes(tx.category) || !tx.category ? CATEGORIES[type] : [tx.category, ...CATEGORIES[type]];
    openModal({
      title: tx.id ? 'Edit transaction' : type === 'revenue' ? 'Record revenue' : 'Record expense',
      body: html`<div class="form">
        <div class="full"><div class="seg">
          <button type="button" class="${type === 'revenue' ? 'on' : ''}" data-action="tx-type" data-type="revenue">Revenue</button>
          <button type="button" class="${type === 'expense' ? 'on' : ''}" data-action="tx-type" data-type="expense">Expense</button></div>
          <input type="hidden" name="type" value="${type}"></div>
        <label class="f"><span>Amount ($)</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0" value="${dollars(tx.amount_cents)}" required></label>
        <label class="f"><span>Date</span><input name="date" type="date" value="${tx.date || todayStr()}" required></label>
        <label class="f"><span>Category</span><select name="category" id="txCategory">${opts(catList, tx.category)}</select></label>
        <label class="f"><span>Paid via</span><select name="payment_method">${opts([['', '—'], ...PAYMENT], tx.payment_method)}</select></label>
        <label class="f full"><span>Description</span><input name="description" value="${tx.description || ''}" placeholder="e.g. Door split, gas to Macon, 20 tees"></label>
        <label class="f full"><span>Show</span><select name="show_id">${showOptions(tx.show_id)}</select></label>
        <label class="f full"><span>Notes</span><textarea name="notes">${tx.notes || ''}</textarea></label>
        ${tx.created_by_name ? html`<div class="small full">Entered by ${tx.created_by_name}</div>` : ''}
      </div>`,
      onSubmit: async (d) => {
        await api(tx.id ? `/api/transactions/${tx.id}` : '/api/transactions', { method: tx.id ? 'PUT' : 'POST', body: d });
        toast(tx.id ? 'Transaction updated' : 'Transaction saved');
      },
      onDelete: tx.id ? async () => {
        if (!confirm('Delete this transaction?')) return false;
        await api(`/api/transactions/${tx.id}`, { method: 'DELETE' });
        toast('Transaction deleted');
      } : null,
    });
  }

  // ---------------------------------------------------------------- shows
  async function pageShows(el) {
    const shows = await loadShows(true);
    const today = todayStr();
    const upcoming = shows.filter((s) => s.date >= today && s.status !== 'cancelled').reverse();
    const past = shows.filter((s) => !(s.date >= today && s.status !== 'cancelled'));
    const done = past.filter((s) => s.status !== 'cancelled');
    const totalNet = done.reduce((a, s) => a + s.revenue_cents - s.expense_cents, 0);
    const table = (rows) => rows.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Venue / event</th><th>Status</th><th class="num">Revenue</th><th class="num hide-sm">Expenses</th><th class="num">Net</th></tr></thead>
      <tbody>${rows.map((s) => { const n = s.revenue_cents - s.expense_cents; return html`
        <tr class="clickable ${s.status === 'cancelled' ? 'dim' : ''}" data-action="show-detail" data-id="${s.id}">
          <td style="white-space:nowrap">${fmtDate(s.date)}</td>
          <td><b>${s.name}</b><div class="small">${s.city || ''}</div></td>
          <td><span class="tag ${SHOW_STATUS[s.status][1]}">${SHOW_STATUS[s.status][0]}</span></td>
          <td class="num pos">${money(s.revenue_cents)}</td><td class="num neg hide-sm">${money(s.expense_cents)}</td>
          <td class="num ${n < 0 ? 'neg' : ''}"><b>${signed(n)}</b></td></tr>`; })}</tbody></table></div>`
      : html`<div class="empty">None</div>`;

    el.innerHTML = html`
      <div class="top">
        <div><div class="eyebrow">Shows</div><div class="title">Every show, in the black.</div></div>
        <div class="actions"><button class="btn primary" data-action="new-show">+ Add show</button></div>
      </div>
      <div class="grid g4">
        <div class="card metric"><div class="label">Upcoming</div><div class="value">${upcoming.length}</div></div>
        <div class="card metric"><div class="label">Played</div><div class="value">${done.filter((s) => s.date < today).length}</div></div>
        <div class="card metric"><div class="label">Net from shows</div><div class="value ${totalNet < 0 ? 'neg' : ''}">${signed(totalNet)}</div></div>
        <div class="card metric"><div class="label">Avg net per show</div><div class="value">${done.length ? signed(Math.round(totalNet / done.length)) : '—'}</div></div>
      </div>
      <div class="hint section">Tie revenue (door, guarantee, merch) and expenses (gas, hotel, food) to a show to see what each one really earned.</div>
      <div class="card section"><h2>Upcoming</h2>${table(upcoming)}</div>
      <div class="card section"><h2>Past & cancelled</h2>${table(past)}</div>`.s;
  }

  function showForm(show = {}) {
    openModal({
      title: show.id ? 'Edit show' : 'Add show',
      body: html`<div class="form">
        <label class="f full"><span>Venue / event</span><input name="name" value="${show.name || ''}" required placeholder="Grant's Lounge"></label>
        <label class="f"><span>Date</span><input name="date" type="date" value="${show.date || ''}" required></label>
        <label class="f"><span>City</span><input name="city" value="${show.city || ''}" placeholder="Macon, GA"></label>
        <label class="f"><span>Status</span><select name="status">${opts(Object.entries(SHOW_STATUS).map(([k, v]) => [k, v[0]]), show.status || 'booked')}</select></label>
        <label class="f full"><span>Notes</span><textarea name="notes" placeholder="Deal terms, contact, load-in…">${show.notes || ''}</textarea></label>
      </div>`,
      onSubmit: async (d) => {
        const res = await api(show.id ? `/api/shows/${show.id}` : '/api/shows', { method: show.id ? 'PUT' : 'POST', body: d });
        state.shows = null;
        toast(show.id ? 'Show updated' : 'Show added');
        if (show.id) return showDetail(show.id);
        if (res?.id) return showDetail(res.id);
      },
      onDelete: show.id ? async () => {
        if (!confirm('Delete this show? Its transactions and merch history are kept but unlinked.')) return false;
        await api(`/api/shows/${show.id}`, { method: 'DELETE' });
        state.shows = null;
        toast('Show deleted');
      } : null,
    });
  }

  async function showDetail(id) {
    const d = await api(`/api/shows/${id}`);
    const s = d.show;
    const net = s.revenue_cents - s.expense_cents;
    openModal({
      title: s.name,
      wide: true,
      body: html`
        <div class="small">${fmtDate(s.date)}${s.city ? ' · ' + s.city : ''} · <span class="tag ${SHOW_STATUS[s.status][1]}">${SHOW_STATUS[s.status][0]}</span></div>
        ${s.notes ? html`<p class="small" style="white-space:pre-wrap">${s.notes}</p>` : ''}
        <div class="grid g3" style="margin:14px 0">
          <div class="card metric"><div class="label">Revenue</div><div class="value pos">${money(s.revenue_cents)}</div></div>
          <div class="card metric"><div class="label">Expenses</div><div class="value neg">${money(s.expense_cents)}</div></div>
          <div class="card metric"><div class="label">Net</div><div class="value ${net < 0 ? 'neg' : ''}">${signed(net)}</div></div>
        </div>
        <div class="actions" style="margin-bottom:10px">
          <button type="button" class="btn rev sm" data-action="new-tx" data-type="revenue" data-show="${s.id}">+ Revenue</button>
          <button type="button" class="btn exp sm" data-action="new-tx" data-type="expense" data-show="${s.id}">+ Expense</button>
          <button type="button" class="btn sm" data-action="edit-show" data-id="${s.id}">Edit show</button>
        </div>
        ${txTable(d.transactions, { showCol: false })}
        ${d.merchSold.length ? html`<h2 style="font-size:14px;margin-top:16px">Merch sold</h2>
          ${d.merchSold.map((m) => html`<div class="list-item"><span>${m.name}${m.variant ? ' · ' + m.variant : ''}</span><b>${m.units}</b></div>`)}` : ''}`,
    });
    $('#modal').dataset.show = JSON.stringify(s);
  }

  // ---------------------------------------------------------------- merch
  let merchItems = [];

  async function pageMerch(el) {
    merchItems = (await api('/api/merch')).items;
    const active = merchItems.filter((i) => i.active);
    const units = active.reduce((a, i) => a + i.quantity, 0);
    const cost = active.reduce((a, i) => a + i.quantity * i.unit_cost_cents, 0);
    const retail = active.reduce((a, i) => a + i.quantity * i.price_cents, 0);
    const low = active.filter((i) => i.quantity <= i.low_stock).length;
    el.innerHTML = html`
      <div class="top">
        <div><div class="eyebrow">Merch</div><div class="title">Inventory.</div></div>
        <div class="actions"><button class="btn primary" data-action="new-item">+ Add item</button></div>
      </div>
      <div class="grid g4">
        <div class="card metric"><div class="label">Units in stock</div><div class="value">${units}</div></div>
        <div class="card metric"><div class="label">Stock value (cost)</div><div class="value">${money(cost)}</div></div>
        <div class="card metric"><div class="label">Retail value</div><div class="value">${money(retail)}</div></div>
        <div class="card metric"><div class="label">Low / out of stock</div><div class="value ${low ? 'neg' : ''}">${low}</div></div>
      </div>
      <div class="hint section">Add each size or color as its own item (e.g. "Rain Tee" · M). Use <b>Adjust</b> after every show or restock — selling can record the revenue for you.</div>
      <div class="card section">${merchItems.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="num">In stock</th><th class="num hide-sm">Sold</th><th class="num hide-sm">Cost</th><th class="num">Price</th><th class="num hide-sm">Margin</th><th></th></tr></thead>
        <tbody>${merchItems.map((i) => html`<tr class="${i.active ? '' : 'dim'}">
          <td class="clickable" data-action="edit-item" data-id="${i.id}" style="cursor:pointer"><b>${i.name}</b>${i.variant ? html` <span class="tag">${i.variant}</span>` : ''}
            <div class="small">${i.sku || ''}${i.active ? '' : ' · inactive'}</div></td>
          <td class="num"><b>${i.quantity}</b>${i.active && i.quantity <= i.low_stock ? html`<div><span class="tag ${i.quantity === 0 ? 'red' : 'yellow'}">${i.quantity === 0 ? 'Out' : 'Low'}</span></div>` : ''}</td>
          <td class="num hide-sm">${i.units_sold}</td>
          <td class="num hide-sm">${money(i.unit_cost_cents)}</td>
          <td class="num">${money(i.price_cents)}</td>
          <td class="num hide-sm">${i.price_cents ? pct((i.price_cents - i.unit_cost_cents) / i.price_cents) : '—'}</td>
          <td class="num"><button class="btn sm" data-action="adjust-item" data-id="${i.id}">Adjust</button>
            <button class="btn sm link" data-action="item-history" data-id="${i.id}">History</button></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">No merch yet. Add your first item.</div>`}</div>`.s;
  }

  function itemForm(item = {}) {
    openModal({
      title: item.id ? 'Edit item' : 'Add merch item',
      body: html`<div class="form">
        <label class="f"><span>Item</span><input name="name" value="${item.name || ''}" required placeholder="Rain Tee"></label>
        <label class="f"><span>Size / variant</span><input name="variant" value="${item.variant || ''}" placeholder="M, Black"></label>
        <label class="f"><span>Unit cost ($)</span><input name="unit_cost" type="number" step="0.01" min="0" inputmode="decimal" value="${dollars(item.unit_cost_cents)}"></label>
        <label class="f"><span>Sale price ($)</span><input name="price" type="number" step="0.01" min="0" inputmode="decimal" value="${dollars(item.price_cents)}"></label>
        ${item.id ? '' : html`<label class="f"><span>Starting quantity</span><input name="quantity" type="number" min="0" step="1" value="0"></label>`}
        <label class="f"><span>Low-stock alert at</span><input name="low_stock" type="number" min="0" step="1" value="${item.low_stock ?? 5}"></label>
        <label class="f"><span>SKU (optional)</span><input name="sku" value="${item.sku || ''}"></label>
        ${item.id ? html`<label class="check" style="align-self:end"><input type="checkbox" name="active" ${item.active ? raw('checked') : ''}> Active (uncheck to retire)</label>` : ''}
        <label class="f full"><span>Notes</span><textarea name="notes" placeholder="Supplier, reorder info…">${item.notes || ''}</textarea></label>
      </div>`,
      onSubmit: async (d) => {
        await api(item.id ? `/api/merch/${item.id}` : '/api/merch', { method: item.id ? 'PUT' : 'POST', body: d });
        toast(item.id ? 'Item updated' : 'Item added');
      },
      onDelete: item.id ? async () => {
        if (!confirm('Delete this item and its stock history? (Tip: uncheck "Active" instead to keep history.)')) return false;
        await api(`/api/merch/${item.id}`, { method: 'DELETE' });
        toast('Item deleted');
      } : null,
    });
  }

  async function adjustForm(item, preset = {}) {
    await loadShows();
    const reason = preset.reason || 'sale';
    openModal({
      title: `Adjust stock · ${item.name}${item.variant ? ' (' + item.variant + ')' : ''}`,
      body: html`
        <div class="small" style="margin-bottom:12px">Currently in stock: <b>${item.quantity}</b></div>
        <div class="form">
          <label class="f full"><span>What happened?</span><select name="reason" data-change="adjust-reason">${opts(
            ['sale', 'restock', 'giveaway', 'damaged', 'correction'].map((r) => [r, REASONS[r]]), reason)}</select></label>
          <label class="f"><span id="qtyLabel">Quantity</span><input name="quantity" type="number" step="1" required></label>
          <label class="f"><span>Date</span><input name="date" type="date" value="${todayStr()}"></label>
          <label class="f full" data-for="sale giveaway"><span>At show</span><select name="show_id">${showOptions(preset.show_id)}</select></label>
          <label class="check full" data-for="sale restock"><input type="checkbox" name="record_money" checked> <span id="recordLabel"></span></label>
          <label class="f" data-for="sale restock"><span id="unitLabel"></span><input name="unit_amount" type="number" step="0.01" min="0" inputmode="decimal"></label>
          <label class="f" data-for="sale restock"><span>Paid via</span><select name="payment_method">${opts([['', '—'], ...PAYMENT])}</select></label>
          <label class="f full"><span>Note</span><input name="note" placeholder="Optional"></label>
        </div>`,
      submitLabel: 'Save adjustment',
      onSubmit: async (d) => {
        const res = await api(`/api/merch/${item.id}/adjust`, { method: 'POST', body: d });
        toast(`Stock updated · ${res.quantity} in stock`);
      },
    });
    $('#modal').dataset.item = JSON.stringify(item);
    syncAdjust();
  }

  function syncAdjust() {
    const form = $('#modal form');
    const item = JSON.parse($('#modal').dataset.item || '{}');
    const reason = form.reason.value;
    $$('[data-for]', form).forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(reason); });
    $('#qtyLabel').textContent = reason === 'correction' ? 'Change (+ or −)' : 'Quantity';
    form.quantity.min = reason === 'correction' ? '' : '1';
    if (reason === 'sale') {
      $('#recordLabel').textContent = 'Also record this as Merch revenue';
      $('#unitLabel').textContent = 'Price per unit ($)';
      form.unit_amount.value = dollars(item.price_cents);
    } else if (reason === 'restock') {
      $('#recordLabel').textContent = 'Also record the cost as a Merch expense';
      $('#unitLabel').textContent = 'Cost per unit ($)';
      form.unit_amount.value = dollars(item.unit_cost_cents);
    }
  }

  async function itemHistory(item) {
    const { movements } = await api(`/api/merch/${item.id}/movements`);
    openModal({
      title: `History · ${item.name}${item.variant ? ' (' + item.variant + ')' : ''}`,
      wide: true,
      body: movements.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>What</th><th class="num">Change</th><th>Show / note</th><th class="hide-sm">By</th></tr></thead>
        <tbody>${movements.map((m) => html`<tr><td>${fmtDate(m.date)}</td><td>${REASONS[m.reason] || m.reason}${m.transaction_id ? html` <span class="tag green">$ recorded</span>` : ''}</td>
          <td class="num ${m.change < 0 ? 'neg' : 'pos'}">${m.change > 0 ? '+' : ''}${m.change}</td>
          <td class="small">${[m.show_name, m.note].filter(Boolean).join(' · ')}</td><td class="small hide-sm">${m.created_by_name || ''}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">No stock changes yet</div>`,
    });
  }

  // ---------------------------------------------------------------- goals
  let goalsFilter = 'active';
  let goals = [];

  function progressClass(g) {
    if (g.kind === 'financial' && g.metric === 'expenses') return g.progress >= 1 ? 'bad' : g.progress >= 0.8 ? 'warn' : 'good';
    return g.progress >= 1 ? 'good' : '';
  }
  function goalNumbers(g) {
    if (g.kind === 'project') {
      const done = g.milestones.filter((m) => m.done).length;
      return g.milestones.length ? `${done} of ${g.milestones.length} steps done` : 'No steps yet';
    }
    if (g.metric === 'expenses') return `${money(g.current_cents)} spent of ${money(g.target_cents)} budget`;
    return `${signed(g.current_cents)} of ${money(g.target_cents)}`;
  }

  async function pageGoals(el) {
    goals = (await api('/api/goals')).goals;
    const shown = goals.filter((g) => goalsFilter === 'all' || g.status === 'active');
    const fin = shown.filter((g) => g.kind === 'financial');
    const proj = shown.filter((g) => g.kind === 'project');
    el.innerHTML = html`
      <div class="top">
        <div><div class="eyebrow">Goals</div><div class="title">Build toward launch.</div></div>
        <div class="actions">
          <div class="seg"><button class="${goalsFilter === 'active' ? 'on' : ''}" data-action="goals-filter" data-f="active">Active</button><button class="${goalsFilter === 'all' ? 'on' : ''}" data-action="goals-filter" data-f="all">All</button></div>
          <button class="btn" data-action="new-goal" data-kind="project">+ Project goal</button>
          <button class="btn primary" data-action="new-goal" data-kind="financial">+ Financial goal</button>
        </div>
      </div>
      <h2 style="font-size:15px">Financial goals</h2>
      ${fin.length ? html`<div class="grid g2">${fin.map(goalCard)}</div>` : html`<div class="card empty">No financial goals. Try "Revenue $10,000 in Q1" or "Build a $1,000 reserve".</div>`}
      <h2 style="font-size:15px;margin-top:26px">Project goals</h2>
      ${proj.length ? html`<div class="grid g2">${proj.map(goalCard)}</div>` : html`<div class="card empty">No project goals. Try "Film the Rain music video" with steps.</div>`}`.s;
  }

  function goalCard(g) {
    const [label, cls] = GOAL_STATUS[g.status];
    const range = [g.start_date && 'from ' + shortDate(g.start_date), g.due_date && 'due ' + fmtDate(g.due_date)].filter(Boolean).join(' · ');
    return html`<div class="goal">
      <div class="gh"><div><h3>${g.title}</h3>
        <div class="meta">${g.kind === 'financial' ? METRICS[g.metric] + (g.category ? ' · ' + g.category : '') : 'Project'}${range ? ' · ' + range : ''}${g.owner ? ' · ' + g.owner : ''}</div></div>
        <div style="display:flex;gap:6px;align-items:center"><span class="tag ${cls}">${label}</span><button class="btn sm" data-action="edit-goal" data-id="${g.id}">Edit</button></div></div>
      <div class="track" style="margin-top:12px;height:10px"><div class="fill ${progressClass(g)}" style="width:${Math.min(100, g.progress * 100)}%"></div></div>
      <div class="nums"><span>${goalNumbers(g)}</span><b>${pct(g.progress)}</b></div>
      ${g.kind === 'financial' && g.metric === 'manual' ? html`<div style="margin-top:8px"><button class="btn sm" data-action="goal-update-amount" data-id="${g.id}">Update amount</button></div>` : ''}
      ${g.kind === 'project' ? html`<div style="margin-top:10px">
        ${g.milestones.map((m) => html`<div class="ms ${m.done ? 'done' : ''}">
          <input type="checkbox" data-change="milestone-toggle" data-id="${m.id}" ${m.done ? raw('checked') : ''} aria-label="Done">
          <span class="t grow">${m.title}</span>${m.due_date ? html`<span class="small">${shortDate(m.due_date)}</span>` : ''}
          <button class="btn link sm" data-action="milestone-delete" data-id="${m.id}" aria-label="Remove step">✕</button></div>`)}
        <form class="ms-add" data-submit="milestone-add" data-goal="${g.id}"><input name="title" placeholder="Add a step…" maxlength="160"><input name="due_date" type="date" style="width:150px"><button class="btn sm">Add</button></form>
      </div>` : ''}
      ${g.notes ? html`<div class="small" style="margin-top:10px;white-space:pre-wrap">${g.notes}</div>` : ''}
    </div>`;
  }

  function goalForm(g) {
    const kind = g.kind;
    const metric = g.metric || 'revenue';
    const allCats = [...CATEGORIES.revenue, ...CATEGORIES.expense];
    openModal({
      title: g.id ? 'Edit goal' : kind === 'financial' ? 'New financial goal' : 'New project goal',
      body: html`<div class="form">
        <input type="hidden" name="kind" value="${kind}">
        <label class="f full"><span>Goal</span><input name="title" value="${g.title || ''}" required placeholder="${kind === 'financial' ? 'Q1 revenue' : 'Film the “Rain” music video'}"></label>
        ${kind === 'financial' ? html`
          <label class="f full"><span>How is it measured?</span><select name="metric" data-change="goal-metric">${opts([
            ['revenue', 'Revenue earned (from transactions)'], ['net', 'Net profit (revenue − expenses)'],
            ['expenses', 'Spending budget — stay under (from transactions)'], ['manual', 'Tracked manually (e.g. savings reserve)']], metric)}</select></label>
          <label class="f full" data-for="revenue expenses"><span>Only count category (optional)</span><select name="category">${opts([['', 'All categories'], ...allCats], g.category)}</select></label>
          <label class="f"><span id="targetLabel">Target ($)</span><input name="target" type="number" step="0.01" min="0" inputmode="decimal" value="${dollars(g.target_cents)}" required></label>
          <label class="f" data-for="manual"><span>Current amount ($)</span><input name="current" type="number" step="0.01" min="0" inputmode="decimal" value="${dollars(g.current_cents)}"></label>
          <div class="hint full" data-for="revenue net expenses">Progress is calculated automatically from transactions between the start and due dates.</div>` : ''}
        <label class="f"><span>Start date</span><input name="start_date" type="date" value="${g.start_date || ''}"></label>
        <label class="f"><span>Due date</span><input name="due_date" type="date" value="${g.due_date || ''}"></label>
        <label class="f"><span>Owner</span><input name="owner" value="${g.owner || ''}" placeholder="Twurt, Britney…"></label>
        <label class="f"><span>Status</span><select name="status">${opts(Object.entries(GOAL_STATUS).map(([k, v]) => [k, v[0]]), g.status || 'active')}</select></label>
        ${kind === 'project' && !g.id ? html`<label class="f full"><span>Steps (one per line)</span><textarea name="milestones" placeholder="Book the studio&#10;Shoot the video&#10;Edit + release"></textarea></label>` : ''}
        <label class="f full"><span>Notes</span><textarea name="notes">${g.notes || ''}</textarea></label>
      </div>`,
      onSubmit: async (d) => {
        if (d.milestones !== undefined) d.milestones = d.milestones.split('\n').map((s) => s.trim()).filter(Boolean);
        await api(g.id ? `/api/goals/${g.id}` : '/api/goals', { method: g.id ? 'PUT' : 'POST', body: d });
        toast(g.id ? 'Goal updated' : 'Goal added');
      },
      onDelete: g.id ? async () => {
        if (!confirm('Delete this goal?')) return false;
        await api(`/api/goals/${g.id}`, { method: 'DELETE' });
        toast('Goal deleted');
      } : null,
    });
    if (kind === 'financial') syncGoalMetric();
  }

  function syncGoalMetric() {
    const form = $('#modal form');
    const m = form.metric.value;
    $$('[data-for]', form).forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(m); });
    $('#targetLabel').textContent = m === 'expenses' ? 'Budget limit ($)' : 'Target ($)';
  }

  const goalPayload = (g, patch) => ({
    kind: g.kind, title: g.title, metric: g.metric, category: g.category, target: dollars(g.target_cents), current: dollars(g.current_cents),
    start_date: g.start_date, due_date: g.due_date, status: g.status, owner: g.owner, notes: g.notes, ...patch,
  });

  // ---------------------------------------------------------------- settings
  async function pageSettings(el) {
    const u = state.user;
    const team = can('users') ? await api('/api/users') : null;
    el.innerHTML = html`
      <div class="top"><div><div class="eyebrow">Settings</div><div class="title">Accounts & access.</div></div></div>
      <div class="grid g2">
        <div class="card">
          <h2>My account</h2>
          <div class="small">${u.name} · ${u.email} · ${state.roles[u.role]?.label || u.role}</div>
          <form data-submit="password" class="stack" style="margin-top:14px">
            <label class="f"><span>Current password</span><input name="current" type="password" autocomplete="current-password" required></label>
            <label class="f"><span>New password (10+ characters)</span><input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
            <label class="f"><span>Confirm new password</span><input name="confirm" type="password" autocomplete="new-password" required></label>
            <button class="btn primary">Change password</button>
          </form>
        </div>
        ${team ? html`<div class="card">
          <div class="card-head"><h2>Team access</h2><button class="btn sm" data-action="new-user">+ Add person</button></div>
          ${team.users.map((p) => html`<div class="list-item ${p.active ? '' : 'dim'}" style="${p.active ? '' : 'opacity:.5'}">
            <div class="grow"><b>${p.name}</b><div class="small">${p.email} · ${team.roles[p.role]?.label || p.role}${p.active ? '' : ' · disabled'}</div></div>
            <button class="btn sm" data-action="edit-user" data-id="${p.id}">Edit</button></div>`)}
          <div class="hint" style="margin-top:12px">Owners see everything. When your publicist and social manager join, they'll get their own roles that only show the pages they need.</div>
        </div>` : ''}
      </div>`.s;
    state.team = team?.users || [];
  }

  function userForm(p = {}) {
    const roles = Object.entries(state.roles).map(([k, r]) => [k, r.label]);
    openModal({
      title: p.id ? `Edit ${p.name}` : 'Add a person',
      body: html`<div class="form">
        <label class="f"><span>Name</span><input name="name" value="${p.name || ''}" required></label>
        ${p.id ? html`<label class="f"><span>Email</span><input value="${p.email}" disabled></label>` : html`<label class="f"><span>Email</span><input name="email" type="email" required></label>`}
        <label class="f"><span>Role</span><select name="role">${opts(roles, p.role || 'owner')}</select></label>
        <label class="f"><span>${p.id ? 'Reset password (optional)' : 'Temporary password'}</span><input name="password" type="text" autocomplete="off" minlength="10" ${p.id ? '' : raw('required')} placeholder="10+ characters"></label>
        ${p.id ? html`<label class="check full"><input type="checkbox" name="active" ${p.active ? raw('checked') : ''}> Can sign in</label>` : ''}
        <div class="hint full">Share the password privately. They can change it under Settings after signing in.</div>
      </div>`,
      onSubmit: async (d) => {
        if (p.id && !d.password) delete d.password;
        await api(p.id ? `/api/users/${p.id}` : '/api/users', { method: p.id ? 'PUT' : 'POST', body: d });
        toast(p.id ? 'Saved' : 'Person added');
      },
    });
  }

  // ---------------------------------------------------------------- events
  const actions = {
    'logout': async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); state.user = null; state.shows = null; render(); },
    'close-modal': () => closeModal(),
    'modal-delete': async () => {
      try {
        if (await modalSubmit.onDelete() === false) return;
        closeModal();
        refresh();
      } catch (err) { modalError(err.message); }
    },
    'new-tx': (d) => txForm({ type: d.type, show_id: d.show || '' }),
    'edit-tx': async (d) => {
      let tx = lastTx.find((t) => String(t.id) === d.id);
      if (!tx) tx = (await api('/api/transactions')).transactions.find((t) => String(t.id) === d.id);
      if (tx) txForm(tx);
    },
    'tx-type': (d) => {
      const form = $('#modal form');
      form.type.value = d.type;
      $$('.seg button', form).forEach((b) => b.classList.toggle('on', b.dataset.type === d.type));
      $('#txCategory').innerHTML = opts(CATEGORIES[d.type]).map(part).join('');
      $('.modal-head h3').textContent = d.type === 'revenue' ? 'Record revenue' : 'Record expense';
    },
    'new-show': () => showForm(),
    'show-detail': (d) => showDetail(d.id).catch((e) => toast(e.message, true)),
    'edit-show': () => showForm(JSON.parse($('#modal').dataset.show)),
    'new-item': () => itemForm(),
    'edit-item': (d) => itemForm(merchItems.find((i) => String(i.id) === d.id)),
    'adjust-item': (d) => adjustForm(merchItems.find((i) => String(i.id) === d.id)),
    'item-history': (d) => itemHistory(merchItems.find((i) => String(i.id) === d.id)),
    'goals-filter': (d) => { goalsFilter = d.f; refresh(); },
    'new-goal': (d) => goalForm({ kind: d.kind }),
    'edit-goal': (d) => goalForm(goals.find((g) => String(g.id) === d.id)),
    'goal-update-amount': async (d) => {
      const g = goals.find((x) => String(x.id) === d.id);
      const val = prompt(`Current amount for "${g.title}" ($):`, dollars(g.current_cents));
      if (val === null) return;
      try {
        await api(`/api/goals/${g.id}`, { method: 'PUT', body: goalPayload(g, { current: val }) });
        refresh();
      } catch (err) { toast(err.message, true); }
    },
    'milestone-delete': async (d) => {
      try { await api(`/api/milestones/${d.id}`, { method: 'DELETE' }); refresh(); } catch (err) { toast(err.message, true); }
    },
    'new-user': () => userForm(),
    'edit-user': (d) => userForm(state.team.find((p) => String(p.id) === d.id)),
  };

  const changes = {
    'dash-year': (el) => { dashYear = el.value; refresh(); },
    'money-filter': (el) => {
      const form = el.form;
      Object.assign(moneyState, formData(form));
      if (moneyState.period === 'custom' && !moneyState.from && !moneyState.to) {
        [moneyState.from, moneyState.to] = [`${new Date().getFullYear()}-01-01`, todayStr()];
      }
      refresh();
    },
    'adjust-reason': () => syncAdjust(),
    'goal-metric': () => syncGoalMetric(),
    'milestone-toggle': async (el) => {
      try { await api(`/api/milestones/${el.dataset.id}`, { method: 'PUT', body: { done: el.checked } }); refresh(); } catch (err) { toast(err.message, true); }
    },
  };

  const submits = {
    async login(d) {
      try {
        const res = await api('/api/auth/login', { method: 'POST', body: d });
        state.user = res.user;
        render();
      } catch (err) { authError(err.message); }
    },
    async setup(d) {
      if (d.password !== d.confirm) return authError("Passwords don't match");
      try {
        const res = await api('/api/auth/setup', { method: 'POST', body: d });
        state.user = res.user;
        state.needsSetup = false;
        render();
      } catch (err) { authError(err.message); }
    },
    async password(d, form) {
      if (d.password !== d.confirm) return toast("New passwords don't match", true);
      try {
        await api('/api/auth/password', { method: 'POST', body: d });
        form.reset();
        toast('Password changed');
      } catch (err) { toast(err.message, true); }
    },
    'money-filter': (d) => { Object.assign(moneyState, d); refresh(); },
    async 'milestone-add'(d, form) {
      if (!d.title.trim()) return;
      try { await api(`/api/goals/${form.dataset.goal}/milestones`, { method: 'POST', body: d }); refresh(); } catch (err) { toast(err.message, true); }
    },
    async modal(d, form) {
      if (!modalSubmit?.onSubmit) return;
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      modalError('');
      try {
        const handler = modalSubmit.onSubmit;
        await handler(d);
        // A handler may open a follow-up modal (e.g. show detail); only close if it didn't.
        if (modalSubmit?.onSubmit === handler) closeModal();
        refresh();
      } catch (err) {
        modalError(err.message);
      } finally {
        btn.disabled = false;
      }
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn(el.dataset, el)).catch((err) => toast(err.message, true));
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && changes[el.dataset.change]) changes[el.dataset.change](el, e);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const fn = submits[form.dataset.submit];
    if (!fn) return;
    e.preventDefault();
    fn(formData(form), form);
  });
  $('#modal').addEventListener('close', () => { modalSubmit = null; });
  window.addEventListener('hashchange', () => { closeModal(); render(); });

  // ---------------------------------------------------------------- boot
  api('/api/auth/status')
    .then((s) => {
      state.user = s.user;
      state.needsSetup = s.needsSetup;
      state.roles = s.roles;
      render();
    })
    .catch((err) => {
      $('#root').innerHTML = html`<div class="login"><div class="login-card"><div class="error">Couldn't reach the server: ${err.message}</div></div></div>`.s;
    });
})();
