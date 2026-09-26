import { HttpError, json, readBody, v, today } from '../http.js';

// Reasons that take stock out are entered as positive quantities and stored negative.
const OUT = ['sale', 'giveaway', 'damaged'];
const REASONS = [...OUT, 'restock', 'correction'];

export async function list({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT i.*, COALESCE((SELECT SUM(-change) FROM merch_movements m WHERE m.item_id = i.id AND m.reason = 'sale'), 0) AS units_sold
     FROM merch_items i ORDER BY i.active DESC, i.name, i.variant`
  ).all();
  return json({ items: results });
}

function clean(body) {
  return {
    name: v.str(body.name, 'Item name', { required: true, max: 120 }),
    variant: v.str(body.variant, 'Variant', { max: 60 }),
    sku: v.str(body.sku, 'SKU', { max: 60 }),
    unit_cost_cents: v.money(body.unit_cost, 'Unit cost', { required: false }) ?? 0,
    price_cents: v.money(body.price, 'Price', { required: false }) ?? 0,
    low_stock: v.int(body.low_stock, 'Low-stock alert', { min: 0, max: 100000 }) ?? 5,
    notes: v.str(body.notes, 'Notes', { max: 2000 }),
    active: body.active === undefined ? 1 : v.bool(body.active) ? 1 : 0,
  };
}

export async function create({ env, request, user }) {
  const body = await readBody(request);
  const m = clean(body);
  const qty = v.int(body.quantity, 'Starting quantity', { min: 0, max: 1000000 }) ?? 0;
  const res = await env.DB.prepare(
    `INSERT INTO merch_items (name, variant, sku, unit_cost_cents, price_cents, quantity, low_stock, notes, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(m.name, m.variant, m.sku, m.unit_cost_cents, m.price_cents, qty, m.low_stock, m.notes, m.active).run();
  const id = res.meta.last_row_id;
  if (qty > 0) {
    await env.DB.prepare(
      `INSERT INTO merch_movements (item_id, date, change, reason, note, created_by) VALUES (?, ?, ?, 'initial', 'Starting stock', ?)`
    ).bind(id, today(), qty, user.id).run();
  }
  return json({ id }, 201);
}

// Quantity is only changed through stock adjustments so history stays accurate.
export async function update({ env, request, params }) {
  const id = v.id(params.id, 'Item');
  const m = clean(await readBody(request));
  const res = await env.DB.prepare(
    `UPDATE merch_items SET name = ?, variant = ?, sku = ?, unit_cost_cents = ?, price_cents = ?, low_stock = ?, notes = ?, active = ?
     WHERE id = ?`
  ).bind(m.name, m.variant, m.sku, m.unit_cost_cents, m.price_cents, m.low_stock, m.notes, m.active, id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Item not found');
  return json({ ok: true });
}

export async function remove({ env, params }) {
  const id = v.id(params.id, 'Item');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM merch_movements WHERE item_id = ?').bind(id),
    env.DB.prepare('DELETE FROM merch_items WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

export async function movements({ env, params }) {
  const id = v.id(params.id, 'Item');
  const { results } = await env.DB.prepare(
    `SELECT m.*, s.name AS show_name, u.name AS created_by_name FROM merch_movements m
     LEFT JOIN shows s ON s.id = m.show_id LEFT JOIN users u ON u.id = m.created_by
     WHERE m.item_id = ? ORDER BY m.date DESC, m.id DESC`
  ).bind(id).all();
  return json({ movements: results });
}

// Body: { reason, quantity, date, show_id, note, record_money, unit_amount, payment_method }
// For a sale, record_money adds a Merch revenue transaction; for a restock, a Merch inventory expense.
export async function adjust({ env, request, params, user }) {
  const id = v.id(params.id, 'Item');
  const item = await env.DB.prepare('SELECT * FROM merch_items WHERE id = ?').bind(id).first();
  if (!item) throw new HttpError(404, 'Item not found');
  const body = await readBody(request);

  const reason = v.oneOf(body.reason, 'Reason', REASONS);
  let change = v.int(body.quantity, 'Quantity', { required: true, min: -1000000, max: 1000000 });
  if (reason !== 'correction') {
    if (change <= 0) throw new HttpError(400, 'Quantity must be more than zero');
    if (OUT.includes(reason)) change = -change;
  } else if (change === 0) {
    throw new HttpError(400, 'Quantity cannot be zero');
  }
  if (item.quantity + change < 0) {
    throw new HttpError(400, `Only ${item.quantity} in stock`);
  }

  const date = v.date(body.date, 'Date') || today();
  const show_id = v.id(body.show_id, 'Show');
  if (show_id && !(await env.DB.prepare('SELECT 1 FROM shows WHERE id = ?').bind(show_id).first())) {
    throw new HttpError(400, 'That show no longer exists');
  }
  const note = v.str(body.note, 'Note', { max: 500 });
  const label = item.variant ? `${item.name} (${item.variant})` : item.name;
  const units = Math.abs(change);

  const stmts = [];
  let linkTx = false;
  if (v.bool(body.record_money) && (reason === 'sale' || reason === 'restock')) {
    const fallback = reason === 'sale' ? item.price_cents / 100 : item.unit_cost_cents / 100;
    const unit = v.money(body.unit_amount ?? fallback, 'Amount per unit');
    const total = unit * units;
    if (total > 0) {
      const type = reason === 'sale' ? 'revenue' : 'expense';
      const category = reason === 'sale' ? 'Merch sales' : 'Merch (inventory)';
      stmts.push(env.DB.prepare(
        `INSERT INTO transactions (date, type, category, description, amount_cents, show_id, payment_method, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(date, type, category, `${units} × ${label}`, total, show_id, v.str(body.payment_method, 'Payment method', { max: 40 }), user.id));
      linkTx = true;
    }
  }
  stmts.push(env.DB.prepare(
    `INSERT INTO merch_movements (item_id, date, change, reason, show_id, transaction_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ${linkTx ? 'last_insert_rowid()' : 'NULL'}, ?, ?)`
  ).bind(id, date, change, reason, show_id, note, user.id));
  stmts.push(env.DB.prepare('UPDATE merch_items SET quantity = quantity + ? WHERE id = ?').bind(change, id));
  await env.DB.batch(stmts);
  return json({ ok: true, quantity: item.quantity + change });
}
