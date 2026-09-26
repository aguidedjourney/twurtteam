import { HttpError, json, readBody, v } from './http.js';
import { hashPassword, verifyPassword, randomToken, sha256, safeEqual } from './crypto.js';
import { ROLES } from './permissions.js';

const COOKIE = 'tt_session';
const SESSION_DAYS = 30;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MIN_PASSWORD = 10;

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function publicUser(u) {
  return u && { id: u.id, email: u.email, name: u.name, role: u.role };
}

export function validatePassword(password, name = 'Password') {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new HttpError(400, `${name} must be at least ${MIN_PASSWORD} characters`);
  }
  if (password.length > 200) throw new HttpError(400, `${name} is too long`);
  return password;
}

export async function currentUser(env, request) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND u.active = 1`
  ).bind(await sha256(token)).first();
  return row || null;
}

async function startSession(env, userId) {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`),
    env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
      .bind(await sha256(token), userId, `+${SESSION_DAYS} days`),
  ]);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function userCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return row.n;
}

export async function status({ env, request }) {
  const [count, user] = await Promise.all([userCount(env), currentUser(env, request)]);
  return json({ needsSetup: count === 0, user: publicUser(user), roles: ROLES });
}

// One-time creation of the first owner account. Requires the SETUP_KEY secret.
export async function setup({ env, request }) {
  if ((await userCount(env)) > 0) throw new HttpError(403, 'Setup has already been completed');
  if (!env.SETUP_KEY) throw new HttpError(500, 'SETUP_KEY is not configured on the server');
  const body = await readBody(request);
  if (!(await safeEqual(body.setupKey || '', env.SETUP_KEY))) throw new HttpError(403, 'Setup key is incorrect');
  const name = v.str(body.name, 'Name', { required: true, max: 80 });
  const email = v.str(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
  const password = validatePassword(body.password);
  const hash = await hashPassword(password);
  const res = await env.DB.prepare(
    `INSERT INTO users (email, name, role, password_hash) SELECT ?, ?, 'owner', ? WHERE NOT EXISTS (SELECT 1 FROM users)`
  ).bind(email, name, hash).run();
  if (!res.meta.changes) throw new HttpError(403, 'Setup has already been completed');
  const cookie = await startSession(env, res.meta.last_row_id);
  return json({ user: { id: res.meta.last_row_id, email, name, role: 'owner' } }, 200, { 'set-cookie': cookie });
}

export async function login({ env, request }) {
  const body = await readBody(request);
  const email = v.str(body.email, 'Email', { required: true, max: 200 }).toLowerCase();
  const password = String(body.password || '');
  const user = await env.DB.prepare(
    `SELECT *, (locked_until IS NOT NULL AND locked_until > datetime('now')) AS locked FROM users WHERE email = ? AND active = 1`
  ).bind(email).first();

  if (!user) {
    await hashPassword(password); // similar timing whether or not the account exists
    throw new HttpError(401, 'Email or password is incorrect');
  }
  if (user.locked) throw new HttpError(429, `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`);

  if (!(await verifyPassword(password, user.password_hash))) {
    const fails = user.failed_logins + 1;
    if (fails >= MAX_FAILED_LOGINS) {
      await env.DB.prepare(`UPDATE users SET failed_logins = 0, locked_until = datetime('now', ?) WHERE id = ?`)
        .bind(`+${LOCK_MINUTES} minutes`, user.id).run();
    } else {
      await env.DB.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').bind(fails, user.id).run();
    }
    throw new HttpError(401, 'Email or password is incorrect');
  }

  await env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();
  const cookie = await startSession(env, user.id);
  return json({ user: publicUser(user) }, 200, { 'set-cookie': cookie });
}

export async function logout({ env, request }) {
  const token = readCookie(request, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

export async function changePassword({ env, request, user }) {
  const body = await readBody(request);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  if (!(await verifyPassword(String(body.current || ''), row.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  const hash = await hashPassword(validatePassword(body.password, 'New password'));
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  const cookie = await startSession(env, user.id);
  return json({ ok: true }, 200, { 'set-cookie': cookie });
}
