CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('github','youtube')),
  day TEXT NOT NULL,
  payload TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS source_items_day ON source_items(day, is_public);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)),
  camera TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_day ON events(day, is_public);
CREATE TABLE IF NOT EXISTS sync_runs (
  source TEXT PRIMARY KEY,
  finished_at TEXT NOT NULL,
  item_count INTEGER NOT NULL
);
