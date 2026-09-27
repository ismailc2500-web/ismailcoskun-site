import path from "node:path";
import type { Scene, Series, Timeline, VoiceClip, WordTiming } from "@/lib/types";
import { cachedGenerate } from "@/lib/ai/cache";
import { withRetry } from "@/lib/ai/retry";
import { estimateTimings } from "@/lib/audio/timing";
import type { VoicePlan } from "@/lib/pipeline/requests";
import { placeFile } from "@/lib/pipeline/paths";
import { toRelative } from "@/lib/db/repos/assets";
import { transitionSpec } from "@/lib/prompts/vocabulary";
import { runFfmpeg } from "@/lib/video/ffmpeg";
import { SAMPLE_RATE } from "@/lib/audio/convert";

/** STAGE 5 — voiceover: one TTS call per spoken line, cached, then laid out on the timeline. */

export interface VoiceLine {
  speaker: string;
  text: string;
  file: string;
  duration: number;
  words: WordTiming[];
  cost: number;
  cached: boolean;
  provider: string;
  model: string;
}

export async function voiceLines(plans: VoicePlan[], sceneId: string, voiceDir: string, force = false): Promise<VoiceLine[]> {
  const out: VoiceLine[] = [];
  for (const plan of plans) {
    const res = await cachedGenerate({
      kind: "voice",
      key: plan.key,
      provider: plan.provider.name,
      model: plan.provider.model,
      force,
      generate: async () => {
        const r = await withRetry(() => plan.provider.generate(plan.text, plan.voice, plan.options));
        return { filePath: r.wavPath, ext: "wav", cost: r.cost, meta: { duration: r.duration, words: r.words ?? null } };
      },
    });
    const duration = Number(res.meta.duration);
    const words =
      (res.meta.words as WordTiming[] | null) ??
      estimateTimings(plan.text, plan.options.wordsPerMinute, plan.voice.speed ?? 1, duration).words;
    const file = placeFile(res.path, path.join(voiceDir, `${sceneId}_${plan.index}_${plan.speaker}.wav`));
    out.push({
      speaker: plan.speaker,
      text: plan.text,
      file,
      duration,
      words,
      cost: res.cost,
      cached: res.cached,
      provider: plan.provider.name,
      model: plan.provider.model,
    });
  }
  return out;
}

const LEAD_IN = 0.25;
const HOOK_LEAD_IN = 0.08;
const LINE_GAP = 0.2;
const TAIL = 0.35;

const MIN_SHOT = 2.5;

/**
 * Builds the episode timeline. A shot keeps its planned duration unless its
 * spoken lines need more room — narration is never cut off. When shots have to
 * grow, the overflow is taken back from shots with slack (never below what
 * their own lines need), so the episode stays on its target duration.
 */
export function buildTimeline(series: Series, scenes: Scene[], voices: Map<string, VoiceLine[]>, targetContent?: number): Timeline {
  const intro = series.settings.intro.enabled ? series.settings.intro.duration : 0;
  const outro = series.settings.outro.enabled ? series.settings.outro.duration : 0;
  const needed = scenes.map((scene) => {
    const lines = voices.get(scene.scene_id) ?? [];
    if (!lines.length) return Math.min(scene.duration, MIN_SHOT);
    const lead = scene.beat === "hook" ? HOOK_LEAD_IN : LEAD_IN;
    const speech = lines.reduce((sum, l) => sum + l.duration, 0) + Math.max(0, lines.length - 1) * LINE_GAP;
    return Math.max(MIN_SHOT, lead + speech + TAIL);
  });
  const durations = scenes.map((scene, i) => Math.max(scene.duration, needed[i]));
  const target = targetContent ?? scenes.reduce((sum, s) => sum + s.duration, 0);
  const overflow = durations.reduce((a, b) => a + b, 0) - target;
  if (overflow > 0.05) {
    const slack = durations.map((d, i) => Math.max(0, d - needed[i]));
    const totalSlack = slack.reduce((a, b) => a + b, 0);
    if (totalSlack > 0) {
      const k = Math.min(1, overflow / totalSlack);
      for (let i = 0; i < durations.length; i++) durations[i] -= slack[i] * k;
    }
  }
  let t = intro;
  const tl: Timeline["scenes"] = [];
  const clips: VoiceClip[] = [];
  scenes.forEach((scene, i) => {
    const lines = voices.get(scene.scene_id) ?? [];
    const lead = scene.beat === "hook" ? HOOK_LEAD_IN : LEAD_IN;
    const duration = Math.round(durations[i] * 100) / 100;
    const isLast = i === scenes.length - 1;
    const trans = isLast && !outro ? { duration: 0 } : transitionSpec(scene.transition);
    tl.push({ scene_id: scene.scene_id, start: round(t), duration, transition: scene.transition, transition_duration: trans.duration });
    let cursor = t + lead;
    lines.forEach((line, k) => {
      clips.push({
        id: `${scene.scene_id}_${k}`,
        scene_id: scene.scene_id,
        speaker: line.speaker,
        text: line.text,
        start: round(cursor),
        duration: round(line.duration),
        file: toRelative(line.file),
        words: line.words.map((w) => ({ word: w.word, start: round(cursor + w.start), end: round(cursor + w.end) })),
      });
      cursor += line.duration + LINE_GAP;
    });
    t += duration;
  });
  return {
    intro_duration: intro,
    outro_duration: outro,
    content_duration: round(t - intro),
    total_duration: round(t + outro),
    scenes: tl,
    voice: clips,
    computed_at: new Date().toISOString(),
  };
}

/** Places every voice clip at its timeline position → one continuous narration.wav. */
export async function renderNarrationTrack(timeline: Timeline, outPath: string, abs: (rel: string) => string) {
  const total = timeline.total_duration.toFixed(3);
  if (!timeline.voice.length) {
    await runFfmpeg(["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=mono`, "-t", total, "-c:a", "pcm_s16le", outPath]);
    return;
  }
  const args: string[] = [];
  const filters: string[] = [];
  timeline.voice.forEach((clip, i) => {
    args.push("-i", abs(clip.file));
    const ms = Math.round(clip.start * 1000);
    filters.push(`[${i}:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=mono,adelay=${ms}:all=1[v${i}]`);
  });
  const inputs = timeline.voice.map((_, i) => `[v${i}]`).join("");
  filters.push(`${inputs}amix=inputs=${timeline.voice.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total},atrim=end=${total}[out]`);
  await runFfmpeg([...args, "-filter_complex", filters.join(";"), "-map", "[out]", "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", outPath]);
}

const round = (n: number) => Math.round(n * 1000) / 1000;
