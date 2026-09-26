import { HttpError, json, readBody, v } from '../http.js';

const KINDS = ['financial', 'project'];
const METRICS = ['revenue', 'expenses', 'net', 'manual'];
const STATUSES = ['active', 'achieved', 'paused', 'dropped'];

// Adds `progress` to each goal:
//   financial revenue/net  -> money earned in the goal's date range vs. target
//   financial expenses     -> money spent vs. a spending cap (budget)
//   financial manual       -> current_cents vs. target (e.g. savings reserve)
//   project                -> milestones done vs. total
export async function withProgress(env, goals) {
  if (!goals.length) return goals;
  const ids = goals.map((g) => g.id);
  const { results: milestones } = await env.DB.prepare(
    `SELECT * FROM goal_milestones WHERE goal_id IN (${ids.map(() => '?').join(',')}) ORDER BY done, COALESCE(due_date, '9999'), id`
  ).bind(...ids).all();

  return Promise.all(goals.map(async (g) => {
    const ms = milestones.filter((m) => m.goal_id === g.id);
    let current = null;
    let pct;
    if (g.kind === 'project') {
      const done = ms.filter((m) => m.done).length;
      pct = ms.length ? done / ms.length : g.status === 'achieved' ? 1 : 0;
    } else {
      if (g.metric === 'manual') {
        current = g.current_cents || 0;
      } else {
        const where = ['1 = 1'];
        const args = [];
        if (g.start_date) { where.push('date >= ?'); args.push(g.start_date); }
        if (g.due_date) { where.push('date <= ?'); args.push(g.due_date); }
        if (g.category && g.metric !== 'net') { where.push('category = ?'); args.push(g.category); }
        const row = await env.DB.prepare(
          `SELECT COALESCE(SUM(CASE WHEN type = 'revenue' THEN amount_cents END), 0) AS rev,
                  COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS exp
           FROM transactions WHERE ${where.join(' AND ')}`
        ).bind(...args).first();
        current = g.metric === 'revenue' ? row.rev : g.metric === 'expenses' ? row.exp : row.rev - row.exp;
      }
      pct = g.target_cents > 0 ? current / g.target_cents : 0;
    }
    return { ...g, milestones: ms, current_cents: current ?? g.current_cents, progress: Math.max(0, pct) };
  }));
}

export async function list({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM goals ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'achieved' THEN 2 ELSE 3 END,
       COALESCE(due_date, '9999'), id`
  ).all();
  return json({ goals: await withProgress(env, results) });
}

function clean(body) {
  const kind = v.oneOf(body.kind, 'Kind', KINDS);
  const g = {
    title: v.str(body.title, 'Goal', { required: true, max: 160 }),
    kind,
    metric: null,
    category: null,
    target_cents: null,
    current_cents: null,
    start_date: v.date(body.start_date, 'Start date'),
    due_date: v.date(body.due_date, 'Due date'),
    status: v.oneOf(body.status, 'Status', STATUSES, 'active'),
    owner: v.str(body.owner, 'Owner', { max: 80 }),
    notes: v.str(body.notes, 'Notes', { max: 4000 }),
  };
  if (g.start_date && g.due_date && g.start_date > g.due_date) throw new HttpError(400, 'Start date must be before the due date');
  if (kind === 'financial') {
    g.metric = v.oneOf(body.metric, 'Measure', METRICS, 'manual');
    g.category = g.metric === 'revenue' || g.metric === 'expenses' ? v.str(body.category, 'Category', { max: 60 }) : null;
    g.target_cents = v.money(body.target, 'Target amount');
    if (g.target_cents <= 0) throw new HttpError(400, 'Target amount must be more than zero');
    if (g.metric === 'manual') g.current_cents = v.money(body.current, 'Current amount', { required: false }) ?? 0;
  }
  return g;
}

const COLS = ['title', 'kind', 'metric', 'category', 'target_cents', 'current_cents', 'start_date', 'due_date', 'status', 'owner', 'notes'];

export async function create({ env, request }) {
  const body = await readBody(request);
  const g = clean(body);
  const res = await env.DB.prepare(
    `INSERT INTO goals (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`
  ).bind(...COLS.map((c) => g[c])).run();
  const id = res.meta.last_row_id;
  // Optional starting milestones for project goals: ["Book studio", "Shoot video"]
  if (g.kind === 'project' && Array.isArray(body.milestones)) {
    const titles = body.milestones.map((t) => v.str(t, 'Milestone', { max: 160 })).filter(Boolean).slice(0, 50);
    if (titles.length) {
      await env.DB.batch(titles.map((t) => env.DB.prepare('INSERT INTO goal_milestones (goal_id, title) VALUES (?, ?)').bind(id, t)));
    }
  }
  return json({ id }, 201);
}

export async function update({ env, request, params }) {
  const id = v.id(params.id, 'Goal');
  const g = clean(await readBody(request));
  const res = await env.DB.prepare(
    `UPDATE goals SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`
  ).bind(...COLS.map((c) => g[c]), id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Goal not found');
  return json({ ok: true });
}

export async function remove({ env, params }) {
  const id = v.id(params.id, 'Goal');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM goal_milestones WHERE goal_id = ?').bind(id),
    env.DB.prepare('DELETE FROM goals WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

export async function addMilestone({ env, request, params }) {
  const goalId = v.id(params.id, 'Goal');
  if (!(await env.DB.prepare('SELECT 1 FROM goals WHERE id = ?').bind(goalId).first())) throw new HttpError(404, 'Goal not found');
  const body = await readBody(request);
  const res = await env.DB.prepare('INSERT INTO goal_milestones (goal_id, title, due_date) VALUES (?, ?, ?)')
    .bind(goalId, v.str(body.title, 'Milestone', { required: true, max: 160 }), v.date(body.due_date, 'Due date')).run();
  return json({ id: res.meta.last_row_id }, 201);
}

export async function updateMilestone({ env, request, params }) {
  const id = v.id(params.id, 'Milestone');
  const m = await env.DB.prepare('SELECT * FROM goal_milestones WHERE id = ?').bind(id).first();
  if (!m) throw new HttpError(404, 'Milestone not found');
  const body = await readBody(request);
  const title = body.title !== undefined ? v.str(body.title, 'Milestone', { required: true, max: 160 }) : m.title;
  const due = body.due_date !== undefined ? v.date(body.due_date, 'Due date') : m.due_date;
  const done = body.done !== undefined ? (v.bool(body.done) ? 1 : 0) : m.done;
  await env.DB.prepare('UPDATE goal_milestones SET title = ?, due_date = ?, done = ? WHERE id = ?').bind(title, due, done, id).run();
  return json({ ok: true });
}

export async function removeMilestone({ env, params }) {
  await env.DB.prepare('DELETE FROM goal_milestones WHERE id = ?').bind(v.id(params.id, 'Milestone')).run();
  return json({ ok: true });
}
