CREATE TABLE IF NOT EXISTS lottery_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at INTEGER NOT NULL
) STRICT;

INSERT OR IGNORE INTO lottery_settings (id, revision, updated_at)
VALUES (1, 1, 0);

CREATE TABLE IF NOT EXISTS lottery_prizes (
  id TEXT PRIMARY KEY NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 0),
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎁',
  image TEXT NOT NULL DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  initial_stock INTEGER NOT NULL DEFAULT 0 CHECK (initial_stock >= 0),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS lottery_prizes_sort_order_idx
  ON lottery_prizes (sort_order);
