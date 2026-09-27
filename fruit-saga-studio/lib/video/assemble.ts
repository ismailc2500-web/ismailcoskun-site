import fs from "node:fs";
import path from "node:path";
import { FPS, paths as appPaths, RESOLUTIONS, type RenderMode } from "@/lib/config";
import type { Episode, Scene, Series, Timeline } from "@/lib/types";
import { ffprobe, escapeFilterValue, runFfmpeg } from "@/lib/video/ffmpeg";
import { renderMotionClip } from "@/lib/video/motion";
import { renderArtPng, artSceneForCard } from "@/lib/ai/mock/art";
import { transitionSpec } from "@/lib/prompts/vocabulary";
import type { Aspect } from "@/lib/prompts/engine";
import { ensureDir, type EpisodePaths } from "@/lib/pipeline/paths";

/**
 * STAGE 8 — assembly with FFmpeg:
 *   1. normalise every clip (scale/crop, 30 fps, trim or slow-mo/hold to length)
 *   2. build the master on the timeline: xfade transitions or hard cuts, optional
 *      intro/outro cards, film finishing (grain, vignette, contrast)
 *   3. deliverables: 9:16 and 16:9 with burned-in subtitles + the final mix
 */

export interface AssembleInput {
  series: Series;
  episode: Episode & { timeline: Timeline };
  scenes: Scene[];
  clipPaths: Map<string, string>;
  mixPath: string;
  paths: EpisodePaths;
  mode: RenderMode;
  aspect: Aspect;
  onProgress?: (fraction: number, label: string) => void;
}

interface Segment {
  file: string;
  length: number;
  xfade: string | null;
  transOut: number;
}

/** Bump when encoder settings change so cached assemblies are rebuilt. */
export const ENCODER_VERSION = 2;

const enc = (mode: RenderMode, purpose: "intermediate" | "master" | "delivery") => {
  if (mode === "preview") {
    return purpose === "delivery"
      ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-maxrate", "3M", "-bufsize", "6M", "-profile:v", "high"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "22"];
  }
  // Deliveries are capped at 10 Mbps (above what Shorts/TikTok/Reels keep after their own re-encode):
  // film grain is nearly incompressible and would otherwise balloon the file size.
  return purpose === "delivery"
    ? ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-maxrate", "10M", "-bufsize", "20M", "-profile:v", "high"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "15"];
};

async function normalizeClip(src: string, out: string, length: number, W: number, H: number, mode: RenderMode, logFile: string) {
  const probe = await ffprobe(src);
  const srcDur = probe.duration || length;
  const vf = [`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, "setsar=1"];
  if (srcDur + 0.04 < length) {
    const ratio = length / srcDur;
    if (ratio <= 1.6) vf.push(`setpts=${ratio.toFixed(4)}*PTS`);
    else {
      vf.push("setpts=1.6*PTS");
      vf.push(`tpad=stop_mode=clone:stop_duration=${(length - srcDur * 1.6 + 0.2).toFixed(3)}`);
    }
  }
  vf.push(`fps=${FPS}`, "format=yuv420p");
  await runFfmpeg(["-i", src, "-vf", vf.join(","), "-t", length.toFixed(3), "-an", ...enc(mode, "intermediate"), "-r", String(FPS), out], { logFile });
}

async function cardSegment(
  kind: "intro" | "outro",
  input: AssembleInput,
  W: number,
  H: number,
  length: number,
  out: string,
  logFile: string,
): Promise<void> {
  const s = input.series.settings[kind];
  const custom = s.video_path ? (path.isAbsolute(s.video_path) ? s.video_path : path.join(appPaths.root, s.video_path)) : "";
  if (custom && fs.existsSync(custom)) {
    await normalizeClip(custom, out, length, W, H, input.mode, logFile);
    return;
  }
  const ep = input.episode;
  const title = kind === "intro" ? s.text || input.series.title.toUpperCase() : s.text || "FOLLOW FOR THE NEXT EPISODE";
  const subtitle =
    kind === "intro"
      ? `EPISODE ${ep.episode_number} · ${ep.title.toUpperCase()}`
      : (ep.metadata.next_episode_teaser || ep.next_episode_tease || `EPISODE ${ep.episode_number + 1} COMING SOON`).slice(0, 70);
  const png = path.join(path.dirname(out), `${kind}_card.png`);
  fs.writeFileSync(png, await renderArtPng(artSceneForCard(title, subtitle, { sky: "#1d2433", ground: "#141414", accent: "#f5b642" }, W, H)));
  await renderMotionClip({ imagePath: png, outPath: out, width: W, height: H, duration: length, fps: FPS, movement: "slow push-in", preview: input.mode === "preview" });
}

function finishingFilter(series: Series): string {
  const f = ["eq=contrast=1.05:saturation=1.06"];
  if (series.settings.finishing.vignette) f.push("vignette=angle=PI/5");
  if (series.settings.finishing.film_grain) f.push("noise=alls=4:allf=t");
  f.push("format=yuv420p");
  return f.join(",");
}

function subtitleFilter(assFile: string): string {
  const fontsDir = fs.existsSync(appPaths.fonts) && fs.readdirSync(appPaths.fonts).some((f) => /\.(ttf|otf)$/i.test(f)) ? appPaths.fonts : "";
  return `ass=filename=${escapeFilterValue(assFile)}${fontsDir ? `:fontsdir=${escapeFilterValue(fontsDir)}` : ""}`;
}

/** Reframes the master into the other aspect ratio (blurred-fill or crop). */
function reframeFilter(fromAspect: Aspect, strategy: "blur" | "crop", W: number, H: number): string {
  if (fromAspect === "9:16") {
    // vertical → landscape
    return strategy === "crop"
      ? `scale=${W}:-2,crop=${W}:${H}:0:(ih-${H})*0.35`
      : `split=2[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=40,eq=brightness=-0.12:saturation=0.85[bg];[b]scale=-2:${H}[fg];[bg][fg]overlay=(W-w)/2:0`;
  }
  return strategy === "crop"
    ? `scale=-2:${H},crop=${W}:${H}`
    : `split=2[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=40,eq=brightness=-0.12:saturation=0.85[bg];[b]scale=${W}:-2[fg];[bg][fg]overlay=0:(H-h)/2`;
}

export interface AssembleResult {
  vertical: string;
  landscape: string;
  master: string;
  duration: number;
}

export async function assembleEpisode(input: AssembleInput): Promise<AssembleResult> {
  const { episode, scenes, mode, paths, series } = input;
  const timeline = episode.timeline;
  const logFile = paths.log;
  const renderDir = ensureDir(paths.render);
  const primary = RESOLUTIONS[mode][input.aspect === "9:16" ? "vertical" : "landscape"];
  const { width: W, height: H } = primary;
  const progress = (f: number, label: string) => input.onProgress?.(Math.min(1, Math.max(0, f)), label);

  // 1. Segments (intro, scenes, outro) with the overlap each transition needs.
  const segments: Segment[] = [];
  if (timeline.intro_duration > 0) {
    const file = path.join(renderDir, "intro.mp4");
    const T = 0.4;
    await cardSegment("intro", input, W, H, timeline.intro_duration + T, file, logFile);
    segments.push({ file, length: timeline.intro_duration + T, xfade: "fade", transOut: T });
  }
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const t = timeline.scenes.find((s) => s.scene_id === scene.scene_id);
    const src = input.clipPaths.get(scene.scene_id);
    if (!t || !src) throw new Error(`Missing clip or timeline entry for ${scene.scene_id}`);
    const spec = transitionSpec(scene.transition);
    const transOut = t.transition_duration > 0 && spec.xfade ? t.transition_duration : 0;
    const length = Math.round((t.duration + transOut) * 1000) / 1000;
    const out = path.join(renderDir, `norm_${scene.scene_id}.mp4`);
    progress((i / scenes.length) * 0.45, `Normalising ${scene.scene_id}`);
    await normalizeClip(src, out, length, W, H, mode, logFile);
    segments.push({ file: out, length, xfade: transOut ? spec.xfade : null, transOut });
  }
  if (timeline.outro_duration > 0) {
    const file = path.join(renderDir, "outro.mp4");
    await cardSegment("outro", input, W, H, timeline.outro_duration, file, logFile);
    segments.push({ file, length: timeline.outro_duration, xfade: null, transOut: 0 });
  }

  // 2. Master: chain xfades / concats so each shot starts exactly at its timeline position.
  progress(0.5, "Building master");
  const filters: string[] = segments.map((_, i) => `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[s${i}]`);
  let acc = "s0";
  let accLen = segments[0].length;
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const label = `x${i}`;
    if (prev.xfade && prev.transOut > 0) {
      const offset = Math.max(0, accLen - prev.transOut);
      filters.push(`[${acc}][s${i}]xfade=transition=${prev.xfade}:duration=${prev.transOut.toFixed(3)}:offset=${offset.toFixed(3)}[${label}]`);
      accLen = offset + segments[i].length;
    } else {
      filters.push(`[${acc}][s${i}]concat=n=2:v=1:a=0[${label}]`);
      accLen += segments[i].length;
    }
    acc = label;
  }
  filters.push(`[${acc}]${finishingFilter(series)}[vout]`);
  const master = path.join(renderDir, "master.mp4");
  const total = timeline.total_duration;
  await runFfmpeg(
    [...segments.flatMap((s) => ["-i", s.file]), "-filter_complex", filters.join(";"), "-map", "[vout]", "-t", total.toFixed(3), ...enc(mode, "master"), "-r", String(FPS), master],
    { logFile, onProgress: (sec) => progress(0.5 + (sec / total) * 0.15, "Building master") },
  );

  // 3. Deliverables.
  const burn = series.settings.subtitles.burn_in;
  const audioArgs = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"];
  const common = ["-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", total.toFixed(3)];
  const verticalRes = RESOLUTIONS[mode].vertical;
  const landscapeRes = RESOLUTIONS[mode].landscape;

  const renderOne = async (target: "vertical" | "landscape", out: string, from: number, span: number) => {
    const res = target === "vertical" ? verticalRes : landscapeRes;
    const needsReframe = (input.aspect === "9:16") !== (target === "vertical");
    const chain: string[] = [];
    if (needsReframe) chain.push(reframeFilter(input.aspect, series.settings.landscape_strategy, res.width, res.height));
    const ass = target === "vertical" ? paths.assVertical : paths.assLandscape;
    let graph = `[0:v]${chain.length ? chain.join(",") : "null"}[base]`;
    graph += burn && fs.existsSync(ass) ? `;[base]${subtitleFilter(ass)}[v]` : ";[base]null[v]";
    await runFfmpeg(
      ["-i", master, "-i", input.mixPath, "-filter_complex", graph, "-map", "[v]", "-map", "1:a", ...enc(mode, "delivery"), ...audioArgs, ...common, out],
      { logFile, onProgress: (sec) => progress(from + (sec / total) * span, `Rendering ${target}`) },
    );
  };
  await renderOne("vertical", paths.finalVertical, 0.65, 0.17);
  await renderOne("landscape", paths.finalLandscape, 0.82, 0.17);
  progress(1, "Done");
  const probe = await ffprobe(paths.finalVertical);
  return { vertical: paths.finalVertical, landscape: paths.finalLandscape, master, duration: probe.duration };
}
