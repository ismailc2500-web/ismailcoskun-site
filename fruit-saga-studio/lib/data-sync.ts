import fs from "node:fs";
import path from "node:path";
import { episodeDirName, seriesDir } from "@/lib/config";
import {
  getLatestState,
  getSeries,
  listCharacters,
  listLocations,
  listSnapshots,
  putSnapshot,
  saveCharacter,
  saveLocation,
  upsertSeries,
} from "@/lib/db/repos/series";
import {
  createEpisode,
  getEpisode,
  getEpisodeByNumber,
  getEpisodeData,
  listEpisodes,
  replaceScenes,
  updateEpisode,
} from "@/lib/db/repos/episodes";
import {
  CharacterSchema,
  EpisodeSchema,
  LocationSchema,
  SeriesSchema,
  SeriesStateSchema,
} from "@/lib/types";

/**
 * SQLite is the source of truth while the app runs. Every content change is
 * mirrored to human-readable JSON under data/series/<series-id>/:
 *
 *   series.json, characters.json (the character bible), locations.json,
 *   series_state.json (latest continuity), continuity/after_episode_NNN.json,
 *   episodes/episode_NNN.json
 *
 * The mirror can be committed to git and re-imported with `npm run db:reset`.
 */

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export function readJson<T = unknown>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function exportSeriesMeta(seriesId: string) {
  const series = getSeries(seriesId);
  if (!series) return;
  const dir = seriesDir(seriesId);
  writeJson(path.join(dir, "series.json"), series);
  writeJson(path.join(dir, "characters.json"), listCharacters(seriesId));
  writeJson(path.join(dir, "locations.json"), listLocations(seriesId));
}

export function exportContinuity(seriesId: string) {
  const dir = seriesDir(seriesId);
  writeJson(path.join(dir, "series_state.json"), getLatestState(seriesId));
  for (const snap of listSnapshots(seriesId)) {
    writeJson(path.join(dir, "continuity", `after_episode_${String(snap.as_of_episode).padStart(3, "0")}.json`), snap);
  }
}

export function exportEpisode(episodeId: number) {
  const episode = getEpisode(episodeId);
  const data = episode ? getEpisodeData(episodeId) : null;
  if (!episode || !data) return;
  writeJson(path.join(seriesDir(episode.series_id), "episodes", `${episodeDirName(episode.episode_number)}.json`), data);
}

export function removeEpisodeFile(seriesId: string, episodeNumber: number) {
  const file = path.join(seriesDir(seriesId), "episodes", `${episodeDirName(episodeNumber)}.json`);
  fs.rmSync(file, { force: true });
}

export function exportSeries(seriesId: string) {
  exportSeriesMeta(seriesId);
  exportContinuity(seriesId);
  for (const ep of listEpisodes(seriesId)) exportEpisode(ep.id);
}

/** Imports (or re-imports) a series folder — either a seed folder or a mirror folder. */
export function importSeriesDir(dir: string): string {
  const seriesRaw = readJson(path.join(dir, "series.json"));
  if (!seriesRaw) throw new Error(`No series.json in ${dir}`);
  const series = upsertSeries(SeriesSchema.parse(seriesRaw));

  const charsRaw = readJson<unknown>(path.join(dir, "characters.json"));
  const chars = Array.isArray(charsRaw)
    ? charsRaw
    : ((charsRaw as { characters?: unknown[] } | null)?.characters ?? []);
  chars.forEach((c, i) => saveCharacter(series.id, CharacterSchema.parse(c), i));

  const locsRaw = readJson<unknown>(path.join(dir, "locations.json"));
  const locs = Array.isArray(locsRaw) ? locsRaw : ((locsRaw as { locations?: unknown[] } | null)?.locations ?? []);
  locs.forEach((l, i) => saveLocation(series.id, LocationSchema.parse(l), i));

  // Continuity history first, then the latest state file (which wins for its episode).
  const contDir = path.join(dir, "continuity");
  if (fs.existsSync(contDir)) {
    for (const f of fs.readdirSync(contDir).filter((f) => f.endsWith(".json")).sort()) {
      const snap = SeriesStateSchema.parse({ series_id: series.id, ...(readJson<object>(path.join(contDir, f)) ?? {}) });
      putSnapshot(series.id, snap.as_of_episode, snap);
    }
  }
  const stateRaw = readJson<object>(path.join(dir, "series_state.json"));
  if (stateRaw) {
    const state = SeriesStateSchema.parse({ series_id: series.id, ...stateRaw });
    putSnapshot(series.id, state.as_of_episode, state);
  }

  const epDir = path.join(dir, "episodes");
  if (fs.existsSync(epDir)) {
    for (const f of fs.readdirSync(epDir).filter((f) => /^episode_\d+\.json$/.test(f)).sort()) {
      const data = EpisodeSchema.parse(readJson(path.join(epDir, f)));
      const existing = getEpisodeByNumber(series.id, data.episode_number);
      if (existing) {
        const { scenes, ...rest } = data;
        updateEpisode(existing.id, rest);
        replaceScenes(existing.id, scenes);
      } else {
        createEpisode(series.id, data);
      }
    }
  }
  return series.id;
}

export function listSeriesDirs(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "series.json")))
    .map((d) => path.join(root, d.name));
}
