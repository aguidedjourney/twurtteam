import { MIGRATIONS } from './schema.generated.js';

// Brings the database up to date the first time each server instance handles a
// request, so new tables appear on deploy without anyone using the D1 console.
// Every migration statement is idempotent (IF NOT EXISTS / WHERE NOT EXISTS),
// so two instances racing, or a database set up by hand, is harmless.

let ready = null;

export function ensureSchema(env) {
  if (!ready) ready = migrate(env).catch((err) => { ready = null; throw err; });
  return ready;
}

async function migrate(env) {
  const db = env.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  const { results } = await db.prepare('SELECT id FROM schema_migrations').all();
  const applied = new Set(results.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.batch([
      ...m.statements.map((s) => db.prepare(s)),
      db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').bind(m.id),
    ]);
  }
}
