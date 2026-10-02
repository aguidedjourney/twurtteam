import { HttpError, json, readBody, v, today } from '../http.js';
import { randomToken } from '../crypto.js';
import { can } from '../permissions.js';

export const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'facebook'];
const POST_TYPES = ['post', 'reel', 'story', 'video', 'carousel', 'live'];
const CAMPAIGN_STATUS = ['planning', 'active', 'done'];
const EDITABLE = ['draft', 'changes_requested']; // statuses a non-approver can still edit
const MAX_UPLOAD = 95 * 1024 * 1024; // Cloudflare caps request bodies at 100 MB

const isApprover = (user) => can(user, 'social_approve');

function platformList(val) {
  const list = (Array.isArray(val) ? val : String(val || '').split(','))
    .map((p) => String(p).trim().toLowerCase()).filter(Boolean);
  for (const p of list) if (!PLATFORMS.includes(p)) throw new HttpError(400, `Unknown platform: ${p}`);
  return list.length ? [...new Set(list)].join(',') : null;
}

function dateTime(val, name) {
  if (val === undefined || val === null || val === '') return null;
  val = String(val);
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(val)) throw new HttpError(400, `${name} must be a date and time`);
  v.date(val.slice(0, 10), name);
  return val;
}

function url(val, name) {
  const s = v.str(val, name, { max: 500 });
  if (s && !/^https?:\/\//i.test(s)) throw new HttpError(400, `${name} must start with http:// or https://`);
  return s;
}

async function campaignExists(env, id) {
  if (id && !(await env.DB.prepare('SELECT 1 FROM campaigns WHERE id = ?').bind(id).first())) {
    throw new HttpError(400, 'That campaign no longer exists');
  }
  return id;
}

// ------------------------------------------------------------------ overview

export async function overview({ env, user }) {
  const db = env.DB;
  const [counts, upcoming, campaigns, latest, monthAgo] = await Promise.all([
    db.prepare('SELECT status, COUNT(*) AS n FROM social_posts GROUP BY status').all(),
    db.prepare(`SELECT p.id, p.title, p.platforms, p.planned_at, p.status, c.name AS campaign_name FROM social_posts p
                LEFT JOIN campaigns c ON c.id = p.campaign_id
                WHERE p.status != 'posted' AND p.planned_at >= ? ORDER BY p.planned_at LIMIT 8`).bind(today()).all(),
    db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM social_posts p WHERE p.campaign_id = c.id) AS post_count
                FROM campaigns c WHERE status = 'active' ORDER BY COALESCE(end_date, '9999')`).all(),
    db.prepare(`SELECT m.* FROM social_metrics m
                WHERE m.date = (SELECT MAX(date) FROM social_metrics x WHERE x.platform = m.platform AND x.followers IS NOT NULL)`).all(),
    db.prepare(`SELECT m.platform, m.followers, m.date FROM social_metrics m
                WHERE m.followers IS NOT NULL AND m.date = (SELECT MAX(date) FROM social_metrics x
                  WHERE x.platform = m.platform AND x.followers IS NOT NULL AND x.date <= date('now', '-30 days'))`).all(),
  ]);
  const byStatus = Object.fromEntries(counts.results.map((r) => [r.status, r.n]));
  return json({
    counts: byStatus,
    upcoming: upcoming.results,
    campaigns: campaigns.results,
    followers: latest.results.map((m) => ({ ...m, prior: monthAgo.results.find((p) => p.platform === m.platform) || null })),
    canApprove: isApprover(user),
  });
}

// ------------------------------------------------------------------ campaigns

export async function listCampaigns({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT c.*, u.name AS created_by_name,
       (SELECT COUNT(*) FROM social_posts p WHERE p.campaign_id = c.id) AS post_count,
       (SELECT COUNT(*) FROM social_posts p WHERE p.campaign_id = c.id AND p.status = 'posted') AS posted_count
     FROM campaigns c LEFT JOIN users u ON u.id = c.created_by
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 ELSE 2 END, COALESCE(start_date, '9999'), id`
  ).all();
  return json({ campaigns: results });
}

function cleanCampaign(body) {
  const c = {
    name: v.str(body.name, 'Campaign name', { required: true, max: 120 }),
    objective: v.str(body.objective, 'Objective', { max: 500 }),
    platforms: platformList(body.platforms),
    start_date: v.date(body.start_date, 'Start date'),
    end_date: v.date(body.end_date, 'End date'),
    status: v.oneOf(body.status, 'Status', CAMPAIGN_STATUS, 'planning'),
    budget_cents: v.money(body.budget, 'Budget', { required: false }),
    notes: v.str(body.notes, 'Notes', { max: 4000 }),
  };
  if (c.start_date && c.end_date && c.start_date > c.end_date) throw new HttpError(400, 'Start date must be before the end date');
  return c;
}
const CAMPAIGN_COLS = ['name', 'objective', 'platforms', 'start_date', 'end_date', 'status', 'budget_cents', 'notes'];

export async function createCampaign({ env, request, user }) {
  const c = cleanCampaign(await readBody(request));
  const res = await env.DB.prepare(
    `INSERT INTO campaigns (${CAMPAIGN_COLS.join(', ')}, created_by) VALUES (${CAMPAIGN_COLS.map(() => '?').join(', ')}, ?)`
  ).bind(...CAMPAIGN_COLS.map((k) => c[k]), user.id).run();
  return json({ id: res.meta.last_row_id }, 201);
}

export async function updateCampaign({ env, request, params }) {
  const id = v.id(params.id, 'Campaign');
  const c = cleanCampaign(await readBody(request));
  const res = await env.DB.prepare(`UPDATE campaigns SET ${CAMPAIGN_COLS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...CAMPAIGN_COLS.map((k) => c[k]), id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Campaign not found');
  return json({ ok: true });
}

export async function removeCampaign({ env, params }) {
  const id = v.id(params.id, 'Campaign');
  await env.DB.batch([
    env.DB.prepare('UPDATE social_posts SET campaign_id = NULL WHERE campaign_id = ?').bind(id),
    env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

// ------------------------------------------------------------------ posts

const POST_SELECT = `SELECT p.*, c.name AS campaign_name, u.name AS created_by_name,
    (SELECT COUNT(*) FROM post_media m WHERE m.post_id = p.id) AS media_count,
    (SELECT m.id FROM post_media m WHERE m.post_id = p.id ORDER BY m.id LIMIT 1) AS cover_media_id,
    (SELECT m.content_type FROM post_media m WHERE m.post_id = p.id ORDER BY m.id LIMIT 1) AS cover_type,
    (SELECT COUNT(*) FROM post_comments k WHERE k.post_id = p.id AND k.kind = 'comment') AS comment_count
  FROM social_posts p LEFT JOIN campaigns c ON c.id = p.campaign_id LEFT JOIN users u ON u.id = p.created_by`;

export async function listPosts({ env, url: u }) {
  const where = [];
  const args = [];
  const status = u.searchParams.get('status');
  if (status) { where.push(`p.status IN (${status.split(',').map(() => '?').join(',')})`); args.push(...status.split(',')); }
  if (u.searchParams.get('campaign_id')) { where.push('p.campaign_id = ?'); args.push(v.id(u.searchParams.get('campaign_id'), 'Campaign')); }
  const from = v.date(u.searchParams.get('from'), 'From');
  const to = v.date(u.searchParams.get('to'), 'To');
  if (from) { where.push('p.planned_at >= ?'); args.push(from); }
  if (to) { where.push('p.planned_at <= ?'); args.push(to + 'T99'); }
  const { results } = await env.DB.prepare(
    `${POST_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE WHEN p.planned_at IS NULL THEN 1 ELSE 0 END, p.planned_at, p.id DESC LIMIT 500`
  ).bind(...args).all();
  return json({ posts: results });
}

async function loadPost(env, id) {
  const post = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first();
  if (!post) throw new HttpError(404, 'Post not found');
  return post;
}

function canEdit(user, post) {
  return isApprover(user) || EDITABLE.includes(post.status);
}

export async function getPost({ env, params, user }) {
  const id = v.id(params.id, 'Post');
  const post = await loadPost(env, id);
  const [media, comments] = await Promise.all([
    env.DB.prepare('SELECT id, filename, content_type, size, created_at FROM post_media WHERE post_id = ? ORDER BY id').bind(id).all(),
    env.DB.prepare(`SELECT k.*, u.name AS user_name FROM post_comments k LEFT JOIN users u ON u.id = k.user_id
                    WHERE k.post_id = ? ORDER BY k.id`).bind(id).all(),
  ]);
  return json({
    post, media: media.results, comments: comments.results,
    canEdit: canEdit(user, post), canApprove: isApprover(user), uploads: !!env.MEDIA,
  });
}

async function cleanPost(env, body) {
  return {
    title: v.str(body.title, 'Title', { required: true, max: 140 }),
    caption: v.str(body.caption, 'Caption', { max: 5000 }),
    hashtags: v.str(body.hashtags, 'Hashtags', { max: 1000 }),
    platforms: platformList(body.platforms),
    post_type: v.oneOf(body.post_type, 'Type', POST_TYPES, 'post'),
    planned_at: dateTime(body.planned_at, 'Planned time'),
    campaign_id: await campaignExists(env, v.id(body.campaign_id, 'Campaign')),
    external_link: url(body.external_link, 'Link to files'),
  };
}
const POST_COLS = ['title', 'caption', 'hashtags', 'platforms', 'post_type', 'planned_at', 'campaign_id', 'external_link'];

export async function createPost({ env, request, user }) {
  const p = await cleanPost(env, await readBody(request));
  const res = await env.DB.prepare(
    `INSERT INTO social_posts (${POST_COLS.join(', ')}, created_by) VALUES (${POST_COLS.map(() => '?').join(', ')}, ?)`
  ).bind(...POST_COLS.map((k) => p[k]), user.id).run();
  return json({ id: res.meta.last_row_id }, 201);
}

export async function updatePost({ env, request, params, user }) {
  const id = v.id(params.id, 'Post');
  const post = await loadPost(env, id);
  if (!canEdit(user, post)) throw new HttpError(403, 'This post is locked while it is in review or approved');
  const p = await cleanPost(env, await readBody(request));
  await env.DB.prepare(`UPDATE social_posts SET ${POST_COLS.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...POST_COLS.map((k) => p[k]), id).run();
  return json({ ok: true });
}

export async function removePost({ env, params, user }) {
  const id = v.id(params.id, 'Post');
  const post = await loadPost(env, id);
  if (!isApprover(user) && post.status !== 'draft') throw new HttpError(403, 'Only drafts can be deleted');
  const { results } = await env.DB.prepare('SELECT r2_key FROM post_media WHERE post_id = ?').bind(id).all();
  if (env.MEDIA && results.length) await env.MEDIA.delete(results.map((r) => r.r2_key));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM post_media WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM post_comments WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM social_posts WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

// Moves a post through the review flow and logs it in the post's thread.
//   draft / changes_requested -> in_review       (submit; anyone)
//   in_review                 -> draft            (withdraw; anyone)
//   draft / in_review / changes_requested -> approved (approvers only)
//   in_review / approved / scheduled     -> changes_requested (approvers only)
//   approved                  -> scheduled        (anyone)
//   approved / scheduled      -> posted           (anyone)
const FLOW = {
  in_review: { from: ['draft', 'changes_requested'] },
  draft: { from: ['in_review'] },
  approved: { from: ['draft', 'in_review', 'changes_requested'], approver: true },
  changes_requested: { from: ['in_review', 'approved', 'scheduled'], approver: true },
  scheduled: { from: ['approved'] },
  posted: { from: ['approved', 'scheduled'] },
};

export async function setStatus({ env, request, params, user }) {
  const id = v.id(params.id, 'Post');
  const post = await loadPost(env, id);
  const body = await readBody(request);
  const status = v.oneOf(body.status, 'Status', Object.keys(FLOW));
  const rule = FLOW[status];
  if (rule.approver && !isApprover(user)) throw new HttpError(403, 'Only Twurt or Britney can approve or request changes');
  if (!rule.from.includes(post.status)) throw new HttpError(400, `Can't move a post from "${post.status}" to "${status}"`);
  const note = v.str(body.note, 'Note', { max: 2000 });
  if (status === 'changes_requested' && !note) throw new HttpError(400, 'Say what should change');
  if (status === 'in_review' && !post.caption && !post.media_count && !post.external_link) {
    throw new HttpError(400, 'Add a caption, a file or a link before sending for review');
  }

  const stmts = [];
  if (status === 'posted') {
    stmts.push(env.DB.prepare(
      `UPDATE social_posts SET status = ?, post_url = COALESCE(?, post_url), posted_at = COALESCE(?, posted_at, ?), updated_at = datetime('now') WHERE id = ?`
    ).bind(status, url(body.post_url, 'Post link'), dateTime(body.posted_at, 'Posted time'), today(), id));
  } else {
    stmts.push(env.DB.prepare(`UPDATE social_posts SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id));
  }
  stmts.push(env.DB.prepare(`INSERT INTO post_comments (post_id, user_id, kind, status, body) VALUES (?, ?, 'status', ?, ?)`)
    .bind(id, user.id, status, note));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

// Link + performance numbers after a post goes live.
export async function updateResults({ env, request, params }) {
  const id = v.id(params.id, 'Post');
  await loadPost(env, id);
  const body = await readBody(request);
  const n = (k, label) => v.int(body[k], label, { min: 0, max: 1e12 });
  await env.DB.prepare(
    `UPDATE social_posts SET post_url = ?, posted_at = ?, views = ?, likes = ?, comments = ?, shares = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(url(body.post_url, 'Post link'), dateTime(body.posted_at, 'Posted time'),
    n('views', 'Views'), n('likes', 'Likes'), n('comments', 'Comments'), n('shares', 'Shares'), id).run();
  return json({ ok: true });
}

export async function addComment({ env, request, params, user }) {
  const id = v.id(params.id, 'Post');
  await loadPost(env, id);
  const body = await readBody(request);
  await env.DB.prepare(`INSERT INTO post_comments (post_id, user_id, kind, body) VALUES (?, ?, 'comment', ?)`)
    .bind(id, user.id, v.str(body.body, 'Comment', { required: true, max: 4000 })).run();
  return json({ ok: true }, 201);
}

// ------------------------------------------------------------------ media (Cloudflare R2)

function requireStorage(env) {
  if (!env.MEDIA) throw new HttpError(501, 'File uploads are not set up yet. Paste a link to the files instead.');
}

// Raw file body; filename in the x-filename header.
export async function uploadMedia({ env, request, params, user }) {
  requireStorage(env);
  const id = v.id(params.id, 'Post');
  const post = await loadPost(env, id);
  if (!canEdit(user, post)) throw new HttpError(403, 'This post is locked while it is in review or approved');
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^(image|video)\//.test(type)) throw new HttpError(415, 'Only photos and videos can be uploaded');
  const size = Number(request.headers.get('content-length'));
  if (!size) throw new HttpError(411, 'Missing file size');
  if (size > MAX_UPLOAD) throw new HttpError(413, 'Files must be under 95 MB. For bigger videos, paste a Google Drive or Dropbox link.');
  const filename = v.str(decodeURIComponent(request.headers.get('x-filename') || 'upload'), 'File name', { max: 200 })
    .replace(/[^\w.\- ()]/g, '_');
  const key = `posts/${id}/${randomToken().slice(0, 16)}-${filename}`;
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: type } });
  const res = await env.DB.prepare(
    'INSERT INTO post_media (post_id, r2_key, filename, content_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, key, filename, type, size, user.id).run();
  return json({ id: res.meta.last_row_id }, 201);
}

export async function getMedia({ env, params, request }) {
  requireStorage(env);
  const m = await env.DB.prepare('SELECT * FROM post_media WHERE id = ?').bind(v.id(params.id, 'File')).first();
  if (!m) throw new HttpError(404, 'File not found');
  const range = request.headers.get('range');
  const obj = await env.MEDIA.get(m.r2_key, range ? { range: request.headers } : undefined);
  if (!obj) throw new HttpError(404, 'File not found');
  const headers = new Headers({
    'content-type': m.content_type,
    'cache-control': 'private, max-age=3600',
    'content-disposition': `inline; filename="${m.filename.replace(/"/g, '')}"`,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  });
  if (range && obj.range) {
    const r = obj.range;
    const length = 'suffix' in r ? Math.min(r.suffix, m.size) : (r.length ?? m.size - (r.offset ?? 0));
    const start = 'suffix' in r ? m.size - length : (r.offset ?? 0);
    headers.set('content-range', `bytes ${start}-${start + length - 1}/${m.size}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(m.size));
  return new Response(obj.body, { headers });
}

export async function removeMedia({ env, params, user }) {
  requireStorage(env);
  const m = await env.DB.prepare('SELECT * FROM post_media WHERE id = ?').bind(v.id(params.id, 'File')).first();
  if (!m) throw new HttpError(404, 'File not found');
  if (!canEdit(user, await loadPost(env, m.post_id))) throw new HttpError(403, 'This post is locked while it is in review or approved');
  await env.MEDIA.delete(m.r2_key);
  await env.DB.prepare('DELETE FROM post_media WHERE id = ?').bind(m.id).run();
  return json({ ok: true });
}

// ------------------------------------------------------------------ metrics

export async function listMetrics({ env }) {
  const [snapshots, topPosts] = await Promise.all([
    env.DB.prepare(`SELECT m.*, u.name AS created_by_name FROM social_metrics m LEFT JOIN users u ON u.id = m.created_by
                    ORDER BY m.date DESC, m.platform LIMIT 1000`).all(),
    env.DB.prepare(`SELECT id, title, platforms, post_url, posted_at, views, likes, comments, shares FROM social_posts
                    WHERE status = 'posted' AND views IS NOT NULL ORDER BY views DESC LIMIT 10`).all(),
  ]);
  return json({ metrics: snapshots.results, topPosts: topPosts.results });
}

export async function saveMetric({ env, request, user }) {
  const body = await readBody(request);
  const n = (k, label) => v.int(body[k], label, { min: 0, max: 1e12 });
  const m = {
    date: v.date(body.date, 'Date', { required: true }),
    platform: v.oneOf(body.platform, 'Platform', PLATFORMS),
    followers: n('followers', 'Followers'),
    views: n('views', 'Views'),
    engagement: n('engagement', 'Engagement'),
    posts: n('posts', 'Posts'),
    notes: v.str(body.notes, 'Notes', { max: 1000 }),
  };
  if ([m.followers, m.views, m.engagement, m.posts].every((x) => x === null)) throw new HttpError(400, 'Enter at least one number');
  // One snapshot per platform per day: saving again replaces it.
  await env.DB.prepare(
    `INSERT INTO social_metrics (date, platform, followers, views, engagement, posts, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (date, platform) DO UPDATE SET followers = excluded.followers, views = excluded.views,
       engagement = excluded.engagement, posts = excluded.posts, notes = excluded.notes, created_by = excluded.created_by`
  ).bind(m.date, m.platform, m.followers, m.views, m.engagement, m.posts, m.notes, user.id).run();
  return json({ ok: true });
}

export async function removeMetric({ env, params }) {
  await env.DB.prepare('DELETE FROM social_metrics WHERE id = ?').bind(v.id(params.id, 'Entry')).run();
  return json({ ok: true });
}
