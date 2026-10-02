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
  const state = { user: null, needsSetup: false, roles: {}, features: {}, shows: null };

  const PAGES = {
    dashboard: { label: 'Dashboard', area: 'finance', render: pageDashboard },
    money: { label: 'Money', area: 'finance', render: pageMoney },
    shows: { label: 'Shows', area: 'shows', render: pageShows },
    merch: { label: 'Merch', area: 'merch', render: pageMerch },
    goals: { label: 'Goals', area: 'goals', render: pageGoals },
    social: { label: 'Social', area: 'social', render: pageSocial, badge: 'social' },
    messages: { label: 'Messages', area: 'messages', render: pageMessages, badge: 'messages' },
    settings: { label: 'Settings', area: null, render: pageSettings },
  };

  function can(area) {
    const role = state.roles[state.user?.role];
    return !area || (role && (role.areas === '*' || role.areas.includes(area)));
  }
  const allowedPages = () => Object.keys(PAGES).filter((p) => can(PAGES[p].area));

  function currentPage() {
    const p = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0];
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
    const nav = allowedPages().map((p) => html`<a href="#/${p}" class="${p === page ? 'active' : ''}">${PAGES[p].label}${PAGES[p].badge ? html` <span class="nav-count" data-badge="${PAGES[p].badge}" hidden></span>` : ''}</a>`);
    root.innerHTML = html`
      <div class="mobilebar">
        <div class="row1"><img src="/logo.png" alt="Twurt">
          <div class="actions">${can('messages') ? html`<a class="btn sm" href="#/messages" aria-label="Messages">💬 <span class="nav-count" data-badge="messages" hidden></span></a>` : ''}
            <button class="btn sm" data-action="logout">Sign out</button></div></div>
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
    updateBadges();
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
      <div class="hint section">Value = in stock × price (and × cost underneath). Totals above count active items only. Add each size or color as its own item (e.g. "Rain Tee" · M). Use <b>Adjust</b> after every show or restock — selling can record the revenue for you.</div>
      <div class="card section">${merchItems.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Item</th><th class="num">In stock</th><th class="num hide-sm">Sold</th><th class="num hide-sm">Cost</th><th class="num hide-sm">Price</th><th class="num hide-sm">Margin</th><th class="num">Value</th><th></th></tr></thead>
        <tbody>${merchItems.map((i) => html`<tr class="${i.active ? '' : 'dim'}">
          <td class="clickable" data-action="edit-item" data-id="${i.id}" style="cursor:pointer"><b>${i.name}</b>${i.variant ? html` <span class="tag">${i.variant}</span>` : ''}
            <div class="small">${i.sku || ''}${i.active ? '' : ' · inactive'}</div><div class="small show-sm">${money(i.price_cents)} each</div></td>
          <td class="num"><b>${i.quantity}</b>${i.active && i.quantity <= i.low_stock ? html`<div><span class="tag ${i.quantity === 0 ? 'red' : 'yellow'}">${i.quantity === 0 ? 'Out' : 'Low'}</span></div>` : ''}</td>
          <td class="num hide-sm">${i.units_sold}</td>
          <td class="num hide-sm">${money(i.unit_cost_cents)}</td>
          <td class="num hide-sm">${money(i.price_cents)}</td>
          <td class="num hide-sm">${i.price_cents ? pct((i.price_cents - i.unit_cost_cents) / i.price_cents) : '—'}</td>
          <td class="num">${i.active ? html`${money(i.quantity * i.price_cents)}<div class="small">${money(i.quantity * i.unit_cost_cents)} cost</div>` : '—'}</td>
          <td class="num item-actions"><button class="btn sm" data-action="adjust-item" data-id="${i.id}">Adjust</button>
            <button class="btn sm link" data-action="item-history" data-id="${i.id}">History</button></td></tr>`)}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${units}</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td><td class="hide-sm"></td>
          <td class="num">${money(retail)}<div class="small">${money(cost)} cost</div></td><td></td></tr></tfoot></table></div>`
        : html`<div class="empty">No merch yet. Add your first item.</div>`}</div>`.s;
  }

  // Other sizes/colors of the same item (same name).
  const otherSizes = (item) => merchItems.filter((i) => i.id !== item.id && i.name.trim().toLowerCase() === (item.name || '').trim().toLowerCase());

  function itemForm(item = {}) {
    const others = item.id ? otherSizes(item) : [];
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
        ${others.length ? html`<label class="check full"><input type="checkbox" name="apply_to_all_sizes" checked>
          Use this cost and price for all sizes of ${item.name} (${others.map((o) => o.variant || 'no size').join(', ')})</label>` : ''}
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
          <label class="check full" data-for="sale restock"><input type="checkbox" name="update_item_amount"> <span id="updateLabel"></span></label>
          ${otherSizes(item).length ? html`<label class="check full" data-for="sale restock" style="padding-left:24px"><input type="checkbox" name="all_sizes" checked> <span>…for all sizes of ${item.name}</span></label>` : ''}
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
      $('#updateLabel').textContent = 'Make this the new sale price';
      form.unit_amount.value = dollars(item.price_cents);
      form.update_item_amount.checked = false;
    } else if (reason === 'restock') {
      $('#recordLabel').textContent = 'Also record the cost as a Merch expense';
      $('#unitLabel').textContent = 'Cost per unit ($)';
      $('#updateLabel').textContent = 'Make this the new unit cost (updates stock value)';
      form.unit_amount.value = dollars(item.unit_cost_cents);
      form.update_item_amount.checked = true;
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

  // ---------------------------------------------------------------- social media
  // Platform colors follow the platform everywhere (validated categorical set for the dark surface).
  const PLATFORMS = {
    instagram: { label: 'Instagram', color: '#3987e5' },
    tiktok: { label: 'TikTok', color: '#d95926' },
    youtube: { label: 'YouTube', color: '#199e70' },
    facebook: { label: 'Facebook', color: '#c98500' },
  };
  const POST_TYPES = ['post', 'reel', 'story', 'video', 'carousel', 'live'];
  const POST_STATUS = {
    draft: ['Draft', ''], in_review: ['Needs review', 'yellow'], changes_requested: ['Changes requested', 'red'],
    approved: ['Approved', 'green'], scheduled: ['Scheduled', 'green'], posted: ['Posted', ''],
  };
  const STATUS_VERB = {
    in_review: 'sent this for review', draft: 'withdrew it from review', approved: 'approved it',
    changes_requested: 'asked for changes', scheduled: 'marked it scheduled', posted: 'marked it posted',
  };
  const CAMPAIGN_STATUS = { planning: ['Planning', 'yellow'], active: ['Active', 'green'], done: ['Done', ''] };
  const SOCIAL_TABS = [['', 'Overview'], ['content', 'Content'], ['calendar', 'Calendar'], ['campaigns', 'Campaigns'], ['metrics', 'Metrics']];
  const SOCIAL_TITLES = { '': 'Grow the audience.', content: 'Content & review.', calendar: 'Content calendar.', campaigns: 'Campaigns.', metrics: 'Metrics & growth.' };
  const CONTENT_FILTERS = [['active', 'In progress'], ['in_review', 'Needs review'], ['approved', 'Approved'], ['posted', 'Posted'], ['all', 'All']];
  const FILTER_STATUSES = { active: 'draft,in_review,changes_requested,approved,scheduled', in_review: 'in_review', approved: 'approved,scheduled', posted: 'posted', all: '' };

  const subPage = () => location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[1] || '';
  const hashParam = (k) => new URLSearchParams(location.hash.split('?')[1] || '').get(k);
  const plist = (s) => String(s || '').split(',').filter(Boolean);
  const platformChips = (s) => plist(s).map((p) => html`<span class="pchip"><i style="background:${PLATFORMS[p]?.color || '#777'}"></i>${PLATFORMS[p]?.label || p}</span>`);
  const fmtWhen = (s) => {
    if (!s) return '';
    const timed = s.length > 10;
    return new Date(timed ? s : s + 'T00:00').toLocaleString('en-US', timed
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  };
  const fmtTime = (s) => new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const fmtStamp = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const num = (n) => n == null ? '—' : Number(n).toLocaleString('en-US');
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const fileSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const postLinks = (p) => String(p.external_link || '').split('\n').filter(Boolean);
  // Google Drive file links can be previewed inline; folders and other sites open in a new tab.
  function driveFileId(link) {
    try {
      const u = new URL(link);
      if (!/(^|\.)drive\.google\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/file\/d\/([\w-]{10,})/);
      const id = m ? m[1] : u.searchParams.get('id');
      return id && /^[\w-]{10,}$/.test(id) && !u.pathname.includes('/folders/') ? id : null;
    } catch { return null; }
  }
  const linkLabel = (link) => {
    try {
      const u = new URL(link);
      if (u.hostname.endsWith('drive.google.com')) return u.pathname.includes('/folders/') ? 'Google Drive folder' : 'Google Drive file';
      if (u.hostname.endsWith('dropbox.com')) return 'Dropbox';
      return u.hostname.replace(/^www\./, '');
    } catch { return 'Link'; }
  };
  const statusTag = (s) => { const [l, c] = POST_STATUS[s] || [s, '']; return html`<span class="tag ${c}">${l}</span>`; };

  async function pageSocial(el) {
    const sub = subPage();
    const tab = SOCIAL_TABS.some(([k]) => k === sub) ? sub : '';
    const button = tab === 'metrics' ? html`<button class="btn primary" data-action="log-metric">+ Log numbers</button>`
      : tab === 'campaigns' ? html`<button class="btn primary" data-action="new-campaign">+ Campaign</button>`
        : html`<button class="btn primary" data-action="new-post">+ New post</button>`;
    const body = await { '': socialOverview, content: socialContent, calendar: socialCalendar, campaigns: socialCampaigns, metrics: socialMetrics }[tab]();
    el.innerHTML = html`
      <div class="top"><div><div class="eyebrow">Social media</div><div class="title">${SOCIAL_TITLES[tab]}</div></div><div class="actions">${button}</div></div>
      <nav class="tabs">${SOCIAL_TABS.map(([k, l]) => html`<a href="#/social${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}">${l}</a>`)}</nav>
      ${body}`.s;
    if (tab === 'metrics') drawChart();
  }

  async function socialOverview() {
    const d = await api('/api/social/overview');
    const c = d.counts;
    const tile = (f, label, n, note) => html`<a class="card metric link-card" href="#/social/content?f=${f}"><div class="label">${label}</div><div class="value">${n || 0}</div><div class="small">${note}</div></a>`;
    return html`
      <div class="grid g4">
        ${tile('in_review', 'Waiting for review', c.in_review, d.canApprove ? 'Needs your OK' : 'With Twurt')}
        ${tile('active', 'Changes requested', c.changes_requested, 'Back to the drawing board')}
        ${tile('approved', 'Approved to post', (c.approved || 0) + (c.scheduled || 0), 'Approved or scheduled')}
        ${tile('posted', 'Posted', c.posted, 'All time')}
      </div>
      <div class="grid g21 section">
        <div class="card"><div class="card-head"><h2>Coming up</h2><a class="btn sm" href="#/social/calendar">Calendar</a></div>
          ${d.upcoming.length ? d.upcoming.map((p) => html`<div class="list-item clickable" data-action="post-detail" data-id="${p.id}">
              <div class="grow"><b>${p.title}</b><div class="small">${platformChips(p.platforms)}${p.campaign_name ? ' · ' + p.campaign_name : ''}</div></div>
              <div style="text-align:right"><div class="small">${fmtWhen(p.planned_at)}</div>${statusTag(p.status)}</div></div>`)
            : html`<div class="empty">Nothing planned yet. <a href="#" data-action="new-post">Plan a post</a>.</div>`}
        </div>
        <div class="card"><div class="card-head"><h2>Followers</h2><a class="btn sm" href="#/social/metrics">Metrics</a></div>
          ${d.followers.length ? d.followers.map((f) => {
            const diff = f.prior ? f.followers - f.prior.followers : null;
            return html`<div class="list-item"><div class="grow">${platformChips(f.platform)}<div class="small">as of ${fmtDate(f.date)}</div></div>
              <div style="text-align:right"><b>${num(f.followers)}</b>${diff != null ? html`<div class="small ${diff < 0 ? 'neg' : 'pos'}">${diff < 0 ? '▼ ' : '▲ +'}${num(diff)} in 30 days</div>` : ''}</div></div>`;
          }) : html`<div class="empty">No numbers yet. <a href="#/social/metrics">Log this week's numbers</a>.</div>`}
          <h2 style="margin-top:18px">Active campaigns</h2>
          ${d.campaigns.length ? d.campaigns.map((cp) => html`<div class="list-item"><div class="grow"><b>${cp.name}</b><div class="small">${cp.post_count} posts${cp.end_date ? ' · ends ' + fmtDate(cp.end_date) : ''}</div></div>
              <a class="btn sm" href="#/social/content?f=all&campaign=${cp.id}">Posts</a></div>`)
            : html`<div class="small">None active. <a href="#/social/campaigns">Plan one</a>.</div>`}
        </div>
      </div>`;
  }

  async function socialContent() {
    const f = FILTER_STATUSES[hashParam('f')] !== undefined ? hashParam('f') : 'active';
    const campaign = hashParam('campaign');
    const q = new URLSearchParams();
    if (FILTER_STATUSES[f]) q.set('status', FILTER_STATUSES[f]);
    if (campaign) q.set('campaign_id', campaign);
    const { posts } = await api('/api/social/posts?' + q);
    return html`
      <div class="filters">
        <div class="seg">${CONTENT_FILTERS.map(([k, l]) => html`<a href="#/social/content?f=${k}${campaign ? '&campaign=' + campaign : ''}" class="${k === f ? 'on' : ''}">${l}</a>`)}</div>
        ${campaign ? html`<span class="tag">Campaign: ${posts[0]?.campaign_name || 'selected'} <a href="#/social/content?f=${f}" aria-label="Show all campaigns">✕</a></span>` : ''}
      </div>
      ${posts.length ? html`<div class="grid g3">${posts.map(postCard)}</div>` : html`<div class="card empty">Nothing here yet.</div>`}`;
  }

  const mediaUrl = (id) => `/api/social/media/${id}`;
  const postCard = (p) => html`
    <div class="card post-card" data-action="post-detail" data-id="${p.id}">
      <div class="thumb">${p.cover_media_id
        ? (p.cover_type.startsWith('image/') ? html`<img src="${mediaUrl(p.cover_media_id)}" alt="" loading="lazy">`
          : html`<video src="${mediaUrl(p.cover_media_id)}#t=0.5" preload="metadata" muted playsinline></video><span class="play">▶</span>`)
        : html`<span class="small">${postLinks(p).length ? `${postLinks(p).length} link${postLinks(p).length > 1 ? 's' : ''} to content` : 'No content linked yet'}</span>`}
        ${p.media_count > 1 ? html`<span class="count">+${p.media_count - 1}</span>` : ''}</div>
      <div class="row-between"><b>${p.title}</b>${statusTag(p.status)}</div>
      <div class="small" style="margin-top:4px">${platformChips(p.platforms)} · ${p.post_type || 'post'}</div>
      <div class="small">${p.planned_at ? fmtWhen(p.planned_at) : 'No date yet'}${p.campaign_name ? ' · ' + p.campaign_name : ''}${p.comment_count ? ` · ${p.comment_count} comment${p.comment_count > 1 ? 's' : ''}` : ''}</div>
    </div>`;

  async function postDetail(id) {
    const d = await api(`/api/social/posts/${id}`);
    const p = d.post;
    const btn = (s, label, cls = '') => html`<button type="button" class="btn sm ${cls}" data-action="post-status" data-status="${s}">${label}</button>`;
    const acts = [];
    if (d.canEdit) acts.push(html`<button type="button" class="btn sm" data-action="edit-post">Edit</button>`);
    if (['draft', 'changes_requested'].includes(p.status)) {
      acts.push(d.canApprove ? btn('approved', p.status === 'draft' ? 'Approve' : 'Approve as is', 'rev') : btn('in_review', 'Send to Twurt for review', 'primary'));
    }
    if (p.status === 'in_review') {
      if (d.canApprove) acts.push(btn('approved', 'Approve', 'rev'), btn('changes_requested', 'Request changes', 'exp'));
      else acts.push(btn('draft', 'Withdraw'));
    }
    if (p.status === 'approved') acts.push(btn('scheduled', 'Mark scheduled'));
    if (['approved', 'scheduled'].includes(p.status)) {
      acts.push(btn('posted', 'Mark posted', 'rev'));
      if (d.canApprove) acts.push(btn('changes_requested', 'Request changes', 'exp'));
    }
    if (p.status === 'posted') acts.push(html`<button type="button" class="btn sm" data-action="post-results">Update results</button>`);

    openModal({
      title: p.title,
      wide: true,
      body: html`
        <div class="small">${statusTag(p.status)} ${platformChips(p.platforms)} · ${p.post_type || 'post'}${p.planned_at ? ' · ' + fmtWhen(p.planned_at) : ' · no date yet'}${p.campaign_name ? ' · ' + p.campaign_name : ''} · by ${p.created_by_name || '—'}</div>
        <div class="actions" style="margin:12px 0">${acts}</div>
        ${d.media.length ? html`<div class="media-grid">${d.media.map((m) => html`<figure>
          ${m.content_type.startsWith('image/') ? html`<a href="${mediaUrl(m.id)}" target="_blank" rel="noopener"><img src="${mediaUrl(m.id)}" alt="${m.filename}"></a>`
            : html`<video src="${mediaUrl(m.id)}" controls preload="metadata" playsinline></video>`}
          <figcaption>${m.filename} · ${fileSize(m.size)}${d.canEdit ? html` <button type="button" class="btn link sm" data-action="media-delete" data-id="${m.id}">Remove</button>` : ''}</figcaption></figure>`)}</div>` : ''}
        ${d.canEdit && d.uploads ? html`<div style="margin:8px 0"><label class="btn sm">+ Add photos / videos<input type="file" accept="image/*,video/*" multiple data-change="post-upload" hidden></label> <span class="small">Up to 95 MB each</span></div>` : ''}
        ${postLinks(p).length ? html`<div class="link-grid">${postLinks(p).map((l) => {
          const id = driveFileId(l);
          return html`<div class="link-item">${id ? html`<iframe src="https://drive.google.com/file/d/${id}/preview" allow="autoplay" loading="lazy" title="Google Drive preview"></iframe>` : ''}
            <a href="${l}" target="_blank" rel="noopener noreferrer">Open ${linkLabel(l)} ↗</a></div>`;
        })}</div>
          <div class="small" style="margin-top:4px">Preview blank? In Drive, set sharing to <b>Anyone with the link can view</b>, or share the file with your Google account.</div>`
          : !d.media.length ? html`<div class="hint" style="margin:8px 0">No content linked yet.${d.canEdit ? html` Use <b>Edit</b> to add Google Drive links.` : ''}</div>` : ''}
        <h4>Caption</h4>
        <div class="caption">${p.caption || '—'}</div>
        ${p.hashtags ? html`<div class="small" style="margin-top:6px">${p.hashtags}</div>` : ''}
        ${p.status === 'posted' ? html`<h4>Results</h4><div class="grid g4 results">
          <div><div class="small">Views</div><b>${num(p.views)}</b></div><div><div class="small">Likes</div><b>${num(p.likes)}</b></div>
          <div><div class="small">Comments</div><b>${num(p.comments)}</b></div><div><div class="small">Shares</div><b>${num(p.shares)}</b></div></div>
          ${p.post_url ? html`<p><a href="${p.post_url}" target="_blank" rel="noopener noreferrer">View live post ↗</a></p>` : ''}` : ''}
        <h4>Review & comments</h4>
        <div class="thread">${d.comments.length ? d.comments.map((c) => c.kind === 'status'
          ? html`<div class="evt"><b>${c.user_name || 'Someone'}</b> ${STATUS_VERB[c.status] || c.status} · <span class="small">${fmtStamp(c.created_at)}</span>${c.body ? html`<div class="note">${c.body}</div>` : ''}</div>`
          : html`<div class="cmt"><div class="small"><b>${c.user_name || 'Someone'}</b> · ${fmtStamp(c.created_at)}</div><div class="body">${c.body}</div></div>`)
          : html`<div class="small">No comments yet.</div>`}</div>
        <div class="reply"><textarea id="commentInput" rows="2" placeholder="Ask a question or leave feedback…"></textarea>
          <button type="button" class="btn sm" data-action="post-comment">Send</button></div>`,
      onDelete: d.canApprove || p.status === 'draft' ? async () => {
        if (!confirm('Delete this post and its files?')) return false;
        await api(`/api/social/posts/${p.id}`, { method: 'DELETE' });
        toast('Post deleted');
      } : null,
    });
    state.post = d;
  }

  function uploadFiles(postId, files) {
    return files.reduce((chain, file, i) => chain.then(() => new Promise((resolve, reject) => {
      if (!/^(image|video)\//.test(file.type)) return reject(new Error(`${file.name} isn't a photo or video`));
      if (file.size > 95 * 1024 * 1024) return reject(new Error(`${file.name} is over 95 MB. Paste a Drive or Dropbox link instead.`));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/social/posts/${postId}/media`);
      xhr.setRequestHeader('content-type', file.type);
      xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) toast(`Uploading ${i + 1} of ${files.length}: ${Math.round((e.loaded / e.total) * 100)}%`); };
      xhr.onload = () => {
        if (xhr.status < 300) return resolve();
        let msg = 'Upload failed';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* not JSON */ }
        reject(new Error(msg));
      };
      xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
      xhr.send(file);
    })), Promise.resolve());
  }

  async function postForm(p = {}, preset = {}) {
    const { campaigns } = await api('/api/social/campaigns');
    const chosen = plist(p.platforms ?? 'instagram,tiktok');
    openModal({
      title: p.id ? 'Edit post' : 'New post',
      body: html`<div class="form">
        <label class="f full"><span>Working title</span><input name="title" value="${p.title || ''}" required placeholder="Rain teaser #1"></label>
        <div class="full"><span class="flabel">Platforms</span><div class="checks">${Object.entries(PLATFORMS).map(([k, pf]) =>
          html`<label class="check"><input type="checkbox" name="pf_${k}" ${chosen.includes(k) ? raw('checked') : ''}> ${pf.label}</label>`)}</div></div>
        <label class="f"><span>Type</span><select name="post_type">${opts(POST_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)]), p.post_type || 'post')}</select></label>
        <label class="f"><span>Planned for</span><input name="planned_at" type="datetime-local" value="${p.planned_at || preset.planned_at || ''}"></label>
        <label class="f full"><span>Campaign</span><select name="campaign_id">${opts([['', '— None —'], ...campaigns.map((c) => [c.id, c.name])], p.campaign_id ?? preset.campaign_id)}</select></label>
        <label class="f full"><span>Caption</span><textarea name="caption" rows="5">${p.caption || ''}</textarea></label>
        <label class="f full"><span>Hashtags</span><input name="hashtags" value="${p.hashtags || ''}" placeholder="#twurtchamberlain #countrypunkblack"></label>
        <label class="f full"><span>Links to the photos / videos (one per line)</span><textarea name="external_link" rows="3" placeholder="https://drive.google.com/file/d/…">${p.external_link || ''}</textarea></label>
        <div class="hint full">In Google Drive: right-click the file → <b>Share</b> → <b>Copy link</b>. Set it to <b>Anyone with the link can view</b> so Twurt can preview it here. Linking each file separately (instead of a folder) lets it play right in the review screen.</div>
        ${!p.id && state.features.uploads ? html`<label class="f full"><span>Photos / videos</span><input type="file" name="files" accept="image/*,video/*" multiple></label>` : ''}
        ${!p.id ? html`<div class="hint full">Saves as a draft. ${can('social_approve') ? html`Open it to approve it when it's ready.` : html`When it's ready, open it and click <b>Send to Twurt for review</b>.`}</div>` : ''}
      </div>`,
      onSubmit: async (d) => {
        d.platforms = Object.keys(PLATFORMS).filter((k) => d['pf_' + k]);
        const files = [...($('#modal input[type=file][name=files]')?.files || [])];
        delete d.files;
        const res = await api(p.id ? `/api/social/posts/${p.id}` : '/api/social/posts', { method: p.id ? 'PUT' : 'POST', body: d });
        const id = p.id || res.id;
        if (files.length) await uploadFiles(id, files);
        toast(p.id ? 'Post updated' : 'Draft saved');
        return postDetail(id);
      },
    });
  }

  function resultsForm(p) {
    openModal({
      title: `Results · ${p.title}`,
      body: html`<div class="form">
        <label class="f full"><span>Link to the live post</span><input name="post_url" type="url" value="${p.post_url || ''}"></label>
        <label class="f full"><span>Posted at</span><input name="posted_at" type="datetime-local" value="${p.posted_at || ''}"></label>
        <label class="f"><span>Views</span><input name="views" type="number" min="0" step="1" value="${p.views ?? ''}"></label>
        <label class="f"><span>Likes</span><input name="likes" type="number" min="0" step="1" value="${p.likes ?? ''}"></label>
        <label class="f"><span>Comments</span><input name="comments" type="number" min="0" step="1" value="${p.comments ?? ''}"></label>
        <label class="f"><span>Shares</span><input name="shares" type="number" min="0" step="1" value="${p.shares ?? ''}"></label>
      </div>`,
      onSubmit: async (d) => {
        await api(`/api/social/posts/${p.id}/results`, { method: 'PUT', body: d });
        toast('Results saved');
        return postDetail(p.id);
      },
    });
  }

  async function socialCalendar() {
    const m = /^\d{4}-\d{2}$/.test(hashParam('m') || '') ? hashParam('m') : todayStr().slice(0, 7);
    const [y, mo] = m.split('-').map(Number);
    const first = new Date(y, mo - 1, 1);
    const last = new Date(y, mo, 0);
    const { posts } = await api(`/api/social/posts?from=${iso(first)}&to=${iso(last)}`);
    const byDay = {};
    posts.filter((p) => p.planned_at).forEach((p) => { (byDay[p.planned_at.slice(0, 10)] ||= []).push(p); });
    const prev = iso(new Date(y, mo - 2, 1)).slice(0, 7);
    const next = iso(new Date(y, mo, 1)).slice(0, 7);
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(html`<div class="day pad"></div>`);
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = `${m}-${pad(d)}`;
      cells.push(html`<div class="day ${ds === todayStr() ? 'today' : ''}" data-action="new-post-on" data-date="${ds}" title="Plan a post on ${fmtDate(ds)}">
        <div class="dnum">${d}</div>
        ${(byDay[ds] || []).map((p) => html`<div class="chip" data-action="post-detail" data-id="${p.id}" title="${p.title} — ${POST_STATUS[p.status][0]}">
          <i style="background:${PLATFORMS[plist(p.platforms)[0]]?.color || '#777'}"></i>${p.planned_at.length > 10 ? fmtTime(p.planned_at) + ' ' : ''}${p.title}</div>`)}</div>`);
    }
    const days = Object.keys(byDay).sort();
    return html`<div class="card">
      <div class="card-head"><a class="btn sm" href="#/social/calendar?m=${prev}" aria-label="Previous month">‹</a>
        <h2>${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <a class="btn sm" href="#/social/calendar?m=${next}" aria-label="Next month">›</a></div>
      <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => html`<div class="dow">${w}</div>`)}${cells}</div>
      <div class="agenda">${days.length ? days.map((ds) => html`<div class="eyebrow" style="margin-top:12px">${fmtDate(ds)}</div>
        ${byDay[ds].map((p) => html`<div class="list-item clickable" data-action="post-detail" data-id="${p.id}"><div class="grow"><b>${p.title}</b>
          <div class="small">${platformChips(p.platforms)}${p.planned_at.length > 10 ? ' · ' + fmtTime(p.planned_at) : ''}</div></div>${statusTag(p.status)}</div>`)}`)
        : html`<div class="empty">Nothing planned this month</div>`}</div>
      <div class="legend" style="margin-top:12px">${Object.entries(PLATFORMS).map(([, pf]) => html`<span><i style="background:${pf.color}"></i>${pf.label}</span>`)}
        <span class="hide-sm">· Click a day to plan a post</span></div>
    </div>`;
  }

  let campaignsCache = [];
  async function socialCampaigns() {
    campaignsCache = (await api('/api/social/campaigns')).campaigns;
    if (!campaignsCache.length) return html`<div class="card empty">No campaigns yet. A campaign groups posts around one goal, like the "Rain" video release.</div>`;
    return html`<div class="grid g2">${campaignsCache.map((c) => {
      const [label, cls] = CAMPAIGN_STATUS[c.status] || [c.status, ''];
      const dates = [c.start_date && fmtDate(c.start_date), c.end_date && fmtDate(c.end_date)].filter(Boolean).join(' – ');
      return html`<div class="goal">
        <div class="gh"><div><h3>${c.name}</h3><div class="meta">${dates || 'No dates set'}</div></div>
          <div style="display:flex;gap:6px;align-items:center"><span class="tag ${cls}">${label}</span><button class="btn sm" data-action="edit-campaign" data-id="${c.id}">Edit</button></div></div>
        <div style="margin-top:8px">${platformChips(c.platforms)}</div>
        ${c.objective ? html`<p class="small" style="white-space:pre-wrap">${c.objective}</p>` : ''}
        <div class="track" style="margin-top:10px"><div class="fill good" style="width:${c.post_count ? (c.posted_count / c.post_count) * 100 : 0}%"></div></div>
        <div class="nums"><span>${c.posted_count} of ${c.post_count} posts live</span>${c.budget_cents != null ? html`<span>Budget ${money(c.budget_cents)}</span>` : ''}</div>
        <div class="actions" style="margin-top:10px"><a class="btn sm" href="#/social/content?f=all&campaign=${c.id}">View posts</a>
          <button class="btn sm" data-action="new-post" data-campaign="${c.id}">+ Add post</button></div>
        ${c.notes ? html`<div class="small" style="margin-top:10px;white-space:pre-wrap">${c.notes}</div>` : ''}
      </div>`;
    })}</div>`;
  }

  function campaignForm(c = {}) {
    const chosen = plist(c.platforms ?? 'instagram,tiktok');
    openModal({
      title: c.id ? 'Edit campaign' : 'New campaign',
      body: html`<div class="form">
        <label class="f full"><span>Campaign</span><input name="name" value="${c.name || ''}" required placeholder="Rain video release"></label>
        <label class="f full"><span>Objective</span><textarea name="objective" rows="2" placeholder="What does success look like? e.g. 1,000 new TikTok followers, 50k views">${c.objective || ''}</textarea></label>
        <div class="full"><span class="flabel">Platforms</span><div class="checks">${Object.entries(PLATFORMS).map(([k, pf]) =>
          html`<label class="check"><input type="checkbox" name="pf_${k}" ${chosen.includes(k) ? raw('checked') : ''}> ${pf.label}</label>`)}</div></div>
        <label class="f"><span>Start</span><input name="start_date" type="date" value="${c.start_date || ''}"></label>
        <label class="f"><span>End</span><input name="end_date" type="date" value="${c.end_date || ''}"></label>
        <label class="f"><span>Status</span><select name="status">${opts(Object.entries(CAMPAIGN_STATUS).map(([k, v]) => [k, v[0]]), c.status || 'planning')}</select></label>
        <label class="f"><span>Ad budget ($, optional)</span><input name="budget" type="number" min="0" step="0.01" value="${dollars(c.budget_cents)}"></label>
        <label class="f full"><span>Notes</span><textarea name="notes" placeholder="Content ideas, collaborators, key dates…">${c.notes || ''}</textarea></label>
      </div>`,
      onSubmit: async (d) => {
        d.platforms = Object.keys(PLATFORMS).filter((k) => d['pf_' + k]);
        await api(c.id ? `/api/social/campaigns/${c.id}` : '/api/social/campaigns', { method: c.id ? 'PUT' : 'POST', body: d });
        toast(c.id ? 'Campaign updated' : 'Campaign added');
      },
      onDelete: c.id ? async () => {
        if (!confirm('Delete this campaign? Its posts are kept.')) return false;
        await api(`/api/social/campaigns/${c.id}`, { method: 'DELETE' });
        toast('Campaign deleted');
      } : null,
    });
  }

  let metricsCache = { metrics: [] };
  async function socialMetrics() {
    metricsCache = await api('/api/social/metrics');
    chartSeries = null;
    const rows = metricsCache.metrics;
    const series = {};
    for (const p of Object.keys(PLATFORMS)) {
      const s = rows.filter((r) => r.platform === p && r.followers != null).sort((a, b) => (a.date < b.date ? -1 : 1));
      if (s.length) series[p] = s;
    }
    chartSeries = series;
    const tiles = Object.entries(series).map(([p, s]) => {
      const latest = s[s.length - 1];
      const cutoff = iso(new Date(new Date(latest.date + 'T00:00').getTime() - 30 * 864e5));
      const prior = [...s].reverse().find((r) => r.date <= cutoff);
      const diff = prior ? latest.followers - prior.followers : null;
      const total = latest.followers - s[0].followers;
      return html`<div class="card metric"><div class="label">${platformChips(p)}</div><div class="value">${num(latest.followers)}</div>
        <div class="small">${diff != null ? html`<span class="${diff < 0 ? 'neg' : 'pos'}">${diff < 0 ? '▼ ' : '▲ +'}${num(diff)}</span> last 30 days · ` : ''}${s.length > 1 ? `${total >= 0 ? '+' : ''}${num(total)} since ${shortDate(s[0].date)}` : 'First entry'}</div></div>`;
    });
    const rate = (r) => (r.views && r.engagement != null ? ((r.engagement / r.views) * 100).toFixed(1) + '%' : '—');
    return html`
      <div class="hint">Every week, open each app's <b>Insights / Analytics</b> and log followers, views and engagement (likes + comments + shares + saves) for the last 7 days. Saving the same date and platform again replaces that entry.</div>
      ${tiles.length ? html`<div class="grid g4 section">${tiles}</div>` : ''}
      <div class="card section"><div class="card-head"><h2>Followers over time</h2>
        <div class="legend">${Object.keys(series).map((p) => html`<span><i style="background:${PLATFORMS[p].color}"></i>${PLATFORMS[p].label}</span>`)}</div></div>
        <div id="chartSlot"></div></div>
      <div class="card section"><h2>All entries</h2>${rows.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Platform</th><th class="num">Followers</th><th class="num">Views</th><th class="num hide-sm">Engagement</th><th class="num">Eng. rate</th><th class="num hide-sm">Posts</th><th class="hide-sm">Notes</th><th></th></tr></thead>
        <tbody>${rows.map((r) => html`<tr class="clickable" data-action="edit-metric" data-id="${r.id}">
          <td style="white-space:nowrap">${fmtDate(r.date)}</td><td>${platformChips(r.platform)}</td>
          <td class="num">${num(r.followers)}</td><td class="num">${num(r.views)}</td><td class="num hide-sm">${num(r.engagement)}</td>
          <td class="num">${rate(r)}</td><td class="num hide-sm">${num(r.posts)}</td><td class="small hide-sm">${r.notes || ''}</td>
          <td class="num"><button class="btn link sm" data-action="metric-delete" data-id="${r.id}" aria-label="Delete entry">✕</button></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">No numbers logged yet.</div>`}</div>
      <div class="card section"><h2>Top posts</h2>${metricsCache.topPosts.length ? html`<div class="table-wrap"><table>
        <thead><tr><th>Post</th><th class="num">Views</th><th class="num">Likes</th><th class="num hide-sm">Comments</th><th class="num hide-sm">Shares</th></tr></thead>
        <tbody>${metricsCache.topPosts.map((p) => html`<tr class="clickable" data-action="post-detail" data-id="${p.id}">
          <td><b>${p.title}</b><div class="small">${platformChips(p.platforms)}${p.posted_at ? ' · ' + fmtWhen(p.posted_at) : ''}</div></td>
          <td class="num">${num(p.views)}</td><td class="num">${num(p.likes)}</td><td class="num hide-sm">${num(p.comments)}</td><td class="num hide-sm">${num(p.shares)}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">Once posts go live, use <b>Update results</b> on each one to see what's working.</div>`}</div>`;
  }

  // Line chart of followers per platform. One y-axis, 2px lines, 8px markers with a surface ring,
  // direct end labels, and a crosshair tooltip (attachChartHover). The entries table is the table view.
  let chartSeries = null;
  function niceStep(range) {
    const raw = range / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw);
  }
  function drawChart() {
    const slot = $('#chartSlot');
    if (!slot || !chartSeries) return;
    slot.innerHTML = followersChart(chartSeries, slot.clientWidth).s;
    attachChartHover();
  }
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawChart, 150); });

  // Drawn at the container's real pixel width so text stays 11-12px on any screen.
  function followersChart(series, width) {
    const entries = Object.entries(series);
    if (!entries.length) return html`<div class="empty">Log numbers on two or more dates to see growth.</div>`;
    const W = Math.max(280, Math.round(width || 680));
    const H = W < 500 ? 220 : 260, L = 44, R = W < 500 ? 84 : 118, T = 12, B = 28;
    const t = (d) => new Date(d + 'T00:00').getTime();
    const all = entries.flatMap(([, s]) => s);
    let x0 = Math.min(...all.map((r) => t(r.date)));
    let x1 = Math.max(...all.map((r) => t(r.date)));
    if (x0 === x1) { x0 -= 3 * 864e5; x1 += 3 * 864e5; }
    const lo = Math.min(...all.map((r) => r.followers));
    const hi = Math.max(...all.map((r) => r.followers));
    const step = niceStep(Math.max(hi - lo, 4));
    let y0 = Math.max(0, Math.floor(lo / step) * step);
    let y1 = Math.ceil(hi / step) * step;
    if (y1 === y0) y1 = y0 + step;
    const X = (d) => L + ((t(d) - x0) / (x1 - x0)) * (W - L - R);
    const Y = (n) => T + (1 - (n - y0) / (y1 - y0)) * (H - T - B);
    const ticks = [];
    for (let v = y0; v <= y1 + 1e-9; v += step) ticks.push(v);
    const dates = [...new Set(all.map((r) => r.date))].sort();
    const xLabels = dates.length > 2 ? [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]] : dates;
    // End labels, nudged apart so they never overlap.
    const ends = entries.map(([p, s]) => ({ p, y: Y(s[s.length - 1].followers), x: X(s[s.length - 1].date), v: s[s.length - 1].followers }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    const data = { L, R, W, T, B, H, dates: dates.map((d) => ({ d, x: X(d) })), series: entries.map(([p, s]) => ({ p, pts: s.map((r) => ({ d: r.date, v: r.followers, y: Y(r.followers) })) })) };
    return html`<div class="chart" data-chart="${JSON.stringify(data)}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Followers over time by platform">
        ${ticks.map((v) => html`<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid-line"></line><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="axis">${compact.format(v)}</text>`)}
        ${xLabels.map((d) => html`<text x="${X(d)}" y="${H - 8}" text-anchor="middle" class="axis">${shortDate(d)}</text>`)}
        ${entries.map(([p, s]) => html`<polyline fill="none" stroke="${PLATFORMS[p].color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${s.map((r) => `${X(r.date)},${Y(r.followers)}`).join(' ')}"></polyline>
          ${s.map((r) => html`<circle cx="${X(r.date)}" cy="${Y(r.followers)}" r="4" fill="${PLATFORMS[p].color}" class="dot"></circle>`)}`)}
        ${ends.map((e) => html`<text x="${e.x + 10}" y="${e.y + 4}" class="end-label">${W < 500 ? '' : PLATFORMS[e.p].label + ' '}${compact.format(e.v)}</text>`)}
        <line class="xhair" y1="${T}" y2="${H - B}" x1="0" x2="0" hidden></line>
        <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"></rect>
      </svg>
      <div class="tip" hidden></div>
    </div>`;
  }

  function attachChartHover() {
    const box = $('.chart');
    if (!box) return;
    const data = JSON.parse(box.dataset.chart);
    const svg = $('svg', box);
    const line = $('.xhair', box);
    const tip = $('.tip', box);
    const hide = () => { line.hidden = true; tip.hidden = true; };
    const show = (e) => {
      const rect = svg.getBoundingClientRect();
      const vx = ((e.clientX - rect.left) / rect.width) * data.W;
      const near = data.dates.reduce((a, b) => (Math.abs(b.x - vx) < Math.abs(a.x - vx) ? b : a));
      line.setAttribute('x1', near.x);
      line.setAttribute('x2', near.x);
      line.hidden = false;
      tip.innerHTML = html`<b>${fmtDate(near.d)}</b>${data.series.map((s) => {
        const pt = s.pts.find((q) => q.d === near.d);
        return html`<div><i style="background:${PLATFORMS[s.p].color}"></i>${PLATFORMS[s.p].label}: ${pt ? num(pt.v) : '—'}</div>`;
      })}`.s;
      tip.hidden = false;
      const px = (near.x / data.W) * rect.width;
      tip.style.left = Math.min(Math.max(px + 12, 0), rect.width - tip.offsetWidth) + 'px';
      tip.style.top = '8px';
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }

  function metricForm(m = {}) {
    openModal({
      title: m.id ? 'Edit numbers' : 'Log numbers',
      body: html`<div class="form">
        <label class="f"><span>Platform</span><select name="platform">${opts(Object.entries(PLATFORMS).map(([k, pf]) => [k, pf.label]), m.platform || 'instagram')}</select></label>
        <label class="f"><span>Date</span><input name="date" type="date" value="${m.date || todayStr()}" required></label>
        <label class="f"><span>Followers (total)</span><input name="followers" type="number" min="0" step="1" value="${m.followers ?? ''}"></label>
        <label class="f"><span>Views (last 7 days)</span><input name="views" type="number" min="0" step="1" value="${m.views ?? ''}"></label>
        <label class="f"><span>Engagement (last 7 days)</span><input name="engagement" type="number" min="0" step="1" value="${m.engagement ?? ''}" placeholder="likes + comments + shares + saves"></label>
        <label class="f"><span>Posts (last 7 days)</span><input name="posts" type="number" min="0" step="1" value="${m.posts ?? ''}"></label>
        <label class="f full"><span>Notes</span><input name="notes" value="${m.notes || ''}" placeholder="e.g. Rain teaser went viral"></label>
      </div>`,
      onSubmit: async (d) => {
        await api('/api/social/metrics', { method: 'POST', body: d });
        toast('Numbers saved');
      },
    });
  }

  // ---------------------------------------------------------------- messages
  const msgState = { convId: null, lastId: 0, lastDay: null, busy: false, tick: 0 };

  const convListHtml = (convs, activeId) => convs.map((c) => html`<a class="conv ${c.id === activeId ? 'on' : ''}" href="#/messages/${c.id}">
    <span class="grow"><b>${c.kind === 'channel' ? '# ' + c.name : c.name}</b><span class="small">${c.last_body ? c.last_body.slice(0, 60) : c.kind === 'channel' ? 'Whole team' : 'No messages yet'}</span></span>
    ${c.unread && c.id !== activeId ? html`<span class="nav-count">${c.unread}</span>` : ''}</a>`);

  async function pageMessages(el) {
    const [{ conversations }, { people }] = await Promise.all([api('/api/conversations'), api('/api/team')]);
    let convId = Number(subPage()) || null;
    if (!convId && window.innerWidth > 760) convId = conversations[0]?.id || null;
    const conv = conversations.find((c) => c.id === convId);
    Object.assign(msgState, { convId: conv ? conv.id : null, lastId: 0, lastDay: null });
    const hasDm = new Set(conversations.filter((c) => c.kind === 'dm').map((c) => c.other_user_id));
    const newPeople = people.filter((p) => !hasDm.has(p.id));
    el.innerHTML = html`
      <div class="top"><div><div class="eyebrow">Messages</div><div class="title">Team chat.</div></div></div>
      <div class="msgs ${conv ? 'has-conv' : ''}">
        <div class="card conv-list">
          <div id="convList">${convListHtml(conversations, msgState.convId)}</div>
          ${newPeople.length ? html`<div class="eyebrow" style="margin:16px 0 6px">Start a private chat</div>
            ${newPeople.map((p) => html`<button class="conv" data-action="open-dm" data-id="${p.id}"><span class="grow"><b>${p.name}</b><span class="small">${state.roles[p.role]?.label || p.role}</span></span></button>`)}` : ''}
        </div>
        <div class="card thread-card">${conv ? html`
          <div class="thread-head"><a href="#/messages" class="btn link sm back">‹ All chats</a>
            <h2>${conv.kind === 'channel' ? '# ' + conv.name : conv.name}</h2>
            <div class="small">${conv.kind === 'channel' ? 'Everyone on the team can see this' : 'Private: only the two of you can see this'}</div></div>
          <div class="msg-scroll" id="msgScroll"></div>
          <div class="composer"><textarea id="msgInput" rows="2" placeholder="Message ${conv.kind === 'channel' ? 'the team' : conv.name}…"></textarea>
            <button class="btn primary" data-action="send-msg">Send</button></div>
          <div class="small composer-hint hide-sm">Enter to send · Shift+Enter for a new line</div>`
          : html`<div class="empty">Pick a conversation</div>`}</div>
      </div>`.s;
    if (conv) {
      await pollMessages();
      $('#msgInput')?.focus();
    }
    updateBadges();
  }

  function msgHtml(m) {
    const day = fmtDate(iso(new Date(m.created_at.replace(' ', 'T') + 'Z')));
    const mine = m.user_id === state.user.id;
    const sep = day !== msgState.lastDay ? html`<div class="day-sep"><span>${day}</span></div>` : '';
    msgState.lastDay = day;
    return html`${sep}<div class="bubble ${mine ? 'me' : ''}"><div class="who">${mine ? 'You' : m.user_name || 'Former teammate'} · ${fmtStamp(m.created_at).split(', ').pop()}</div><div class="text">${m.body}</div></div>`.s;
  }

  async function pollMessages() {
    const id = msgState.convId;
    if (!id || msgState.busy) return;
    msgState.busy = true;
    try {
      const { messages } = await api(`/api/conversations/${id}/messages?after=${msgState.lastId}`);
      const box = $('#msgScroll');
      if (id !== msgState.convId || !box) return;
      if (!messages.length) {
        if (!msgState.lastId && !box.children.length) box.innerHTML = html`<div class="empty">No messages yet. Say hi!</div>`.s;
        return;
      }
      if (!msgState.lastId) box.innerHTML = '';
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80 || !msgState.lastId;
      box.insertAdjacentHTML('beforeend', messages.map(msgHtml).join(''));
      msgState.lastId = messages[messages.length - 1].id;
      if (nearBottom) box.scrollTop = box.scrollHeight;
    } finally {
      msgState.busy = false;
    }
  }

  async function refreshConvList() {
    const list = $('#convList');
    if (!list) return;
    const { conversations } = await api('/api/conversations');
    list.innerHTML = convListHtml(conversations, msgState.convId).map(part).join('');
  }

  async function updateBadges() {
    if (!state.user) return;
    try {
      const u = await api('/api/conversations/unread');
      for (const [key, n] of [['messages', u.messages], ['social', u.review]]) {
        $$(`[data-badge="${key}"]`).forEach((b) => { b.textContent = n; b.hidden = !n; });
      }
      document.title = u.messages ? `(${u.messages}) Team Twurt` : 'Team Twurt';
      showDmPopups(u.dms || []);
    } catch { /* offline */ }
  }

  // ---- Direct message pop-ups
  // One card per conversation with unread DMs. A DM pops up once (remembered per
  // browser), and its card goes away once the conversation has been read.
  const seenKey = () => `tt_seen_dm_${state.user.id}`;
  function seenDm(id) {
    try {
      if (id !== undefined) localStorage.setItem(seenKey(), String(id));
      return Number(localStorage.getItem(seenKey()) || 0);
    } catch { return id || 0; }
  }

  function showDmPopups(dms) {
    const box = $('#popups');
    const viewing = currentPage() === 'messages' ? msgState.convId : null;
    const unreadConvs = new Set(dms.map((m) => m.conversation_id));
    // Remove cards for conversations that have since been read.
    $$('.popup', box).forEach((el) => { if (!unreadConvs.has(Number(el.dataset.conv))) el.remove(); });
    const seen = seenDm();
    const fresh = dms.filter((m) => m.id > seen && m.conversation_id !== viewing);
    if (dms.length) seenDm(Math.max(seen, ...dms.map((m) => m.id)));
    for (const convId of new Set(fresh.map((m) => m.conversation_id))) {
      const all = dms.filter((m) => m.conversation_id === convId);
      const last = all[all.length - 1];
      $(`.popup[data-conv="${convId}"]`, box)?.remove();
      box.insertAdjacentHTML('beforeend', html`
        <div class="popup" role="alert" data-conv="${convId}">
          <div class="popup-head"><b>${last.sender || 'Teammate'}</b><span class="small"> sent you a message</span>
            <button class="btn link sm" data-action="popup-close" data-conv="${convId}" aria-label="Dismiss">✕</button></div>
          <div class="popup-body">${last.body.length > 160 ? last.body.slice(0, 160) + '…' : last.body}</div>
          ${all.length > 1 ? html`<div class="small">+${all.length - 1} more</div>` : ''}
          <div class="popup-actions"><button class="btn primary sm" data-action="popup-open" data-conv="${convId}">Reply</button></div>
        </div>`.s);
    }
  }

  // Live updates: new messages every 5s while chatting, badges and pop-ups every 10s.
  setInterval(() => {
    if (!state.user || document.hidden) return;
    msgState.tick++;
    if (currentPage() === 'messages') {
      pollMessages().catch(() => {});
      if (msgState.tick % 3 === 0) refreshConvList().catch(() => {});
    }
    if (msgState.tick % 2 === 0) updateBadges();
  }, 5000);

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
          <div class="hint" style="margin-top:12px">Owners see everything. A <b>Social media manager</b> only sees Social and Messages. Direct messages are private to the two people in them.</div>
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
    'logout': async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      state.user = null;
      state.shows = null;
      $('#popups').innerHTML = '';
      document.title = 'Team Twurt';
      render();
    },
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
    'new-post': (d) => postForm({}, { campaign_id: d.campaign }),
    'new-post-on': (d) => postForm({}, { planned_at: d.date + 'T12:00' }),
    'post-detail': (d) => postDetail(d.id),
    'edit-post': () => postForm(state.post.post),
    'post-results': () => resultsForm(state.post.post),
    'post-status': async (d) => {
      const p = state.post.post;
      const body = { status: d.status };
      if (d.status === 'changes_requested') {
        body.note = prompt('What should change?');
        if (!body.note) return;
      } else if (d.status === 'posted') {
        const link = prompt('Link to the live post (optional):', p.post_url || '');
        if (link === null) return;
        body.post_url = link;
      } else if (d.status === 'approved') {
        const note = prompt('Approve this post. Add a note (optional):', '');
        if (note === null) return;
        body.note = note;
      }
      await api(`/api/social/posts/${p.id}/status`, { method: 'POST', body });
      toast({ in_review: 'Sent for review', approved: 'Approved', changes_requested: 'Changes requested', scheduled: 'Marked scheduled', posted: 'Marked posted', draft: 'Withdrawn' }[d.status]);
      await postDetail(p.id);
      refresh();
      updateBadges();
    },
    'post-comment': async () => {
      const input = $('#commentInput');
      if (!input.value.trim()) return;
      await api(`/api/social/posts/${state.post.post.id}/comments`, { method: 'POST', body: { body: input.value } });
      await postDetail(state.post.post.id);
      $('.thread')?.lastElementChild?.scrollIntoView({ block: 'nearest' });
    },
    'media-delete': async (d) => {
      if (!confirm('Remove this file?')) return;
      await api(`/api/social/media/${d.id}`, { method: 'DELETE' });
      await postDetail(state.post.post.id);
      refresh();
    },
    'popup-close': (d) => { $(`.popup[data-conv="${d.conv}"]`)?.remove(); },
    'popup-open': (d) => {
      $(`.popup[data-conv="${d.conv}"]`)?.remove();
      location.hash = '#/messages/' + d.conv;
    },
    'new-campaign': () => campaignForm(),
    'edit-campaign': (d) => campaignForm(campaignsCache.find((c) => String(c.id) === d.id)),
    'log-metric': () => metricForm(),
    'edit-metric': (d) => metricForm(metricsCache.metrics.find((m) => String(m.id) === d.id)),
    'metric-delete': async (d) => {
      if (!confirm('Delete this entry?')) return;
      await api(`/api/social/metrics/${d.id}`, { method: 'DELETE' });
      refresh();
    },
    'open-dm': async (d) => {
      const { id } = await api('/api/conversations/dm', { method: 'POST', body: { user_id: Number(d.id) } });
      location.hash = '#/messages/' + id;
    },
    'send-msg': async () => {
      const input = $('#msgInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        await api(`/api/conversations/${msgState.convId}/messages`, { method: 'POST', body: { body: text } });
      } catch (err) {
        input.value = text;
        throw err;
      }
      await pollMessages();
      refreshConvList().catch(() => {});
    },
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
    'post-upload': async (el) => {
      const files = [...el.files];
      if (!files.length) return;
      try {
        await uploadFiles(state.post.post.id, files);
        toast('Uploaded');
      } catch (err) { toast(err.message, true); }
      await postDetail(state.post.post.id);
      refresh();
    },
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
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'msgInput' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      actions['send-msg']().catch((err) => toast(err.message, true));
    }
  });
  window.addEventListener('hashchange', () => { closeModal(); render(); });

  // ---------------------------------------------------------------- boot
  api('/api/auth/status')
    .then((s) => {
      state.user = s.user;
      state.needsSetup = s.needsSetup;
      state.roles = s.roles;
      state.features = s.features || {};
      render();
    })
    .catch((err) => {
      $('#root').innerHTML = html`<div class="login"><div class="login-card"><div class="error">Couldn't reach the server: ${err.message}</div></div></div>`.s;
    });
})();
