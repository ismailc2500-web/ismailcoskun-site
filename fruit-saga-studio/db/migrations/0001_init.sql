-- Fruit Saga Studio — initial schema.
-- Rich, frequently-evolving documents (character bible entries, scenes,
-- episode scripts) are stored as validated JSON in `data_json`; the columns
-- next to them exist for querying, ordering and relational integrity.

CREATE TABLE series (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  data_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE characters (
  series_id    TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  display_name TEXT NOT NULL,
  fruit        TEXT NOT NULL,
  archetype    TEXT NOT NULL DEFAULT 'other',
  locked       INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  data_json    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (series_id, id)
);

CREATE TABLE locations (
  series_id        TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  id               TEXT NOT NULL,
  name             TEXT NOT NULL,
  environment_type TEXT NOT NULL DEFAULT 'other',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  data_json        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (series_id, id)
);

CREATE TABLE episodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id       TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  episode_number  INTEGER NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft',
  mode            TEXT NOT NULL DEFAULT 'preview',
  platform        TEXT NOT NULL DEFAULT 'youtube_shorts',
  target_duration REAL NOT NULL DEFAULT 60,
  data_json       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (series_id, episode_number)
);

CREATE TABLE scenes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id  INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  scene_id    TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  beat        TEXT NOT NULL DEFAULT 'scene_1',
  duration    REAL NOT NULL DEFAULT 6,
  data_json   TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (episode_id, scene_id)
);
CREATE INDEX idx_scenes_episode ON scenes(episode_id, sort_order);

-- Every generated or uploaded file. `cache_key` links to asset_cache.
CREATE TABLE assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id  INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  scene_id    TEXT,
  kind        TEXT NOT NULL,
  variant     TEXT NOT NULL DEFAULT 'preview',
  path        TEXT NOT NULL,
  cache_key   TEXT,
  provider    TEXT,
  model       TEXT,
  cost        REAL NOT NULL DEFAULT 0,
  width       INTEGER,
  height      INTEGER,
  duration    REAL,
  meta_json   TEXT NOT NULL DEFAULT '{}',
  is_current  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_assets_lookup ON assets(episode_id, kind, variant, scene_id, is_current);

CREATE TABLE generation_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id     INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  run_id         TEXT NOT NULL,
  scene_id       TEXT,
  stage          TEXT NOT NULL,
  label          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'queued',
  progress       REAL NOT NULL DEFAULT 0,
  attempts       INTEGER NOT NULL DEFAULT 0,
  provider       TEXT,
  model          TEXT,
  cache_key      TEXT,
  estimated_cost REAL NOT NULL DEFAULT 0,
  actual_cost    REAL NOT NULL DEFAULT 0,
  error          TEXT,
  input_json     TEXT,
  output_json    TEXT,
  runner_pid     INTEGER,
  created_at     TEXT NOT NULL,
  started_at     TEXT,
  finished_at    TEXT
);
CREATE INDEX idx_jobs_episode ON generation_jobs(episode_id, id);
CREATE INDEX idx_jobs_status ON generation_jobs(status);

-- Content-addressed generation cache: sha256(provider, model, prompt, seed, settings, inputs).
CREATE TABLE asset_cache (
  cache_key   TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  path        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT,
  cost        REAL NOT NULL DEFAULT 0,
  meta_json   TEXT NOT NULL DEFAULT '{}',
  hits        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

-- Per-mode provider choice, set from the Settings page (falls back to env vars).
CREATE TABLE provider_configs (
  kind         TEXT NOT NULL,
  mode         TEXT NOT NULL,
  provider     TEXT NOT NULL,
  model        TEXT NOT NULL DEFAULT '',
  quality      TEXT NOT NULL DEFAULT '',
  pricing_json TEXT NOT NULL DEFAULT '{}',
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (kind, mode)
);

-- Continuity: the series state *after* each episode. Generating episode N
-- always reads the snapshot with the highest after_episode < N, so
-- re-generating an old episode never sees its own future.
CREATE TABLE continuity_snapshots (
  series_id            TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  after_episode_number INTEGER NOT NULL,
  state_json           TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  PRIMARY KEY (series_id, after_episode_number)
);

-- Performance data per published episode/platform, for later analysis of
-- which hooks, characters, scene types, durations and titles work best.
CREATE TABLE episode_analytics (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id        INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  platform          TEXT NOT NULL,
  captured_at       TEXT NOT NULL,
  views             INTEGER NOT NULL DEFAULT 0,
  likes             INTEGER NOT NULL DEFAULT 0,
  comments          INTEGER NOT NULL DEFAULT 0,
  shares            INTEGER NOT NULL DEFAULT 0,
  saves             INTEGER NOT NULL DEFAULT 0,
  avg_watch_seconds REAL NOT NULL DEFAULT 0,
  completion_rate   REAL NOT NULL DEFAULT 0,
  ctr               REAL NOT NULL DEFAULT 0,
  followers_gained  INTEGER NOT NULL DEFAULT 0,
  retention_json    TEXT NOT NULL DEFAULT '[]',
  notes             TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_analytics_episode ON episode_analytics(episode_id);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
