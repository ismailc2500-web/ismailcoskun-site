import fs from "node:fs";
import path from "node:path";
import { getDb, now, parseJson } from "@/lib/db";
import { paths } from "@/lib/config";
import type { Asset, AssetKind } from "@/lib/types";

interface AssetRow {
  id: number;
  episode_id: number | null;
  scene_id: string | null;
  kind: AssetKind;
  variant: string;
  path: string;
  cache_key: string | null;
  provider: string | null;
  model: string | null;
  cost: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  meta_json: string;
  created_at: string;
}

const toAsset = (r: AssetRow): Asset => ({ ...r, meta: parseJson(r.meta_json, {}) });

/** Paths are stored relative to the project root so the database is portable. */
export const toRelative = (abs: string) => path.relative(paths.root, abs).split(path.sep).join("/");
export const toAbsolute = (rel: string) => (path.isAbsolute(rel) ? rel : path.join(paths.root, rel));

export interface NewAsset {
  episode_id: number | null;
  scene_id?: string | null;
  kind: AssetKind;
  variant: string;
  path: string;
  cache_key?: string | null;
  provider?: string | null;
  model?: string | null;
  cost?: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  meta?: Record<string, unknown>;
}

export function addAsset(a: NewAsset): Asset {
  const db = getDb();
  const rel = path.isAbsolute(a.path) ? toRelative(a.path) : a.path;
  const id = db.transaction(() => {
    db.prepare(
      `UPDATE assets SET is_current = 0 WHERE episode_id IS ? AND scene_id IS ? AND kind = ? AND variant = ?`,
    ).run(a.episode_id, a.scene_id ?? null, a.kind, a.variant);
    const info = db
      .prepare(
        `INSERT INTO assets (episode_id, scene_id, kind, variant, path, cache_key, provider, model, cost, width, height, duration, meta_json, is_current, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        a.episode_id,
        a.scene_id ?? null,
        a.kind,
        a.variant,
        rel,
        a.cache_key ?? null,
        a.provider ?? null,
        a.model ?? null,
        a.cost ?? 0,
        a.width ?? null,
        a.height ?? null,
        a.duration ?? null,
        JSON.stringify(a.meta ?? {}),
        now(),
      );
    return Number(info.lastInsertRowid);
  })();
  return toAsset(db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow);
}

export function getCurrentAsset(episodeId: number, kind: AssetKind, variant: string, sceneId: string | null = null): Asset | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM assets WHERE episode_id = ? AND kind = ? AND variant = ? AND scene_id IS ? AND is_current = 1 ORDER BY id DESC LIMIT 1`,
    )
    .get(episodeId, kind, variant, sceneId) as AssetRow | undefined;
  if (!row) return null;
  const asset = toAsset(row);
  return fs.existsSync(toAbsolute(asset.path)) ? asset : null;
}

export function listAssets(episodeId: number, opts: { currentOnly?: boolean; variant?: string } = {}): Asset[] {
  const clauses = ["episode_id = ?"];
  const args: unknown[] = [episodeId];
  if (opts.currentOnly) clauses.push("is_current = 1");
  if (opts.variant) {
    clauses.push("variant = ?");
    args.push(opts.variant);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM assets WHERE ${clauses.join(" AND ")} ORDER BY id`)
    .all(...args) as AssetRow[];
  return rows.map(toAsset);
}

export function episodeSpend(episodeId: number): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(actual_cost), 0) AS total FROM generation_jobs WHERE episode_id = ?")
    .get(episodeId) as { total: number };
  return row.total;
}

// ---------------------------------------------------------------------------
// Content-addressed generation cache
// ---------------------------------------------------------------------------

export interface CacheEntry {
  cache_key: string;
  kind: string;
  path: string;
  provider: string;
  model: string | null;
  cost: number;
  meta: Record<string, unknown>;
  hits: number;
}

export function getCached(key: string): CacheEntry | null {
  const row = getDb().prepare("SELECT * FROM asset_cache WHERE cache_key = ?").get(key) as
    | (Omit<CacheEntry, "meta"> & { meta_json: string })
    | undefined;
  if (!row) return null;
  if (!fs.existsSync(toAbsolute(row.path))) {
    getDb().prepare("DELETE FROM asset_cache WHERE cache_key = ?").run(key);
    return null;
  }
  return { ...row, meta: parseJson(row.meta_json, {}) };
}

export function hasCached(key: string): boolean {
  return getCached(key) !== null;
}

export function touchCached(key: string) {
  getDb().prepare("UPDATE asset_cache SET hits = hits + 1, last_used_at = ? WHERE cache_key = ?").run(now(), key);
}

export function putCached(entry: Omit<CacheEntry, "hits">) {
  const rel = path.isAbsolute(entry.path) ? toRelative(entry.path) : entry.path;
  getDb()
    .prepare(
      `INSERT INTO asset_cache (cache_key, kind, path, provider, model, cost, meta_json, hits, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET path=excluded.path, cost=excluded.cost, meta_json=excluded.meta_json, last_used_at=excluded.last_used_at`,
    )
    .run(entry.cache_key, entry.kind, rel, entry.provider, entry.model, entry.cost, JSON.stringify(entry.meta), now(), now());
}

export function cacheStats() {
  const rows = getDb()
    .prepare("SELECT kind, COUNT(*) AS entries, SUM(hits) AS hits, SUM(cost * hits) AS saved FROM asset_cache GROUP BY kind")
    .all() as { kind: string; entries: number; hits: number | null; saved: number | null }[];
  return rows.map((r) => ({ kind: r.kind, entries: r.entries, hits: r.hits ?? 0, savedUsd: r.saved ?? 0 }));
}

export function clearCache(kind?: string) {
  const db = getDb();
  const rows = (kind
    ? db.prepare("SELECT path FROM asset_cache WHERE kind = ?").all(kind)
    : db.prepare("SELECT path FROM asset_cache").all()) as { path: string }[];
  for (const r of rows) {
    try {
      fs.rmSync(toAbsolute(r.path), { force: true });
    } catch {
      /* ignore */
    }
  }
  if (kind) db.prepare("DELETE FROM asset_cache WHERE kind = ?").run(kind);
  else db.prepare("DELETE FROM asset_cache").run();
  return rows.length;
}
