import { getDb, now, parseJson } from "@/lib/db";
import type { EpisodeAnalytics, ProviderKind, ProviderSetting } from "@/lib/types";

// ---------------------------------------------------------------------------
// Provider configuration (Settings page). Env vars are the fallback.
// ---------------------------------------------------------------------------

interface ProviderRow {
  kind: ProviderKind;
  mode: "preview" | "final";
  provider: string;
  model: string;
  quality: string;
  pricing_json: string;
}

export function listProviderSettings(): ProviderSetting[] {
  const rows = getDb().prepare("SELECT * FROM provider_configs ORDER BY kind, mode").all() as ProviderRow[];
  return rows.map((r) => ({ ...r, pricing: parseJson(r.pricing_json, {}) }));
}

export function getProviderSetting(kind: ProviderKind, mode: "preview" | "final"): ProviderSetting | null {
  const row = getDb().prepare("SELECT * FROM provider_configs WHERE kind = ? AND mode = ?").get(kind, mode) as
    | ProviderRow
    | undefined;
  return row ? { ...row, pricing: parseJson(row.pricing_json, {}) } : null;
}

export function saveProviderSetting(s: ProviderSetting) {
  getDb()
    .prepare(
      `INSERT INTO provider_configs (kind, mode, provider, model, quality, pricing_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, mode) DO UPDATE SET provider=excluded.provider, model=excluded.model, quality=excluded.quality,
         pricing_json=excluded.pricing_json, updated_at=excluded.updated_at`,
    )
    .run(s.kind, s.mode, s.provider, s.model, s.quality, JSON.stringify(s.pricing ?? {}), now());
}

export function deleteProviderSetting(kind: ProviderKind, mode: "preview" | "final") {
  getDb().prepare("DELETE FROM provider_configs WHERE kind = ? AND mode = ?").run(kind, mode);
}

// ---------------------------------------------------------------------------
// Generic key/value settings
// ---------------------------------------------------------------------------

export function getAppSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  return row ? parseJson<T>(row.value_json, fallback) : fallback;
}

export function setAppSetting(key: string, value: unknown) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), now());
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

interface AnalyticsRow extends Omit<EpisodeAnalytics, "retention"> {
  retention_json: string;
}

export type NewAnalytics = Omit<EpisodeAnalytics, "id" | "captured_at"> & { captured_at?: string };

export function addAnalytics(a: NewAnalytics): EpisodeAnalytics {
  const info = getDb()
    .prepare(
      `INSERT INTO episode_analytics (episode_id, platform, captured_at, views, likes, comments, shares, saves, avg_watch_seconds,
         completion_rate, ctr, followers_gained, retention_json, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.episode_id,
      a.platform,
      a.captured_at ?? now(),
      a.views,
      a.likes,
      a.comments,
      a.shares,
      a.saves,
      a.avg_watch_seconds,
      a.completion_rate,
      a.ctr,
      a.followers_gained,
      JSON.stringify(a.retention ?? []),
      a.notes ?? "",
    );
  const row = getDb().prepare("SELECT * FROM episode_analytics WHERE id = ?").get(Number(info.lastInsertRowid)) as AnalyticsRow;
  return { ...row, retention: parseJson(row.retention_json, []) };
}

export function listAnalytics(episodeId: number): EpisodeAnalytics[] {
  const rows = getDb()
    .prepare("SELECT * FROM episode_analytics WHERE episode_id = ? ORDER BY captured_at DESC")
    .all(episodeId) as AnalyticsRow[];
  return rows.map((r) => ({ ...r, retention: parseJson(r.retention_json, []) }));
}

export interface EpisodePerformance {
  episode_id: number;
  episode_number: number;
  title: string;
  hook: string;
  duration: number;
  characters: string[];
  views: number;
  likes: number;
  completion_rate: number;
  avg_watch_seconds: number;
  ctr: number;
  followers_gained: number;
}

/** Latest capture per episode+platform summed per episode, joined with the episode's features. */
export function seriesPerformance(seriesId: string): EpisodePerformance[] {
  const rows = getDb()
    .prepare(
      `WITH latest AS (
         SELECT a.* FROM episode_analytics a
         WHERE a.id IN (SELECT MAX(id) FROM episode_analytics GROUP BY episode_id, platform)
       )
       SELECT e.id AS episode_id, e.episode_number, e.title,
              COALESCE(f.hook, '') AS hook, COALESCE(f.duration, 0) AS duration, COALESCE(f.characters_json, '[]') AS characters_json,
              SUM(l.views) AS views, SUM(l.likes) AS likes,
              AVG(l.completion_rate) AS completion_rate, AVG(l.avg_watch_seconds) AS avg_watch_seconds,
              AVG(l.ctr) AS ctr, SUM(l.followers_gained) AS followers_gained
       FROM episodes e
       JOIN latest l ON l.episode_id = e.id
       LEFT JOIN episode_features f ON f.episode_id = e.id
       WHERE e.series_id = ?
       GROUP BY e.id ORDER BY e.episode_number`,
    )
    .all(seriesId) as (Omit<EpisodePerformance, "characters"> & { characters_json: string })[];
  return rows.map(({ characters_json, ...r }) => ({ ...r, characters: parseJson(characters_json, []) }));
}

export function saveEpisodeFeatures(f: {
  episode_id: number;
  hook: string;
  title: string;
  duration: number;
  scene_count: number;
  characters: string[];
  framings: string[];
  locations: string[];
}) {
  getDb()
    .prepare(
      `INSERT INTO episode_features (episode_id, hook, title, duration, scene_count, characters_json, framings_json, locations_json, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(episode_id) DO UPDATE SET hook=excluded.hook, title=excluded.title, duration=excluded.duration,
         scene_count=excluded.scene_count, characters_json=excluded.characters_json, framings_json=excluded.framings_json,
         locations_json=excluded.locations_json, captured_at=excluded.captured_at`,
    )
    .run(
      f.episode_id,
      f.hook,
      f.title,
      f.duration,
      f.scene_count,
      JSON.stringify(f.characters),
      JSON.stringify(f.framings),
      JSON.stringify(f.locations),
      now(),
    );
}
