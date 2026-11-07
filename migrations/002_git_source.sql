CREATE TABLE source_items_git (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('github','git','youtube')),
  day TEXT NOT NULL,
  payload TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)),
  updated_at TEXT NOT NULL
);
INSERT INTO source_items_git SELECT * FROM source_items;
DROP TABLE source_items;
ALTER TABLE source_items_git RENAME TO source_items;
CREATE INDEX source_items_day ON source_items(day, is_public);
