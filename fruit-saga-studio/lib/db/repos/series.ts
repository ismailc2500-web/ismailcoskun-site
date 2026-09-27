import { getDb, now, parseJson } from "@/lib/db";
import {
  CharacterSchema,
  LocationSchema,
  SeriesSchema,
  SeriesStateSchema,
  type Character,
  type CharacterInput,
  type Location,
  type LocationInput,
  type Series,
  type SeriesInput,
  type SeriesState,
  type SeriesStateInput,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export function listSeries(): Series[] {
  const rows = getDb().prepare("SELECT data_json FROM series ORDER BY created_at").all() as { data_json: string }[];
  return rows.map((r) => SeriesSchema.parse(parseJson(r.data_json, {})));
}

export function getSeries(id: string): Series | null {
  const row = getDb().prepare("SELECT data_json FROM series WHERE id = ?").get(id) as { data_json: string } | undefined;
  return row ? SeriesSchema.parse(parseJson(row.data_json, {})) : null;
}

export function upsertSeries(input: SeriesInput): Series {
  const series = SeriesSchema.parse(input);
  const db = getDb();
  const ts = now();
  db.prepare(
    `INSERT INTO series (id, title, data_json, created_at, updated_at) VALUES (@id, @title, @data, @ts, @ts)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, data_json=excluded.data_json, updated_at=excluded.updated_at`,
  ).run({ id: series.id, title: series.title, data: JSON.stringify(series), ts });
  // Every series starts with an "after episode 0" continuity snapshot.
  const hasState = db
    .prepare("SELECT 1 FROM continuity_snapshots WHERE series_id = ? LIMIT 1")
    .get(series.id);
  if (!hasState) putSnapshot(series.id, 0, { series_id: series.id, as_of_episode: 0 });
  return series;
}

export function deleteSeries(id: string) {
  getDb().prepare("DELETE FROM series WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export function listCharacters(seriesId: string): Character[] {
  const rows = getDb()
    .prepare("SELECT data_json FROM characters WHERE series_id = ? ORDER BY sort_order, display_name")
    .all(seriesId) as { data_json: string }[];
  return rows.map((r) => CharacterSchema.parse(parseJson(r.data_json, {})));
}

export function getCharacter(seriesId: string, id: string): Character | null {
  const row = getDb()
    .prepare("SELECT data_json FROM characters WHERE series_id = ? AND id = ?")
    .get(seriesId, id) as { data_json: string } | undefined;
  return row ? CharacterSchema.parse(parseJson(row.data_json, {})) : null;
}

export function saveCharacter(seriesId: string, input: CharacterInput, sortOrder?: number): Character {
  const character = CharacterSchema.parse(input);
  const db = getDb();
  const ts = now();
  const existing = db
    .prepare("SELECT sort_order FROM characters WHERE series_id = ? AND id = ?")
    .get(seriesId, character.id) as { sort_order: number } | undefined;
  const order =
    sortOrder ??
    existing?.sort_order ??
    ((db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM characters WHERE series_id = ?").get(seriesId) as {
      n: number;
    }).n);
  db.prepare(
    `INSERT INTO characters (series_id, id, display_name, fruit, archetype, locked, sort_order, data_json, created_at, updated_at)
     VALUES (@series_id, @id, @display_name, @fruit, @archetype, @locked, @sort_order, @data, @ts, @ts)
     ON CONFLICT(series_id, id) DO UPDATE SET display_name=excluded.display_name, fruit=excluded.fruit,
       archetype=excluded.archetype, locked=excluded.locked, sort_order=excluded.sort_order,
       data_json=excluded.data_json, updated_at=excluded.updated_at`,
  ).run({
    series_id: seriesId,
    id: character.id,
    display_name: character.display_name,
    fruit: character.fruit,
    archetype: character.archetype,
    locked: character.locked ? 1 : 0,
    sort_order: order,
    data: JSON.stringify(character),
    ts,
  });
  return character;
}

export function deleteCharacter(seriesId: string, id: string) {
  getDb().prepare("DELETE FROM characters WHERE series_id = ? AND id = ?").run(seriesId, id);
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export function listLocations(seriesId: string): Location[] {
  const rows = getDb()
    .prepare("SELECT data_json FROM locations WHERE series_id = ? ORDER BY sort_order, name")
    .all(seriesId) as { data_json: string }[];
  return rows.map((r) => LocationSchema.parse(parseJson(r.data_json, {})));
}

export function getLocation(seriesId: string, id: string): Location | null {
  const row = getDb()
    .prepare("SELECT data_json FROM locations WHERE series_id = ? AND id = ?")
    .get(seriesId, id) as { data_json: string } | undefined;
  return row ? LocationSchema.parse(parseJson(row.data_json, {})) : null;
}

export function saveLocation(seriesId: string, input: LocationInput, sortOrder?: number): Location {
  const location = LocationSchema.parse(input);
  const db = getDb();
  const ts = now();
  const existing = db
    .prepare("SELECT sort_order FROM locations WHERE series_id = ? AND id = ?")
    .get(seriesId, location.id) as { sort_order: number } | undefined;
  const order =
    sortOrder ??
    existing?.sort_order ??
    ((db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM locations WHERE series_id = ?").get(seriesId) as {
      n: number;
    }).n);
  db.prepare(
    `INSERT INTO locations (series_id, id, name, environment_type, sort_order, data_json, created_at, updated_at)
     VALUES (@series_id, @id, @name, @env, @sort_order, @data, @ts, @ts)
     ON CONFLICT(series_id, id) DO UPDATE SET name=excluded.name, environment_type=excluded.environment_type,
       sort_order=excluded.sort_order, data_json=excluded.data_json, updated_at=excluded.updated_at`,
  ).run({
    series_id: seriesId,
    id: location.id,
    name: location.name,
    env: location.environment_type,
    sort_order: order,
    data: JSON.stringify(location),
    ts,
  });
  return location;
}

export function deleteLocation(seriesId: string, id: string) {
  getDb().prepare("DELETE FROM locations WHERE series_id = ? AND id = ?").run(seriesId, id);
}

// ---------------------------------------------------------------------------
// Continuity snapshots
// ---------------------------------------------------------------------------

export function putSnapshot(seriesId: string, afterEpisode: number, state: SeriesStateInput): SeriesState {
  const parsed = SeriesStateSchema.parse({ ...state, series_id: seriesId, as_of_episode: afterEpisode, updated_at: now() });
  getDb()
    .prepare(
      `INSERT INTO continuity_snapshots (series_id, after_episode_number, state_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(series_id, after_episode_number) DO UPDATE SET state_json=excluded.state_json, created_at=excluded.created_at`,
    )
    .run(seriesId, afterEpisode, JSON.stringify(parsed), parsed.updated_at);
  return parsed;
}

/** State the story engine must use when writing `episodeNumber`: the latest snapshot strictly before it. */
export function getStateBefore(seriesId: string, episodeNumber: number): SeriesState {
  const row = getDb()
    .prepare(
      "SELECT state_json FROM continuity_snapshots WHERE series_id = ? AND after_episode_number < ? ORDER BY after_episode_number DESC LIMIT 1",
    )
    .get(seriesId, episodeNumber) as { state_json: string } | undefined;
  return SeriesStateSchema.parse(row ? parseJson(row.state_json, {}) : { series_id: seriesId });
}

export function getLatestState(seriesId: string): SeriesState {
  return getStateBefore(seriesId, Number.MAX_SAFE_INTEGER);
}

export function listSnapshots(seriesId: string): SeriesState[] {
  const rows = getDb()
    .prepare("SELECT state_json FROM continuity_snapshots WHERE series_id = ? ORDER BY after_episode_number")
    .all(seriesId) as { state_json: string }[];
  return rows.map((r) => SeriesStateSchema.parse(parseJson(r.state_json, {})));
}
