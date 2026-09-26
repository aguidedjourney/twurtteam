-- Team Twurt: initial schema
-- Money is stored as integer cents. Dates are ISO strings (YYYY-MM-DD).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,               -- SHA-256 of the cookie token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE shows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  name       TEXT NOT NULL,                  -- venue / event
  city       TEXT,
  status     TEXT NOT NULL DEFAULT 'booked', -- booked | completed | cancelled
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_shows_date ON shows(date);

CREATE TABLE transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  date           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('revenue', 'expense')),
  category       TEXT NOT NULL,
  description    TEXT,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  show_id        INTEGER REFERENCES shows(id) ON DELETE SET NULL,
  payment_method TEXT,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_show ON transactions(show_id);

CREATE TABLE merch_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  variant         TEXT,                      -- size / color
  sku             TEXT,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  price_cents     INTEGER NOT NULL DEFAULT 0,
  quantity        INTEGER NOT NULL DEFAULT 0,
  low_stock       INTEGER NOT NULL DEFAULT 5,
  notes           TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE merch_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES merch_items(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  change         INTEGER NOT NULL,          -- + adds stock, - removes stock
  reason         TEXT NOT NULL,             -- initial | sale | restock | giveaway | damaged | correction
  show_id        INTEGER REFERENCES shows(id) ON DELETE SET NULL,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  note           TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_moves_item ON merch_movements(item_id);

CREATE TABLE goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('financial', 'project')),
  metric        TEXT,                        -- financial: revenue | expenses | net | manual
  category      TEXT,                        -- optional filter for revenue/expense metrics
  target_cents  INTEGER,
  current_cents INTEGER,                     -- used by the manual metric
  start_date    TEXT,
  due_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- active | achieved | paused | dropped
  owner         TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE goal_milestones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id    INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  due_date   TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_milestones_goal ON goal_milestones(goal_id);
