CREATE TABLE IF NOT EXISTS draw_records (
  id TEXT PRIMARY KEY NOT NULL,
  prize_id TEXT,
  prize_name TEXT NOT NULL,
  prize_emoji TEXT NOT NULL DEFAULT '🎁',
  draw_mode TEXT NOT NULL CHECK (draw_mode IN ('infinite', 'stock')),
  draw_no INTEGER NOT NULL CHECK (draw_no >= 0),
  weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0),
  stock_after INTEGER NOT NULL DEFAULT 0 CHECK (stock_after >= 0),
  drawn_at INTEGER NOT NULL,
  client_timezone TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS draw_records_drawn_at_idx
  ON draw_records (drawn_at DESC);

CREATE INDEX IF NOT EXISTS draw_records_prize_name_idx
  ON draw_records (prize_name);

CREATE INDEX IF NOT EXISTS draw_records_mode_drawn_at_idx
  ON draw_records (draw_mode, drawn_at DESC);
