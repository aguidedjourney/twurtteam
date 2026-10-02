import { HttpError, json, readBody, v } from '../http.js';
import { can } from '../permissions.js';

// Team chat ("channel" conversations everyone can see) and direct messages
// (only the two people in them can read them).

const dmKey = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;

function isMember(conv, user) {
  return conv.kind === 'channel' || conv.dm_key.split(':').map(Number).includes(user.id);
}

async function loadConversation(env, id, user) {
  const conv = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  if (!conv || !isMember(conv, user)) throw new HttpError(404, 'Conversation not found');
  return conv;
}

// People you can message: everyone active who can use messaging.
export async function team({ env, user }) {
  const { results } = await env.DB.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name').all();
  return json({ people: results.filter((p) => p.id !== user.id && can(p, 'messages')) });
}

export async function list({ env, user }) {
  const { results } = await env.DB.prepare(
    `SELECT c.*,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
       (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.user_id IS NOT ?
          AND m.id > COALESCE((SELECT last_read_id FROM conversation_reads r WHERE r.conversation_id = c.id AND r.user_id = ?), 0)) AS unread
     FROM conversations c
     WHERE c.kind = 'channel' OR c.dm_key LIKE ? OR c.dm_key LIKE ?
     ORDER BY c.kind = 'dm', COALESCE(last_at, c.created_at) DESC`
  ).bind(user.id, user.id, `${user.id}:%`, `%:${user.id}`).all();
  const convs = results.filter((c) => isMember(c, user));
  const ids = [...new Set(convs.filter((c) => c.kind === 'dm').map((c) => c.dm_key.split(':').map(Number).find((x) => x !== user.id)))];
  const names = ids.length
    ? (await env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results
    : [];
  return json({
    conversations: convs.map((c) => {
      if (c.kind !== 'dm') return c;
      const other = c.dm_key.split(':').map(Number).find((x) => x !== user.id);
      return { ...c, other_user_id: other, name: names.find((n) => n.id === other)?.name || 'Former teammate' };
    }),
  });
}

// Badge counts plus the newest unread direct messages (for pop-ups).
export async function unread({ env, user }) {
  const mine = [`${user.id}:%`, `%:${user.id}`];
  const unreadWhere = `m.user_id IS NOT ?
       AND m.id > COALESCE((SELECT last_read_id FROM conversation_reads r WHERE r.conversation_id = c.id AND r.user_id = ?), 0)`;
  const [counts, dms] = await Promise.all([
    env.DB.prepare(
      `SELECT c.kind, COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE (c.kind = 'channel' OR c.dm_key LIKE ? OR c.dm_key LIKE ?) AND ${unreadWhere} GROUP BY c.kind`
    ).bind(...mine, user.id, user.id).all(),
    env.DB.prepare(
      `SELECT m.id, m.conversation_id, m.body, m.created_at, u.name AS sender
       FROM messages m JOIN conversations c ON c.id = m.conversation_id LEFT JOIN users u ON u.id = m.user_id
       WHERE c.kind = 'dm' AND (c.dm_key LIKE ? OR c.dm_key LIKE ?) AND ${unreadWhere}
       ORDER BY m.id DESC LIMIT 10`
    ).bind(...mine, user.id, user.id).all(),
  ]);
  const n = (kind) => counts.results.find((r) => r.kind === kind)?.n || 0;
  const review = can(user, 'social_approve')
    ? (await env.DB.prepare(`SELECT COUNT(*) AS n FROM social_posts WHERE status = 'in_review'`).first()).n
    : 0;
  return json({ messages: n('channel') + n('dm'), chat: n('channel'), dm: n('dm'), dms: dms.results.reverse(), review });
}

// Opens (or creates) the DM with another person.
export async function openDm({ env, request, user }) {
  const other = v.id((await readBody(request)).user_id, 'Person');
  if (other === user.id) throw new HttpError(400, "You can't message yourself");
  const person = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND active = 1').bind(other).first();
  if (!person || !can(person, 'messages')) throw new HttpError(404, 'Person not found');
  const key = dmKey(user.id, other);
  await env.DB.prepare(`INSERT INTO conversations (kind, dm_key) VALUES ('dm', ?) ON CONFLICT (dm_key) DO NOTHING`).bind(key).run();
  const conv = await env.DB.prepare('SELECT id FROM conversations WHERE dm_key = ?').bind(key).first();
  return json({ id: conv.id });
}

// ?after=ID returns only newer messages (for polling). Reading marks the conversation as read.
export async function messages({ env, params, url, user }) {
  const conv = await loadConversation(env, v.id(params.id, 'Conversation'), user);
  const after = v.int(url.searchParams.get('after'), 'After', { min: 0 }) || 0;
  const { results } = await env.DB.prepare(
    `SELECT * FROM (SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id DESC LIMIT 300) ORDER BY id`
  ).bind(conv.id, after).all();
  if (results.length) {
    await env.DB.prepare(
      `INSERT INTO conversation_reads (user_id, conversation_id, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT (user_id, conversation_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`
    ).bind(user.id, conv.id, results[results.length - 1].id).run();
  }
  return json({ messages: results });
}

export async function send({ env, request, params, user }) {
  const conv = await loadConversation(env, v.id(params.id, 'Conversation'), user);
  const body = v.str((await readBody(request)).body, 'Message', { required: true, max: 4000 });
  const res = await env.DB.prepare('INSERT INTO messages (conversation_id, user_id, body) VALUES (?, ?, ?)')
    .bind(conv.id, user.id, body).run();
  await env.DB.prepare(
    `INSERT INTO conversation_reads (user_id, conversation_id, last_read_id) VALUES (?, ?, ?)
     ON CONFLICT (user_id, conversation_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`
  ).bind(user.id, conv.id, res.meta.last_row_id).run();
  return json({ id: res.meta.last_row_id }, 201);
}
