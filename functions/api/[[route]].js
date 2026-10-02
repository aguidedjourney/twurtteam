// Single entry point for /api/*. Each route declares which "area" it belongs
// to; see src/permissions.js for which roles can use which areas.

import { HttpError, json } from '../../src/http.js';
import { can } from '../../src/permissions.js';
import { ensureSchema } from '../../src/migrate.js';
import * as auth from '../../src/auth.js';
import * as users from '../../src/routes/users.js';
import * as tx from '../../src/routes/transactions.js';
import * as shows from '../../src/routes/shows.js';
import * as merch from '../../src/routes/merch.js';
import * as goals from '../../src/routes/goals.js';
import { summary } from '../../src/routes/summary.js';
import * as social from '../../src/routes/social.js';
import * as msg from '../../src/routes/messages.js';

const PUBLIC = null; // no login required
const ANY = 'any'; // any signed-in user

const routes = [
  ['GET', '/api/auth/status', PUBLIC, auth.status],
  ['POST', '/api/auth/setup', PUBLIC, auth.setup],
  ['POST', '/api/auth/login', PUBLIC, auth.login],
  ['POST', '/api/auth/logout', PUBLIC, auth.logout],
  ['POST', '/api/auth/password', ANY, auth.changePassword],

  ['GET', '/api/summary', 'finance', summary],

  ['GET', '/api/transactions', 'finance', tx.list],
  ['GET', '/api/transactions/export', 'finance', tx.exportCsv],
  ['POST', '/api/transactions', 'finance', tx.create],
  ['PUT', '/api/transactions/:id', 'finance', tx.update],
  ['DELETE', '/api/transactions/:id', 'finance', tx.remove],

  ['GET', '/api/shows', 'shows', shows.list],
  ['GET', '/api/shows/:id', 'shows', shows.get],
  ['POST', '/api/shows', 'shows', shows.create],
  ['PUT', '/api/shows/:id', 'shows', shows.update],
  ['DELETE', '/api/shows/:id', 'shows', shows.remove],

  ['GET', '/api/merch', 'merch', merch.list],
  ['POST', '/api/merch', 'merch', merch.create],
  ['PUT', '/api/merch/:id', 'merch', merch.update],
  ['DELETE', '/api/merch/:id', 'merch', merch.remove],
  ['GET', '/api/merch/:id/movements', 'merch', merch.movements],
  ['POST', '/api/merch/:id/adjust', 'merch', merch.adjust],

  ['GET', '/api/goals', 'goals', goals.list],
  ['POST', '/api/goals', 'goals', goals.create],
  ['PUT', '/api/goals/:id', 'goals', goals.update],
  ['DELETE', '/api/goals/:id', 'goals', goals.remove],
  ['POST', '/api/goals/:id/milestones', 'goals', goals.addMilestone],
  ['PUT', '/api/milestones/:id', 'goals', goals.updateMilestone],
  ['DELETE', '/api/milestones/:id', 'goals', goals.removeMilestone],

  ['GET', '/api/social/overview', 'social', social.overview],
  ['GET', '/api/social/campaigns', 'social', social.listCampaigns],
  ['POST', '/api/social/campaigns', 'social', social.createCampaign],
  ['PUT', '/api/social/campaigns/:id', 'social', social.updateCampaign],
  ['DELETE', '/api/social/campaigns/:id', 'social', social.removeCampaign],
  ['GET', '/api/social/posts', 'social', social.listPosts],
  ['POST', '/api/social/posts', 'social', social.createPost],
  ['GET', '/api/social/posts/:id', 'social', social.getPost],
  ['PUT', '/api/social/posts/:id', 'social', social.updatePost],
  ['DELETE', '/api/social/posts/:id', 'social', social.removePost],
  ['POST', '/api/social/posts/:id/status', 'social', social.setStatus],
  ['PUT', '/api/social/posts/:id/results', 'social', social.updateResults],
  ['POST', '/api/social/posts/:id/comments', 'social', social.addComment],
  ['POST', '/api/social/posts/:id/media', 'social', social.uploadMedia],
  ['GET', '/api/social/media/:id', 'social', social.getMedia],
  ['DELETE', '/api/social/media/:id', 'social', social.removeMedia],
  ['GET', '/api/social/metrics', 'social', social.listMetrics],
  ['POST', '/api/social/metrics', 'social', social.saveMetric],
  ['DELETE', '/api/social/metrics/:id', 'social', social.removeMetric],

  ['GET', '/api/team', 'messages', msg.team],
  ['GET', '/api/conversations', 'messages', msg.list],
  ['GET', '/api/conversations/unread', ANY, msg.unread],
  ['POST', '/api/conversations/dm', 'messages', msg.openDm],
  ['GET', '/api/conversations/:id/messages', 'messages', msg.messages],
  ['POST', '/api/conversations/:id/messages', 'messages', msg.send],

  ['GET', '/api/users', 'users', users.list],
  ['POST', '/api/users', 'users', users.create],
  ['PUT', '/api/users/:id', 'users', users.update],
];

function match(pattern, path) {
  const a = pattern.split('/');
  const b = path.replace(/\/+$/, '').split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  try {
    if (!env.DB) throw new HttpError(500, 'Database is not connected (missing DB binding)');
    await ensureSchema(env);

    // Block cross-site form posts: state-changing requests must come from this site.
    if (request.method !== 'GET') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-site request blocked');
    }

    let found = null;
    let methodMismatch = false;
    for (const [method, pattern, area, handler] of routes) {
      const params = match(pattern, url.pathname);
      if (!params) continue;
      if (method !== request.method) { methodMismatch = true; continue; }
      found = { area, handler, params };
      break;
    }
    if (!found) throw new HttpError(methodMismatch ? 405 : 404, methodMismatch ? 'Method not allowed' : 'Not found');

    let user = null;
    if (found.area !== PUBLIC) {
      user = await auth.currentUser(env, request);
      if (!user) throw new HttpError(401, 'Please sign in');
      if (found.area !== ANY && !can(user, found.area)) throw new HttpError(403, "You don't have access to this");
    }
    return await found.handler({ request, env, url, params: found.params, user });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (String(err?.message).includes('UNIQUE constraint failed')) return json({ error: 'That already exists' }, 409);
    console.error(err);
    return json({ error: 'Something went wrong on the server' }, 500);
  }
}
