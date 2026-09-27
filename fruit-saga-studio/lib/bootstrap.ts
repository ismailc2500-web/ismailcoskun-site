import fs from "node:fs";
import path from "node:path";
import { paths } from "@/lib/config";
import { closeDb, getDb } from "@/lib/db";
import { exportSeries, importSeriesDir, listSeriesDirs } from "@/lib/data-sync";
import { listEpisodes, listScenes, replaceScenes } from "@/lib/db/repos/episodes";
import { aspectForPlatform, promptContext } from "@/lib/context";
import { applyScenePrompts, buildThumbnailPrompts } from "@/lib/prompts/engine";
import { updateEpisode } from "@/lib/db/repos/episodes";

const g = globalThis as unknown as { __fruitSagaBooted?: boolean };

/**
 * Makes sure the database exists, is migrated and contains at least one
 * series. On a fresh install the JSON mirror in data/series/ is imported if
 * present (your own data), otherwise the demo series from data/seed/.
 */
export function ensureBootstrapped() {
  if (g.__fruitSagaBooted) return;
  const db = getDb();
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM series").get() as { n: number };
  if (n === 0) seedFromDisk();
  g.__fruitSagaBooted = true;
}

export function seedFromDisk(opts: { preferSeed?: boolean } = {}): string[] {
  const mirrors = listSeriesDirs(paths.series);
  const sources = !opts.preferSeed && mirrors.length ? mirrors : listSeriesDirs(paths.seed);
  const ids: string[] = [];
  for (const dir of sources) {
    const id = importSeriesDir(dir);
    fillMissingPrompts(id);
    exportSeries(id);
    ids.push(id);
  }
  return ids;
}

/** Seed episodes ship without prompts; compose them from the character bible. */
function fillMissingPrompts(seriesId: string) {
  for (const ep of listEpisodes(seriesId)) {
    const ctx = promptContext(seriesId, aspectForPlatform(ep.platform));
    const scenes = listScenes(ep.id);
    if (scenes.length && scenes.some((s) => !s.image_prompt || !s.video_prompt)) {
      replaceScenes(
        ep.id,
        scenes.map((s) => applyScenePrompts(s, ctx)),
      );
    }
    if (!ep.metadata.thumbnail_prompt_vertical && scenes.length) {
      const thumbs = buildThumbnailPrompts(ep.metadata, scenes, ctx);
      updateEpisode(ep.id, {
        metadata: { ...ep.metadata, thumbnail_prompt_vertical: thumbs.vertical, thumbnail_prompt_landscape: thumbs.landscape },
        status: ep.status === "shotlisted" ? "prompted" : ep.status,
      });
    }
  }
}

/**
 * Deletes the database (renders and the cache are kept) and re-imports.
 * With preferSeed the JSON mirror of the demo series is also reset to the
 * pristine seed; other series' mirrors are never touched.
 */
export function resetDatabase(opts: { preferSeed?: boolean } = {}) {
  closeDb();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(paths.db + suffix, { force: true });
  if (opts.preferSeed) {
    for (const dir of listSeriesDirs(paths.seed)) fs.rmSync(path.join(paths.series, path.basename(dir)), { recursive: true, force: true });
  }
  g.__fruitSagaBooted = false;
  getDb();
  const ids = seedFromDisk(opts);
  g.__fruitSagaBooted = true;
  return ids;
}
