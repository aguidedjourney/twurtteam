import { HttpError, json, readBody, v } from '../http.js';

const TYPES = ['revenue', 'expense'];

function filters(url) {
  const q = url.searchParams;
  const where = [];
  const args = [];
  const from = v.date(q.get('from'), 'From');
  const to = v.date(q.get('to'), 'To');
  if (from) { where.push('t.date >= ?'); args.push(from); }
  if (to) { where.push('t.date <= ?'); args.push(to); }
  if (q.get('type')) { where.push('t.type = ?'); args.push(v.oneOf(q.get('type'), 'Type', TYPES)); }
  if (q.get('category')) { where.push('t.category = ?'); args.push(q.get('category')); }
  if (q.get('show_id')) { where.push('t.show_id = ?'); args.push(v.id(q.get('show_id'), 'Show')); }
  if (q.get('q')) {
    where.push("(t.description LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')");
    const like = '%' + q.get('q').replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    args.push(like, like);
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

const SELECT = `SELECT t.*, s.name AS show_name, s.date AS show_date, u.name AS created_by_name
  FROM transactions t
  LEFT JOIN shows s ON s.id = t.show_id
  LEFT JOIN users u ON u.id = t.created_by`;

export async function list({ env, url }) {
  const f = filters(url);
  const [{ results }, totals] = await Promise.all([
    env.DB.prepare(`${SELECT} ${f.sql} ORDER BY t.date DESC, t.id DESC LIMIT 2000`).bind(...f.args).all(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'revenue' THEN amount_cents END), 0) AS revenue_cents,
              COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense_cents,
              COUNT(*) AS count
       FROM transactions t ${f.sql}`
    ).bind(...f.args).first(),
  ]);
  const categories = await env.DB.prepare('SELECT DISTINCT type, category FROM transactions ORDER BY category').all();
  return json({ transactions: results, totals, usedCategories: categories.results });
}

async function clean(env, body) {
  const show_id = v.id(body.show_id, 'Show');
  if (show_id && !(await env.DB.prepare('SELECT 1 FROM shows WHERE id = ?').bind(show_id).first())) {
    throw new HttpError(400, 'That show no longer exists');
  }
  const amount = v.money(body.amount, 'Amount');
  if (amount === 0) throw new HttpError(400, 'Amount must be more than zero');
  return {
    date: v.date(body.date, 'Date', { required: true }),
    type: v.oneOf(body.type, 'Type', TYPES),
    category: v.str(body.category, 'Category', { required: true, max: 60 }),
    description: v.str(body.description, 'Description', { max: 200 }),
    amount_cents: amount,
    show_id,
    payment_method: v.str(body.payment_method, 'Payment method', { max: 40 }),
    notes: v.str(body.notes, 'Notes', { max: 2000 }),
  };
}

export async function create({ env, request, user }) {
  const t = await clean(env, await readBody(request));
  const res = await env.DB.prepare(
    `INSERT INTO transactions (date, type, category, description, amount_cents, show_id, payment_method, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(t.date, t.type, t.category, t.description, t.amount_cents, t.show_id, t.payment_method, t.notes, user.id).run();
  return json({ id: res.meta.last_row_id }, 201);
}

export async function update({ env, request, params }) {
  const id = v.id(params.id, 'Transaction');
  const t = await clean(env, await readBody(request));
  const res = await env.DB.prepare(
    `UPDATE transactions SET date = ?, type = ?, category = ?, description = ?, amount_cents = ?, show_id = ?,
       payment_method = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(t.date, t.type, t.category, t.description, t.amount_cents, t.show_id, t.payment_method, t.notes, id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Transaction not found');
  return json({ ok: true });
}

export async function remove({ env, params }) {
  const id = v.id(params.id, 'Transaction');
  await env.DB.batch([
    env.DB.prepare('UPDATE merch_movements SET transaction_id = NULL WHERE transaction_id = ?').bind(id),
    env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Keep spreadsheets from treating text as a formula (plain numbers are left alone).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function exportCsv({ env, url }) {
  const f = filters(url);
  const { results } = await env.DB.prepare(`${SELECT} ${f.sql} ORDER BY t.date, t.id`).bind(...f.args).all();
  const header = ['Date', 'Type', 'Category', 'Description', 'Amount', 'Signed amount', 'Show', 'Payment method', 'Notes', 'Entered by'];
  const rows = results.map((t) => [
    t.date, t.type, t.category, t.description,
    (t.amount_cents / 100).toFixed(2),
    ((t.type === 'expense' ? -t.amount_cents : t.amount_cents) / 100).toFixed(2),
    t.show_name ? `${t.show_name} (${t.show_date})` : '',
    t.payment_method, t.notes, t.created_by_name,
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="team-twurt-transactions.csv"`,
      'cache-control': 'no-store',
    },
  });
}
