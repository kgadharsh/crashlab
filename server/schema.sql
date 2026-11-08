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
  -- (the server also adds: official INTEGER, and tracks TEXT: each track's result as JSON, so a player can see how an entry went)
);
CREATE INDEX IF NOT EXISTS entries_board ON entries (gp, finished DESC, total_time ASC);
CREATE INDEX IF NOT EXISTS entries_player_day ON entries (player, day);

-- A player's chosen board name. Sign-in only proves who someone is; no real name from Google or GitHub is kept.
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,         -- the sign-in id, e.g. google:123
  name TEXT NOT NULL,          -- as typed, shown on the board
  name_key TEXT NOT NULL UNIQUE, -- lower case, so Ann and ann cannot both exist
  created_at INTEGER NOT NULL
);

-- The Weekly Grand Prix: each week's track seed, picked at random the first time the week is asked for.
-- It is only sent out once the week is over, so nobody can practise on that week's tracks.
CREATE TABLE IF NOT EXISTS weeks (
  week INTEGER PRIMARY KEY,    -- weeks since Monday 5 Jan 1970 (UTC); entries for it have gp = 'w:' || week
  seed INTEGER NOT NULL
);

-- The Daily Challenge: each day's track seed, picked at random the first time the day is asked for (the server also makes this table on first use)
CREATE TABLE IF NOT EXISTS days (
  day INTEGER PRIMARY KEY,     -- days since 1 Jan 1970 (UTC); entries for it have gp = 'd:' || day
  seed INTEGER NOT NULL
);

-- Short challenge links: a shared car under a code made from its contents (the server also makes this table on first use)
CREATE TABLE IF NOT EXISTS challenges (
  code TEXT PRIMARY KEY,       -- 10 characters from a hash of the car
  car TEXT NOT NULL,           -- the car file
  created_at INTEGER NOT NULL
);
