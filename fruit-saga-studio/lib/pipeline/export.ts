import fs from "node:fs";
import path from "node:path";
import type { RenderMode } from "@/lib/config";
import { PLATFORMS, type Episode, type Platform, type Scene, type Series } from "@/lib/types";
import { episodePaths, ensureDir, placeFile, type EpisodePaths } from "@/lib/pipeline/paths";
import { getCurrentAsset, toAbsolute } from "@/lib/db/repos/assets";
import { saveEpisodeFeatures } from "@/lib/db/repos/settings";

/** Social metadata as ready-to-paste text files + per-platform export packages. */

export function writeMetadataFiles(episode: Episode, series: Series, paths: EpisodePaths) {
  const m = episode.metadata;
  const dir = ensureDir(paths.metadata);
  const tags = m.hashtags.join(" ");
  fs.writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ series: series.title, episode: episode.episode_number, title: episode.title, hook: episode.hook, cliffhanger: episode.cliffhanger, ...m }, null, 2));
  fs.writeFileSync(path.join(dir, "youtube_shorts.txt"), `${m.youtube_title}\n\n${m.youtube_description}\n\n${tags}\n`);
  fs.writeFileSync(path.join(dir, "youtube.txt"), `${m.youtube_title.replace(/\s*#Shorts/i, "")}\n\n${m.youtube_description}\n\n${tags.replace(/#Shorts\s*/i, "")}\n`);
  fs.writeFileSync(path.join(dir, "tiktok.txt"), `${m.tiktok_caption}\n\n${tags}\n`);
  fs.writeFileSync(path.join(dir, "instagram.txt"), `${m.instagram_caption}\n\n${tags}\n`);
  fs.writeFileSync(
    path.join(dir, "thumbnail.txt"),
    `TEXT: ${m.thumbnail_text}\nCONCEPT: ${m.thumbnail_concept}\n\n--- 9:16 PROMPT ---\n${m.thumbnail_prompt_vertical}\n\n--- 16:9 PROMPT ---\n${m.thumbnail_prompt_landscape}\n`,
  );
  fs.writeFileSync(path.join(dir, "next_episode_teaser.txt"), `${m.next_episode_teaser}\n`);
}

export interface PlatformExport {
  platform: Platform;
  video: string;
  caption: string;
  thumbnail: string | null;
}

export function exportPlatforms(episode: Episode, scenes: Scene[], platforms: Platform[], mode: RenderMode): PlatformExport[] {
  const paths = episodePaths(episode.series_id, episode.episode_number, mode);
  const vertical = getCurrentAsset(episode.id, "render_vertical", mode);
  const landscape = getCurrentAsset(episode.id, "render_landscape", mode);
  if (!vertical || !landscape) throw new Error(`No ${mode} render found — render the episode first.`);
  const m = episode.metadata;
  const tags = m.hashtags.join(" ");
  const base = `${episode.series_id}_ep${String(episode.episode_number).padStart(3, "0")}`;
  const results: PlatformExport[] = [];
  for (const platform of platforms.filter((p) => PLATFORMS.includes(p))) {
    const dir = ensureDir(path.join(paths.exports, platform));
    const isLandscape = platform === "youtube";
    const video = placeFile(toAbsolute((isLandscape ? landscape : vertical).path), path.join(dir, `${base}_${platform}.mp4`));
    const caption =
      platform === "tiktok"
        ? `${m.tiktok_caption}\n\n${tags}`
        : platform === "instagram_reels"
          ? `${m.instagram_caption}\n\n${tags}`
          : `TITLE:\n${isLandscape ? m.youtube_title.replace(/\s*#Shorts/i, "") : m.youtube_title}\n\nDESCRIPTION:\n${m.youtube_description}\n\n${isLandscape ? tags.replace(/#Shorts\s*/i, "") : tags}`;
    const captionFile = path.join(dir, "caption.txt");
    fs.writeFileSync(captionFile, caption + "\n");
    const thumbAsset = getCurrentAsset(episode.id, isLandscape ? "thumbnail_landscape" : "thumbnail_vertical", mode);
    const thumbnail = thumbAsset ? placeFile(toAbsolute(thumbAsset.path), path.join(dir, `${base}_${platform}_thumbnail.png`)) : null;
    results.push({ platform, video, caption: captionFile, thumbnail });
  }
  saveEpisodeFeatures({
    episode_id: episode.id,
    hook: episode.hook,
    title: m.youtube_title || episode.title,
    duration: episode.timeline?.total_duration ?? scenes.reduce((s, x) => s + x.duration, 0),
    scene_count: scenes.length,
    characters: [...new Set(scenes.flatMap((s) => s.characters))],
    framings: scenes.map((s) => s.camera_framing),
    locations: [...new Set(scenes.map((s) => s.location))],
  });
  return results;
}
