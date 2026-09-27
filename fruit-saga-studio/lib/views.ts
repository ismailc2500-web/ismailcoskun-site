import fs from "node:fs";
import { getEpisode, listEpisodes, listScenes } from "@/lib/db/repos/episodes";
import { getLatestState, getSeries, listCharacters, listLocations } from "@/lib/db/repos/series";
import { episodeSpend, listAssets, toAbsolute, toRelative } from "@/lib/db/repos/assets";
import { latestJobsPerUnit, listJobs, latestRunId } from "@/lib/db/repos/jobs";
import { activeRun } from "@/lib/pipeline/runner";
import { episodePaths } from "@/lib/pipeline/paths";
import { aspectForPlatform } from "@/lib/context";
import { spokenWords } from "@/lib/prompts/formatters";
import type { Asset } from "@/lib/types";
import { HttpError } from "@/lib/services";

/** Read models assembled for the UI (one request per page refresh / poll). */

export const mediaUrl = (a: Pick<Asset, "path" | "id">) => `/api/files/${a.path}?v=${a.id}`;

export function episodeView(episodeId: number) {
  const episode = getEpisode(episodeId);
  if (!episode) throw new HttpError(404, `Episode ${episodeId} not found`);
  const series = getSeries(episode.series_id)!;
  const scenes = listScenes(episodeId);
  const assets = listAssets(episodeId, { currentOnly: true })
    .filter((a) => fs.existsSync(toAbsolute(a.path)))
    .map((a) => ({ ...a, url: mediaUrl(a) }));
  const runId = latestRunId(episodeId);
  const run = activeRun(episodeId);
  const previousEpisode = listEpisodes(series.id).filter((e) => e.episode_number < episode.episode_number).pop() ?? null;
  const outPaths = episodePaths(series.id, episode.episode_number, episode.mode);
  return {
    episode,
    series,
    scenes,
    characters: listCharacters(series.id),
    locations: listLocations(series.id),
    aspect: aspectForPlatform(episode.platform),
    assets,
    units: latestJobsPerUnit(episodeId),
    runJobs: runId ? listJobs(episodeId, { runId }).reverse() : [],
    run,
    spend: episodeSpend(episodeId),
    words: spokenWords(scenes.length ? scenes : episode.beats),
    previousEpisode: previousEpisode
      ? { id: previousEpisode.id, episode_number: previousEpisode.episode_number, title: previousEpisode.title, continuity_committed: previousEpisode.continuity_committed }
      : null,
    outputDir: outPaths.dir,
    logUrl: fs.existsSync(outPaths.log) ? `/api/files/${toRelative(outPaths.log)}` : null,
  };
}

export type EpisodeView = ReturnType<typeof episodeView>;

export function seriesOverview(seriesId: string) {
  const series = getSeries(seriesId);
  if (!series) throw new HttpError(404, `Series "${seriesId}" not found`);
  const episodes = listEpisodes(seriesId).map((e) => {
    const assets = listAssets(e.id, { currentOnly: true });
    const pick = (kind: Asset["kind"]) => {
      const a = assets.filter((x) => x.kind === kind && fs.existsSync(toAbsolute(x.path))).pop();
      return a ? { ...a, url: mediaUrl(a) } : null;
    };
    const units = latestJobsPerUnit(e.id);
    return {
      id: e.id,
      episode_number: e.episode_number,
      title: e.title,
      synopsis: e.synopsis,
      status: e.status,
      mode: e.mode,
      platform: e.platform,
      duration: e.timeline?.total_duration ?? null,
      target_duration: e.target_duration,
      continuity_committed: e.continuity_committed,
      thumbnail: pick("thumbnail_vertical"),
      renderVertical: pick("render_vertical"),
      renderLandscape: pick("render_landscape"),
      failedJobs: units.filter((u) => u.status === "failed").length,
      running: Boolean(activeRun(e.id)),
      spend: episodeSpend(e.id),
      updated_at: e.updated_at,
    };
  });
  return { series, episodes, characters: listCharacters(seriesId), state: getLatestState(seriesId) };
}
