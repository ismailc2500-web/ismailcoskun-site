-- Denormalised "features" of each published episode, captured at export time,
-- so performance can later be grouped by hook style, cast, scene types,
-- duration and title without re-parsing episode JSON.
CREATE TABLE episode_features (
  episode_id      INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  hook            TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  duration        REAL NOT NULL DEFAULT 0,
  scene_count     INTEGER NOT NULL DEFAULT 0,
  characters_json TEXT NOT NULL DEFAULT '[]',
  framings_json   TEXT NOT NULL DEFAULT '[]',
  locations_json  TEXT NOT NULL DEFAULT '[]',
  captured_at     TEXT NOT NULL
);
