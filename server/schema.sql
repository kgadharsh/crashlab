-- One row per ranked submission. The board shows each player's best entry for a Grand Prix.
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,        -- who submitted it (the sign-in id, once sign-in exists)
  display TEXT NOT NULL,       -- the name shown on the board
  gp TEXT NOT NULL,            -- Grand Prix id, e.g. gp1
  finished INTEGER NOT NULL,   -- tracks finished, worked out on the server
  total_time REAL NOT NULL,    -- seconds over the tracks finished, worked out on the server
  medal TEXT,                  -- gold, silver, bronze or null
  car TEXT NOT NULL,           -- the car file, so a ghost can be replayed
  day TEXT NOT NULL,           -- UTC date, for the daily limit
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_board ON entries (gp, finished DESC, total_time ASC);
CREATE INDEX IF NOT EXISTS entries_player_day ON entries (player, day);
