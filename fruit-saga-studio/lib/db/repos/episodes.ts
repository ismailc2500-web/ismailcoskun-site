import { getDb, now, parseJson } from "@/lib/db";
import {
  EpisodeSchema,
  SceneSchema,
  type Episode,
  type EpisodeData,
  type EpisodeInput,
  type Scene,
  type SceneInput,
} from "@/lib/types";

interface EpisodeRow {
  id: number;
  series_id: string;
  episode_number: number;
  data_json: string;
  created_at: string;
  updated_at: string;
}

function rowToEpisode(row: EpisodeRow): Episode {
  const data = EpisodeSchema.parse({ ...parseJson(row.data_json, {}), episode_number: row.episode_number, scenes: [] });
  const { scenes: _omit, ...rest } = data;
  void _omit;
  return { ...rest, id: row.id, series_id: row.series_id, created_at: row.created_at, updated_at: row.updated_at };
}

function serialize(data: Omit<EpisodeData, "scenes">): string {
  return JSON.stringify(data);
}

export function listEpisodes(seriesId: string): Episode[] {
  const rows = getDb()
    .prepare("SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_number")
    .all(seriesId) as EpisodeRow[];
  return rows.map(rowToEpisode);
}

export function getEpisode(id: number): Episode | null {
  const row = getDb().prepare("SELECT * FROM episodes WHERE id = ?").get(id) as EpisodeRow | undefined;
  return row ? rowToEpisode(row) : null;
}

export function getEpisodeByNumber(seriesId: string, episodeNumber: number): Episode | null {
  const row = getDb()
    .prepare("SELECT * FROM episodes WHERE series_id = ? AND episode_number = ?")
    .get(seriesId, episodeNumber) as EpisodeRow | undefined;
  return row ? rowToEpisode(row) : null;
}

export function nextEpisodeNumber(seriesId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(episode_number), 0) + 1 AS n FROM episodes WHERE series_id = ?")
    .get(seriesId) as { n: number };
  return row.n;
}

export function createEpisode(seriesId: string, input: EpisodeInput): Episode {
  const data = EpisodeSchema.parse(input);
  const db = getDb();
  const ts = now();
  const { scenes, ...rest } = data;
  const id = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO episodes (series_id, episode_number, title, status, mode, platform, target_duration, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(seriesId, rest.episode_number, rest.title, rest.status, rest.mode, rest.platform, rest.target_duration, serialize(rest), ts, ts);
    const episodeId = Number(info.lastInsertRowid);
    writeScenes(episodeId, scenes);
    return episodeId;
  })();
  return getEpisode(id)!;
}

export type EpisodePatch = Partial<Omit<EpisodeData, "scenes" | "episode_number">> & { episode_number?: number };

export function updateEpisode(id: number, patch: EpisodePatch): Episode {
  const current = getEpisode(id);
  if (!current) throw new Error(`Episode ${id} not found`);
  const { id: _id, series_id: _s, created_at: _c, updated_at: _u, ...data } = current;
  void _id;
  void _s;
  void _c;
  void _u;
  const merged = EpisodeSchema.parse({ ...data, ...patch, scenes: [] });
  const { scenes: _sc, ...rest } = merged;
  void _sc;
  getDb()
    .prepare(
      `UPDATE episodes SET episode_number=?, title=?, status=?, mode=?, platform=?, target_duration=?, data_json=?, updated_at=? WHERE id=?`,
    )
    .run(rest.episode_number, rest.title, rest.status, rest.mode, rest.platform, rest.target_duration, serialize(rest), now(), id);
  return getEpisode(id)!;
}

export function deleteEpisode(id: number) {
  getDb().prepare("DELETE FROM episodes WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

function writeScenes(episodeId: number, scenes: SceneInput[]) {
  const db = getDb();
  db.prepare("DELETE FROM scenes WHERE episode_id = ?").run(episodeId);
  const stmt = db.prepare(
    `INSERT INTO scenes (episode_id, scene_id, sort_order, beat, duration, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const ts = now();
  scenes.forEach((input, index) => {
    const scene = SceneSchema.parse(input);
    stmt.run(episodeId, scene.scene_id, index, scene.beat, scene.duration, JSON.stringify(scene), ts);
  });
}

export function listScenes(episodeId: number): Scene[] {
  const rows = getDb()
    .prepare("SELECT data_json FROM scenes WHERE episode_id = ? ORDER BY sort_order")
    .all(episodeId) as { data_json: string }[];
  return rows.map((r) => SceneSchema.parse(parseJson(r.data_json, {})));
}

export function getScene(episodeId: number, sceneId: string): Scene | null {
  const row = getDb()
    .prepare("SELECT data_json FROM scenes WHERE episode_id = ? AND scene_id = ?")
    .get(episodeId, sceneId) as { data_json: string } | undefined;
  return row ? SceneSchema.parse(parseJson(row.data_json, {})) : null;
}

export function replaceScenes(episodeId: number, scenes: SceneInput[]) {
  const db = getDb();
  db.transaction(() => writeScenes(episodeId, scenes))();
  db.prepare("UPDATE episodes SET updated_at = ? WHERE id = ?").run(now(), episodeId);
}

export function saveScene(episodeId: number, input: SceneInput): Scene {
  const scene = SceneSchema.parse(input);
  const db = getDb();
  const res = db
    .prepare("UPDATE scenes SET beat=?, duration=?, data_json=?, updated_at=? WHERE episode_id=? AND scene_id=?")
    .run(scene.beat, scene.duration, JSON.stringify(scene), now(), episodeId, scene.scene_id);
  if (res.changes === 0) {
    const order = (
      db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM scenes WHERE episode_id = ?").get(episodeId) as {
        n: number;
      }
    ).n;
    db.prepare(
      `INSERT INTO scenes (episode_id, scene_id, sort_order, beat, duration, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(episodeId, scene.scene_id, order, scene.beat, scene.duration, JSON.stringify(scene), now());
  }
  db.prepare("UPDATE episodes SET updated_at = ? WHERE id = ?").run(now(), episodeId);
  return scene;
}

export function deleteScene(episodeId: number, sceneId: string) {
  getDb().prepare("DELETE FROM scenes WHERE episode_id = ? AND scene_id = ?").run(episodeId, sceneId);
}

export function reorderScenes(episodeId: number, sceneIds: string[]) {
  const db = getDb();
  const stmt = db.prepare("UPDATE scenes SET sort_order = ? WHERE episode_id = ? AND scene_id = ?");
  db.transaction(() => sceneIds.forEach((sid, i) => stmt.run(i, episodeId, sid)))();
}

/** Full episode document (the shape of data/series/<id>/episodes/episode_NNN.json). */
export function getEpisodeData(id: number): EpisodeData | null {
  const episode = getEpisode(id);
  if (!episode) return null;
  const { id: _i, series_id: _s, created_at: _c, updated_at: _u, ...rest } = episode;
  void _i;
  void _s;
  void _c;
  void _u;
  return EpisodeSchema.parse({ ...rest, scenes: listScenes(id) });
}
