import { HttpError, json, readBody, v } from '../http.js';

const STATUSES = ['booked', 'completed', 'cancelled'];

const SELECT = `SELECT s.*,
    COALESCE(SUM(CASE WHEN t.type = 'revenue' THEN t.amount_cents END), 0) AS revenue_cents,
    COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount_cents END), 0) AS expense_cents,
    COUNT(t.id) AS tx_count
  FROM shows s LEFT JOIN transactions t ON t.show_id = s.id`;

export async function list({ env }) {
  const { results } = await env.DB.prepare(`${SELECT} GROUP BY s.id ORDER BY s.date DESC, s.id DESC`).all();
  return json({ shows: results });
}

export async function get({ env, params }) {
  const id = v.id(params.id, 'Show');
  const show = await env.DB.prepare(`${SELECT} WHERE s.id = ? GROUP BY s.id`).bind(id).first();
  if (!show) throw new HttpError(404, 'Show not found');
  const [tx, merch] = await Promise.all([
    env.DB.prepare('SELECT * FROM transactions WHERE show_id = ? ORDER BY date, id').bind(id).all(),
    env.DB.prepare(
      `SELECT m.item_id, i.name, i.variant, SUM(-m.change) AS units
       FROM merch_movements m JOIN merch_items i ON i.id = m.item_id
       WHERE m.show_id = ? AND m.reason = 'sale' GROUP BY m.item_id ORDER BY i.name`
    ).bind(id).all(),
  ]);
  return json({ show, transactions: tx.results, merchSold: merch.results });
}

function clean(body) {
  return {
    date: v.date(body.date, 'Date', { required: true }),
    name: v.str(body.name, 'Venue / event', { required: true, max: 120 }),
    city: v.str(body.city, 'City', { max: 80 }),
    status: v.oneOf(body.status, 'Status', STATUSES, 'booked'),
    notes: v.str(body.notes, 'Notes', { max: 2000 }),
  };
}

export async function create({ env, request }) {
  const s = clean(await readBody(request));
  const res = await env.DB.prepare('INSERT INTO shows (date, name, city, status, notes) VALUES (?, ?, ?, ?, ?)')
    .bind(s.date, s.name, s.city, s.status, s.notes).run();
  return json({ id: res.meta.last_row_id }, 201);
}

export async function update({ env, request, params }) {
  const id = v.id(params.id, 'Show');
  const s = clean(await readBody(request));
  const res = await env.DB.prepare('UPDATE shows SET date = ?, name = ?, city = ?, status = ?, notes = ? WHERE id = ?')
    .bind(s.date, s.name, s.city, s.status, s.notes, id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Show not found');
  return json({ ok: true });
}

// Deleting a show keeps its transactions and merch history, just unlinked.
export async function remove({ env, params }) {
  const id = v.id(params.id, 'Show');
  await env.DB.batch([
    env.DB.prepare('UPDATE transactions SET show_id = NULL WHERE show_id = ?').bind(id),
    env.DB.prepare('UPDATE merch_movements SET show_id = NULL WHERE show_id = ?').bind(id),
    env.DB.prepare('DELETE FROM shows WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}
