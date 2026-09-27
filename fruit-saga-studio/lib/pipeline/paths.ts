import fs from "node:fs";
import path from "node:path";
import { episodeOutputDir, type RenderMode } from "@/lib/config";

/**
 * Output layout of one episode:
 *
 *   output/<series>/episode_001/
 *     keyframes/s01.png  clips/s01.mp4
 *     audio/narration.wav  audio/music.wav  audio/sfx.wav  audio/mix.wav  audio/voice/*.wav
 *     subtitles/episode_001.srt  subtitles/episode_001_vertical.ass  subtitles/episode_001_landscape.ass
 *     thumbnails/thumbnail_vertical.png  thumbnails/thumbnail_youtube.png
 *     render/ (intermediate normalised clips, master)
 *     final_vertical.mp4  final_youtube.mp4      (final mode)
 *     preview_vertical.mp4  preview_youtube.mp4  (preview mode)
 *     metadata/  exports/  render.log
 */
export function episodePaths(seriesId: string, episodeNumber: number, mode: RenderMode) {
  const dir = episodeOutputDir(seriesId, episodeNumber);
  const code = `episode_${String(episodeNumber).padStart(3, "0")}`;
  const prefix = mode === "final" ? "final" : "preview";
  return {
    dir,
    code,
    keyframes: path.join(dir, "keyframes"),
    clips: path.join(dir, "clips"),
    audio: path.join(dir, "audio"),
    voice: path.join(dir, "audio", "voice"),
    narration: path.join(dir, "audio", "narration.wav"),
    music: path.join(dir, "audio", "music.wav"),
    sfx: path.join(dir, "audio", "sfx.wav"),
    mix: path.join(dir, "audio", "mix.wav"),
    subtitles: path.join(dir, "subtitles"),
    srt: path.join(dir, "subtitles", `${code}.srt`),
    assVertical: path.join(dir, "subtitles", `${code}_vertical.ass`),
    assLandscape: path.join(dir, "subtitles", `${code}_landscape.ass`),
    thumbnails: path.join(dir, "thumbnails"),
    render: path.join(dir, "render"),
    metadata: path.join(dir, "metadata"),
    exports: path.join(dir, "exports"),
    log: path.join(dir, "render.log"),
    finalVertical: path.join(dir, `${prefix}_vertical.mp4`),
    finalLandscape: path.join(dir, `${prefix}_youtube.mp4`),
  };
}

export type EpisodePaths = ReturnType<typeof episodePaths>;

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Copies a cached artefact into the episode folder (copy-on-write where the filesystem supports it). */
export function placeFile(src: string, dest: string) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
  return dest;
}
