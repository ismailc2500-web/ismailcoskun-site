import type { SoundPlan } from "@/lib/types";
import { runFfmpeg } from "@/lib/video/ffmpeg";
import { SAMPLE_RATE } from "@/lib/audio/convert";
import { musicFile, sfxFile } from "@/lib/audio/synth";

/**
 * STAGE 6 (render) — builds music.wav and sfx.wav from the sound plan, then
 * mixes narration + ducked music + SFX and normalises to -14 LUFS integrated
 * with a -1.5 dBTP true-peak ceiling (two-pass loudnorm in final mode) and a
 * final limiter so nothing clips.
 */

export const TARGET_LUFS = -14;
export const TARGET_TP = -1.5;

export async function renderMusicTrack(plan: SoundPlan, total: number, outPath: string, logFile?: string) {
  const music = await musicFile(plan.music.mood, total, plan.music.swells);
  const d = total.toFixed(3);
  await runFfmpeg(
    [
      "-stream_loop",
      "-1",
      "-i",
      music.path,
      "-af",
      `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=mono,atrim=end=${d},afade=t=in:d=${plan.music.fade_in},afade=t=out:st=${Math.max(0, total - plan.music.fade_out).toFixed(3)}:d=${plan.music.fade_out}`,
      "-t",
      d,
      "-c:a",
      "pcm_s16le",
      outPath,
    ],
    { logFile },
  );
  return music.source;
}

export async function renderSfxTrack(plan: SoundPlan, total: number, outPath: string, logFile?: string) {
  const cues = [...plan.ambience, ...plan.sfx].filter((c) => c.start < total && c.duration > 0.05);
  const d = total.toFixed(3);
  if (!cues.length) {
    await runFfmpeg(["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=mono`, "-t", d, "-c:a", "pcm_s16le", outPath], { logFile });
    return;
  }
  const args: string[] = [];
  const filters: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const file = await sfxFile(cue.type, cue.duration, i);
    const isBed = plan.ambience.includes(cue);
    args.push("-i", file.path);
    const fade = isBed ? Math.min(1, cue.duration / 4) : Math.min(0.05, cue.duration / 4);
    const ms = Math.round(cue.start * 1000);
    filters.push(
      `[${i}:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=mono,atrim=end=${cue.duration.toFixed(3)},` +
        `afade=t=in:d=${fade.toFixed(3)},afade=t=out:st=${Math.max(0, cue.duration - fade).toFixed(3)}:d=${fade.toFixed(3)},` +
        `volume=${cue.volume_db}dB,adelay=${ms}:all=1[c${i}]`,
    );
  }
  filters.push(`${cues.map((_, i) => `[c${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,apad=whole_dur=${d},atrim=end=${d}[out]`);
  await runFfmpeg([...args, "-filter_complex", filters.join(";"), "-map", "[out]", "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", outPath], { logFile });
}

interface LoudnormStats {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

function parseLoudnorm(stderr: string): LoudnormStats | null {
  const m = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as LoudnormStats;
  } catch {
    return null;
  }
}

export interface MixReport {
  integratedLufs: number | null;
  truePeakDb: number | null;
  passes: number;
}

export async function mixEpisode(opts: {
  narration: string;
  music: string;
  sfx: string;
  total: number;
  musicDb: number;
  duckDb: number;
  out: string;
  twoPass: boolean;
  logFile?: string;
}): Promise<MixReport> {
  const d = opts.total.toFixed(3);
  const ratio = Math.min(20, Math.max(2, opts.duckDb / 1.2)).toFixed(1);
  const graph = [
    `[0:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,asplit=2[voice][sc]`,
    `[1:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,volume=${opts.musicDb}dB[music]`,
    `[music][sc]sidechaincompress=threshold=0.012:ratio=${ratio}:attack=15:release=380:makeup=1[ducked]`,
    `[2:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[sfx]`,
    `[voice][ducked][sfx]amix=inputs=3:normalize=0:duration=longest:dropout_transition=0,atrim=end=${d},alimiter=limit=0.97:level=disabled[pre]`,
  ].join(";");
  const inputs = ["-i", opts.narration, "-i", opts.music, "-i", opts.sfx];
  const base = `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=11`;
  let loudnorm = base;
  let passes = 1;
  if (opts.twoPass) {
    const measure = await runFfmpeg([...inputs, "-filter_complex", `${graph};[pre]${base}:print_format=json[m]`, "-map", "[m]", "-f", "null", "-"], {
      logFile: opts.logFile,
    });
    const s = parseLoudnorm(measure.stderr);
    if (s && Number.isFinite(Number(s.input_i)) && Number(s.input_i) > -70) {
      loudnorm = `${base}:measured_I=${s.input_i}:measured_TP=${s.input_tp}:measured_LRA=${s.input_lra}:measured_thresh=${s.input_thresh}:offset=${s.target_offset}:linear=true`;
      passes = 2;
    }
  }
  // Final safety limiter at -1 dBFS so the encoded file can never clip.
  await runFfmpeg(
    [
      ...inputs,
      "-filter_complex",
      `${graph};[pre]${loudnorm},aresample=${SAMPLE_RATE},alimiter=limit=0.891:level=disabled,atrim=end=${d}[mix]`,
      "-map",
      "[mix]",
      "-ar",
      String(SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      opts.out,
    ],
    { logFile: opts.logFile },
  );
  return { ...(await measureLoudness(opts.out)), passes };
}

export async function measureLoudness(file: string): Promise<{ integratedLufs: number | null; truePeakDb: number | null }> {
  const res = await runFfmpeg(["-i", file, "-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:print_format=json`, "-f", "null", "-"]);
  const s = parseLoudnorm(res.stderr);
  return {
    integratedLufs: s ? Math.round(Number(s.input_i) * 10) / 10 : null,
    truePeakDb: s ? Math.round(Number(s.input_tp) * 10) / 10 : null,
  };
}
