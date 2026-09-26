import { json, v, today } from '../http.js';
import { withProgress } from './goals.js';

// Dashboard data. ?year=2026&today=2026-09-26 (today comes from the browser so it matches local time).
export async function summary({ env, url }) {
  const now = v.date(url.searchParams.get('today'), 'Today') || today();
  const year = v.int(url.searchParams.get('year'), 'Year', { min: 2000, max: 2100 }) || Number(now.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const monthStart = now.slice(0, 8) + '01';
  const monthEnd = now.slice(0, 8) + '31';

  const sums = `COALESCE(SUM(CASE WHEN type = 'revenue' THEN amount_cents END), 0) AS revenue_cents,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense_cents`;
  const db = env.DB;
  const [year_, month, byMonth, byCategory, recent, upcoming, lowStock, inventory, goals, years] = await Promise.all([
    db.prepare(`SELECT ${sums} FROM transactions WHERE date BETWEEN ? AND ?`).bind(from, to).first(),
    db.prepare(`SELECT ${sums} FROM transactions WHERE date BETWEEN ? AND ?`).bind(monthStart, monthEnd).first(),
    db.prepare(`SELECT CAST(substr(date, 6, 2) AS INTEGER) AS month, ${sums} FROM transactions
                WHERE date BETWEEN ? AND ? GROUP BY month`).bind(from, to).all(),
    db.prepare(`SELECT type, category, SUM(amount_cents) AS amount_cents FROM transactions
                WHERE date BETWEEN ? AND ? GROUP BY type, category ORDER BY amount_cents DESC`).bind(from, to).all(),
    db.prepare(`SELECT t.*, s.name AS show_name FROM transactions t LEFT JOIN shows s ON s.id = t.show_id
                ORDER BY t.date DESC, t.id DESC LIMIT 8`).all(),
    db.prepare(`SELECT * FROM shows WHERE date >= ? AND status = 'booked' ORDER BY date LIMIT 5`).bind(now).all(),
    db.prepare(`SELECT * FROM merch_items WHERE active = 1 AND quantity <= low_stock ORDER BY quantity, name`).all(),
    db.prepare(`SELECT COALESCE(SUM(quantity), 0) AS units, COALESCE(SUM(quantity * unit_cost_cents), 0) AS cost_cents,
                COALESCE(SUM(quantity * price_cents), 0) AS retail_cents FROM merch_items WHERE active = 1`).first(),
    db.prepare(`SELECT * FROM goals WHERE status = 'active' ORDER BY COALESCE(due_date, '9999'), id LIMIT 8`).all(),
    db.prepare(`SELECT DISTINCT substr(date, 1, 4) AS y FROM transactions ORDER BY y DESC`).all(),
  ]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = byMonth.results.find((r) => r.month === i + 1);
    return { month: i + 1, revenue_cents: m?.revenue_cents || 0, expense_cents: m?.expense_cents || 0 };
  });

  return json({
    year,
    years: [...new Set([String(year), now.slice(0, 4), ...years.results.map((r) => r.y)])].sort().reverse(),
    totals: year_,
    month: month,
    months,
    byCategory: byCategory.results,
    recent: recent.results,
    upcomingShows: upcoming.results,
    lowStock: lowStock.results,
    inventory,
    goals: await withProgress(env, goals.results),
  });
}
