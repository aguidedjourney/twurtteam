import { HttpError, json, readBody, v } from '../http.js';
import { hashPassword } from '../crypto.js';
import { validatePassword } from '../auth.js';
import { ROLES } from '../permissions.js';

const roleNames = () => Object.keys(ROLES);

export async function list({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, email, name, role, active, created_at FROM users ORDER BY active DESC, name'
  ).all();
  return json({ users: results, roles: ROLES });
}

export async function create({ env, request }) {
  const body = await readBody(request);
  const name = v.str(body.name, 'Name', { required: true, max: 80 });
  const email = v.str(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
  const role = v.oneOf(body.role, 'Role', roleNames());
  const hash = await hashPassword(validatePassword(body.password, 'Temporary password'));
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) throw new HttpError(409, 'A user with that email already exists');
  const res = await env.DB.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)')
    .bind(email, name, role, hash).run();
  return json({ id: res.meta.last_row_id }, 201);
}

export async function update({ env, request, params, user }) {
  const id = v.id(params.id, 'User');
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) throw new HttpError(404, 'User not found');
  const body = await readBody(request);

  const name = body.name !== undefined ? v.str(body.name, 'Name', { required: true, max: 80 }) : target.name;
  const role = body.role !== undefined ? v.oneOf(body.role, 'Role', roleNames()) : target.role;
  const active = body.active !== undefined ? (v.bool(body.active) ? 1 : 0) : target.active;

  if (id === user.id && (role !== 'owner' || !active)) {
    throw new HttpError(400, "You can't remove your own owner access");
  }

  const stmts = [env.DB.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').bind(name, role, active, id)];
  if (body.password) {
    const hash = await hashPassword(validatePassword(body.password, 'New password'));
    stmts.push(env.DB.prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').bind(hash, id));
  }
  if (body.password || !active || role !== target.role) {
    stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}
