import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config, type RenderMode } from "@/lib/config";
import { EPISODE_STATUSES, STAGES, type Character, type EpisodeStatus, type Series, type Stage, type Timeline } from "@/lib/types";
import { now } from "@/lib/db";
import { getEpisode, getEpisodeByNumber, listScenes, replaceScenes, updateEpisode } from "@/lib/db/repos/episodes";
import { getSeries, listCharacters, listLocations } from "@/lib/db/repos/series";
import { addAsset, getCurrentAsset, toAbsolute } from "@/lib/db/repos/assets";
import { createJob, getJob, getJobInput, updateJob } from "@/lib/db/repos/jobs";
import { exportContinuity, exportEpisode } from "@/lib/data-sync";
import { aspectForPlatform, promptContext } from "@/lib/context";
import { cachedGenerate, fileHash, hashKey } from "@/lib/ai/cache";
import { setRetryObserver, withRetry } from "@/lib/ai/retry";
import { mockModeState } from "@/lib/ai/registry";
import { buildThumbnailPrompts } from "@/lib/prompts/engine";
import { spokenWords } from "@/lib/prompts/formatters";
import {
  generateMetadata,
  generateScreenplay,
  generateShotList,
  regeneratePrompts,
  screenplayToEpisodePatch,
  updateContinuity,
} from "@/lib/story/engines";
import { buildTimeline, renderNarrationTrack, voiceLines, type VoiceLine } from "@/lib/audio/narration";
import { planSound } from "@/lib/audio/sound-design";
import { mixEpisode, renderMusicTrack, renderSfxTrack } from "@/lib/audio/mix";
import { buildCaptionChunks, LAYOUTS, toAss, toSrt } from "@/lib/video/subtitles";
import { assembleEpisode, ENCODER_VERSION } from "@/lib/video/assemble";
import { renderThumbnails } from "@/lib/video/thumbnails";
import { clipLength, frameSize, planClip, planKeyframe, planVoices } from "@/lib/pipeline/requests";
import { ensureDir, episodePaths, placeFile, type EpisodePaths } from "@/lib/pipeline/paths";
import { estimateEpisode } from "@/lib/pipeline/estimate";
import { writeMetadataFiles } from "@/lib/pipeline/export";

/**
 * Pipeline orchestration. Every generated asset is its own GenerationJob, so
 * a failure affects only that asset: retrying re-runs just the failed unit and
 * everything else comes back from the cache for free.
 */

export class BudgetExceededError extends Error {
  constructor(
    public estimate: number,
    public budget: number,
  ) {
    super(`Estimated cost $${estimate.toFixed(2)} exceeds MAX_EPISODE_BUDGET_USD ($${budget.toFixed(2)}). Confirm to continue.`);
    this.name = "BudgetExceededError";
  }
}

export class PipelineBusyError extends Error {
  constructor() {
    super("A pipeline run is already in progress for this episode.");
    this.name = "PipelineBusyError";
  }
}

export interface RunOptions {
  mode?: RenderMode;
  /** Regenerate even when an identical cached result exists. */
  force?: boolean;
  /** Restrict per-scene stages to these scenes. */
  sceneIds?: string[];
  /** Skip the budget guard (the user confirmed the estimate). */
  confirmBudget?: boolean;
}

export interface RunSummary {
  runId: string;
  status: "succeeded" | "partial" | "failed" | "cancelled";
  cost: number;
  failed: number;
  errors: string[];
}

interface RunState {
  runId: string;
  episodeId: number;
  stages: Stage[];
  cancelled: boolean;
  startedAt: string;
}

const g = globalThis as unknown as { __fruitSagaRuns?: Map<number, RunState>; __fruitSagaObserver?: boolean };
const runs = (g.__fruitSagaRuns ??= new Map<number, RunState>());
const jobScope = new AsyncLocalStorage<{ jobId: number }>();

if (!g.__fruitSagaObserver) {
  g.__fruitSagaObserver = true;
  setRetryObserver((attempt, delayMs, err) => {
    const scope = jobScope.getStore();
    if (!scope) return;
    updateJob(scope.jobId, {
      attempts: attempt + 1,
      error: `Attempt ${attempt} failed (${errorMessage(err).slice(0, 200)}); retrying in ${Math.round(delayMs / 1000)}s`,
    });
  });
}

export function activeRun(episodeId: number): { runId: string; stages: Stage[]; startedAt: string } | null {
  const r = runs.get(episodeId);
  return r ? { runId: r.runId, stages: r.stages, startedAt: r.startedAt } : null;
}

export function cancelRun(episodeId: number): boolean {
  const r = runs.get(episodeId);
  if (!r) return false;
  r.cancelled = true;
  return true;
}

function orderStages(stages: readonly Stage[]): Stage[] {
  return STAGES.filter((s) => stages.includes(s));
}

function prepare(episodeId: number, stages: readonly Stage[], opts: RunOptions): { state: RunState; mode: RenderMode } {
  const episode = getEpisode(episodeId);
  if (!episode) throw new Error(`Episode ${episodeId} not found`);
  if (runs.has(episodeId)) throw new PipelineBusyError();
  const mode = opts.mode ?? episode.mode;
  const ordered = orderStages(stages);
  if (!mockModeState().active && !opts.confirmBudget) {
    const est = estimateEpisode(episodeId, mode, ordered);
    if (est.total > config.cost.maxEpisodeBudgetUsd) throw new BudgetExceededError(est.total, config.cost.maxEpisodeBudgetUsd);
  }
  const state: RunState = { runId: crypto.randomUUID(), episodeId, stages: ordered, cancelled: false, startedAt: now() };
  runs.set(episodeId, state);
  return { state, mode };
}

/** Starts a run in the background and returns immediately (used by the web UI). */
export function startPipeline(episodeId: number, stages: readonly Stage[], opts: RunOptions = {}): { runId: string } {
  const { state, mode } = prepare(episodeId, stages, opts);
  execute(state, mode, opts)
    .catch((err) => console.error(`[pipeline] run ${state.runId} crashed:`, err))
    .finally(() => runs.delete(episodeId));
  return { runId: state.runId };
}

/** Runs and waits (used by the CLI scripts). */
export async function runPipeline(episodeId: number, stages: readonly Stage[], opts: RunOptions = {}): Promise<RunSummary> {
  const { state, mode } = prepare(episodeId, stages, opts);
  try {
    return await execute(state, mode, opts);
  } finally {
    runs.delete(episodeId);
  }
}

/** Re-runs exactly the unit a failed job represented (e.g. one keyframe). */
export function retryJob(jobId: number, opts: RunOptions = {}): { runId: string } {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  const input = getJobInput<{ mode?: RenderMode }>(jobId);
  return startPipeline(job.episode_id, [job.stage], {
    ...opts,
    mode: opts.mode ?? input?.mode,
    sceneIds: job.scene_id ? [job.scene_id] : undefined,
  });
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

interface StageCtx {
  episodeId: number;
  runId: string;
  mode: RenderMode;
  force: boolean;
  sceneIds: Set<string> | null;
  state: RunState;
  log: (msg: string) => void;
}

interface StageOutcome {
  cost: number;
  failed: number;
  fatal?: string;
}

async function execute(state: RunState, mode: RenderMode, opts: RunOptions): Promise<RunSummary> {
  const summary: RunSummary = { runId: state.runId, status: "succeeded", cost: 0, failed: 0, errors: [] };
  const episode = getEpisode(state.episodeId)!;
  const paths = episodePaths(episode.series_id, episode.episode_number, mode);
  ensureDir(paths.dir);
  const log = (msg: string) => {
    try {
      fs.appendFileSync(paths.log, `[${now()}] ${msg}\n`);
    } catch {
      /* best effort */
    }
  };
  log(`=== run ${state.runId} (${mode}) stages: ${state.stages.join(", ")}`);
  const ctx: StageCtx = {
    episodeId: state.episodeId,
    runId: state.runId,
    mode,
    force: Boolean(opts.force),
    sceneIds: opts.sceneIds?.length ? new Set(opts.sceneIds) : null,
    state,
    log,
  };
  for (const stage of state.stages) {
    if (state.cancelled) {
      summary.status = "cancelled";
      break;
    }
    try {
      const outcome = await HANDLERS[stage](ctx);
      summary.cost += outcome.cost;
      summary.failed += outcome.failed;
      if (outcome.fatal) {
        summary.errors.push(`${stage}: ${outcome.fatal}`);
        summary.status = "failed";
        log(`stage ${stage} stopped the run: ${outcome.fatal}`);
        break;
      }
    } catch (err) {
      summary.errors.push(`${stage}: ${errorMessage(err)}`);
      summary.status = "failed";
      log(`stage ${stage} crashed: ${errorMessage(err)}`);
      break;
    }
  }
  if (summary.status === "succeeded" && summary.failed) summary.status = "partial";
  exportEpisode(state.episodeId);
  log(`=== run ${state.runId} ${summary.status}; cost $${summary.cost.toFixed(4)}`);
  return summary;
}

interface UnitSpec {
  stage: Stage;
  label: string;
  sceneId?: string | null;
  provider?: string;
  model?: string;
  estimate?: number;
}

interface UnitResult {
  cost?: number;
  cached?: boolean;
  output?: Record<string, unknown>;
  cacheKey?: string;
  provider?: string;
  model?: string;
}

async function unit(ctx: StageCtx, spec: UnitSpec, fn: (report: (p: number) => void) => Promise<UnitResult>): Promise<{ ok: boolean; cost: number; error?: string }> {
  const job = createJob({
    episode_id: ctx.episodeId,
    run_id: ctx.runId,
    scene_id: spec.sceneId ?? null,
    stage: spec.stage,
    label: spec.label,
    provider: spec.provider ?? null,
    model: spec.model ?? null,
    estimated_cost: spec.estimate ?? 0,
    input: { mode: ctx.mode },
  });
  if (ctx.state.cancelled) {
    updateJob(job.id, { status: "skipped", error: "Run cancelled", finished_at: now() });
    return { ok: false, cost: 0, error: "cancelled" };
  }
  updateJob(job.id, { status: "running", started_at: now(), attempts: 1 });
  let lastReport = 0;
  const report = (p: number) => {
    const t = Date.now();
    if (t - lastReport < 400 && p < 1) return;
    lastReport = t;
    updateJob(job.id, { progress: Math.max(0, Math.min(1, p)) });
  };
  try {
    const r = await jobScope.run({ jobId: job.id }, () => fn(report));
    updateJob(job.id, {
      status: r.cached ? "cached" : "succeeded",
      progress: 1,
      actual_cost: r.cost ?? 0,
      output: r.output ?? null,
      cache_key: r.cacheKey ?? null,
      provider: r.provider ?? spec.provider ?? null,
      model: r.model ?? spec.model ?? null,
      error: null,
      finished_at: now(),
    });
    ctx.log(`✓ ${spec.label}${r.cached ? " (cached)" : ""}${r.cost ? ` $${r.cost.toFixed(4)}` : ""}`);
    return { ok: true, cost: r.cost ?? 0 };
  } catch (err) {
    const message = errorMessage(err);
    updateJob(job.id, { status: "failed", error: message, finished_at: now() });
    ctx.log(`✗ ${spec.label}: ${message}`);
    return { ok: false, cost: 0, error: message };
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function setStatus(episodeId: number, status: EpisodeStatus, how: "advance" | "set") {
  const ep = getEpisode(episodeId)!;
  if (how === "set" || EPISODE_STATUSES.indexOf(status) > EPISODE_STATUSES.indexOf(ep.status)) updateEpisode(episodeId, { status });
}

function load(ctx: StageCtx) {
  const episode = getEpisode(ctx.episodeId)!;
  const series = getSeries(episode.series_id)!;
  const scenes = listScenes(episode.id);
  const pctx = promptContext(series.id, aspectForPlatform(episode.platform));
  const paths = episodePaths(series.id, episode.episode_number, ctx.mode);
  return { episode, series, scenes, pctx, paths };
}

const selected = (ctx: StageCtx, sceneId: string) => !ctx.sceneIds || ctx.sceneIds.has(sceneId);

function noScenes(): StageOutcome {
  return { cost: 0, failed: 1, fatal: "This episode has no scenes yet — generate the shot list first." };
}

// ---------------------------------------------------------------------------
// Stage handlers
// ---------------------------------------------------------------------------

const HANDLERS: Record<Stage, (ctx: StageCtx) => Promise<StageOutcome>> = {
  async script(ctx) {
    const { episode, series } = load(ctx);
    let cost = 0;
    // Make sure the previous episode is folded into the series state first.
    const prev = getEpisodeByNumber(series.id, episode.episode_number - 1);
    if (prev && prev.beats.length && !prev.continuity_committed) {
      const r = await unit(ctx, { stage: "continuity", label: `Continuity after EP ${prev.episode_number}` }, async () => {
        const res = await updateContinuity(prev, listScenes(prev.id), ctx.mode);
        updateEpisode(prev.id, { continuity_committed: true });
        exportContinuity(series.id);
        exportEpisode(prev.id);
        return { cost: res.cost, provider: res.provider, model: res.model, output: { as_of_episode: res.data.as_of_episode } };
      });
      cost += r.cost;
    }
    const r = await unit(ctx, { stage: "script", label: "Screenplay" }, async () => {
      const res = await generateScreenplay(getEpisode(ctx.episodeId)!, ctx.mode);
      updateEpisode(ctx.episodeId, {
        ...screenplayToEpisodePatch(res.data, getEpisode(ctx.episodeId)!),
        status: "scripted",
        timeline: null,
        sound_plan: null,
      });
      return { cost: res.cost, provider: res.provider, model: res.model, output: { title: res.data.title, words: spokenWords(res.data.beats) } };
    });
    return { cost: cost + r.cost, failed: r.ok ? 0 : 1, fatal: r.ok ? undefined : r.error };
  },

  async shotlist(ctx) {
    const r = await unit(ctx, { stage: "shotlist", label: "Shot list" }, async () => {
      const { episode, pctx } = load(ctx);
      const res = await generateShotList(episode, pctx, ctx.mode);
      replaceScenes(episode.id, res.data);
      updateEpisode(episode.id, { status: "shotlisted", timeline: null, sound_plan: null });
      return {
        cost: res.cost,
        provider: res.provider,
        model: res.model,
        output: { shots: res.data.length, duration: Math.round(res.data.reduce((s, x) => s + x.duration, 0) * 10) / 10 },
      };
    });
    return { cost: r.cost, failed: r.ok ? 0 : 1, fatal: r.ok ? undefined : r.error };
  },

  async prompts(ctx) {
    const r = await unit(ctx, { stage: "prompts", label: "Image, video & negative prompts" }, async () => {
      const { episode, scenes, pctx } = load(ctx);
      if (!scenes.length) throw new Error("No scenes — generate the shot list first.");
      const durations = new Map(episode.timeline?.scenes.map((s) => [s.scene_id, s.duration]) ?? []);
      const updated = regeneratePrompts(scenes, pctx, durations);
      replaceScenes(episode.id, updated);
      const thumbs = buildThumbnailPrompts(episode.metadata, updated, pctx);
      updateEpisode(episode.id, {
        metadata: { ...episode.metadata, thumbnail_prompt_vertical: thumbs.vertical, thumbnail_prompt_landscape: thumbs.landscape },
      });
      setStatus(episode.id, "prompted", "advance");
      return { output: { scenes: updated.length, lockedFields: updated.reduce((n, s) => n + s.locked_fields.length, 0) } };
    });
    return { cost: 0, failed: r.ok ? 0 : 1, fatal: r.ok ? undefined : r.error };
  },

  async metadata(ctx) {
    const r = await unit(ctx, { stage: "metadata", label: "Titles, captions, hashtags & thumbnail concept" }, async () => {
      const { episode, series, scenes, pctx, paths } = load(ctx);
      const res = await generateMetadata(episode, scenes, pctx, ctx.mode);
      const updated = updateEpisode(episode.id, { metadata: res.data });
      writeMetadataFiles(updated, series, paths);
      return { cost: res.cost, provider: res.provider, model: res.model, output: { title: res.data.youtube_title } };
    });
    return { cost: r.cost, failed: r.ok ? 0 : 1 };
  },

  async narration(ctx) {
    const { series, scenes, pctx, paths } = load(ctx);
    if (!scenes.length) return noScenes();
    const characters = listCharacters(series.id);
    ensureDir(paths.voice);
    const voices = new Map<string, VoiceLine[]>();
    let cost = 0;
    let failed = 0;
    await mapLimit(scenes, config.concurrency + 1, async (scene) => {
      const plans = planVoices(scene, series, characters, ctx.mode);
      if (!plans.length) {
        voices.set(scene.scene_id, []);
        return;
      }
      const r = await unit(
        ctx,
        {
          stage: "narration",
          sceneId: scene.scene_id,
          label: `Voice ${scene.scene_id} (${plans.length} line${plans.length > 1 ? "s" : ""})`,
          provider: plans[0].provider.name,
          model: plans[0].provider.model,
          estimate: plans.reduce((s, p) => s + p.estimate, 0),
        },
        async () => {
          const lines = await voiceLines(plans, scene.scene_id, paths.voice, ctx.force && selected(ctx, scene.scene_id));
          voices.set(scene.scene_id, lines);
          return {
            cost: lines.reduce((s, l) => s + l.cost, 0),
            cached: lines.every((l) => l.cached),
            output: { lines: lines.length, seconds: Math.round(lines.reduce((s, l) => s + l.duration, 0) * 100) / 100 },
          };
        },
      );
      cost += r.cost;
      if (!r.ok) failed++;
    });
    if (failed) return { cost, failed, fatal: `${failed} voice job(s) failed — retry them, then continue.` };
    const r = await unit(ctx, { stage: "narration", label: "Timeline & narration track" }, async () => {
      const timeline = buildTimeline(series, scenes, voices, getEpisode(ctx.episodeId)!.target_duration);
      ensureDir(paths.audio);
      await renderNarrationTrack(timeline, paths.narration, toAbsolute);
      // Shot durations may have grown to fit the voice: refresh duration-aware prompts.
      const durations = new Map(timeline.scenes.map((s) => [s.scene_id, s.duration]));
      replaceScenes(ctx.episodeId, regeneratePrompts(listScenes(ctx.episodeId), pctx, durations));
      updateEpisode(ctx.episodeId, { timeline });
      setStatus(ctx.episodeId, "voiced", "advance");
      addAsset({ episode_id: ctx.episodeId, kind: "narration", variant: ctx.mode, path: paths.narration, duration: timeline.total_duration });
      return { output: { total: timeline.total_duration, content: timeline.content_duration, voiceClips: timeline.voice.length } };
    });
    return { cost, failed: r.ok ? 0 : 1, fatal: r.ok ? undefined : r.error };
  },

  async sound(ctx) {
    const r = await unit(ctx, { stage: "sound", label: "Sound design plan" }, async () => {
      const { episode, series, scenes } = load(ctx);
      if (!scenes.length) throw new Error("No scenes — generate the shot list first.");
      const timeline = episode.timeline ?? buildTimeline(series, scenes, new Map(), episode.target_duration);
      const plan = planSound(series, episode, scenes, timeline, listLocations(series.id));
      updateEpisode(episode.id, { sound_plan: plan, timeline });
      return { output: { mood: plan.music.mood, ambience: plan.ambience.length, sfx: plan.sfx.length } };
    });
    return { cost: 0, failed: r.ok ? 0 : 1 };
  },

  async subtitles(ctx) {
    const r = await unit(ctx, { stage: "subtitles", label: "Subtitles (SRT + ASS)" }, async () => {
      const { episode, series, paths } = load(ctx);
      if (!episode.timeline) throw new Error("No timeline yet — generate narration first.");
      writeSubtitles(episode.timeline, series, listCharacters(series.id), paths);
      for (const [kind, file, variant] of [
        ["subtitle_srt", paths.srt, ctx.mode],
        ["subtitle_ass", paths.assVertical, `${ctx.mode}:vertical`],
        ["subtitle_ass", paths.assLandscape, `${ctx.mode}:landscape`],
      ] as const) {
        addAsset({ episode_id: episode.id, kind, variant, path: file });
      }
      return { output: { captions: buildCaptionChunks(episode.timeline, LAYOUTS.vertical.maxLineChars).length, mode: series.settings.subtitles.mode } };
    });
    return { cost: 0, failed: r.ok ? 0 : 1 };
  },

  async keyframes(ctx) {
    const { episode, scenes, pctx, paths } = load(ctx);
    if (!scenes.length) return noScenes();
    const { width, height } = frameSize(ctx.mode, pctx.aspect);
    let cost = 0;
    let failed = 0;
    await mapLimit(
      scenes.filter((s) => selected(ctx, s.scene_id)),
      config.concurrency,
      async (scene) => {
        const plan = planKeyframe(scene, pctx, ctx.mode);
        const r = await unit(
          ctx,
          { stage: "keyframes", sceneId: scene.scene_id, label: `Keyframe ${scene.scene_id}`, provider: plan.provider.name, model: plan.provider.model, estimate: plan.estimate },
          async () => {
            const res = await cachedGenerate({
              kind: "keyframe",
              key: plan.key,
              provider: plan.provider.name,
              model: plan.provider.model,
              force: ctx.force,
              generate: async () => {
                const out = await withRetry(() => plan.provider.generate(plan.req));
                const buffer = await sharp(out.buffer).resize(width, height, { fit: "cover", position: sharp.strategy.attention }).png().toBuffer();
                return { buffer, ext: "png", cost: out.cost, meta: out.meta };
              },
            });
            const file = placeFile(res.path, path.join(paths.keyframes, `${scene.scene_id}.png`));
            addAsset({
              episode_id: episode.id,
              scene_id: scene.scene_id,
              kind: "keyframe",
              variant: ctx.mode,
              path: file,
              cache_key: plan.key,
              provider: plan.provider.name,
              model: plan.provider.model,
              cost: res.cost,
              width,
              height,
              meta: { cached: res.cached },
            });
            return { cost: res.cost, cached: res.cached, cacheKey: plan.key };
          },
        );
        cost += r.cost;
        if (!r.ok) failed++;
      },
    );
    return { cost, failed };
  },

  async clips(ctx) {
    const { episode, scenes, pctx, paths } = load(ctx);
    if (!scenes.length) return noScenes();
    let cost = 0;
    let failed = 0;
    const targets = scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => selected(ctx, scene.scene_id));
    await mapLimit(targets, config.concurrency, async ({ scene, index }) => {
      const keyframe = getCurrentAsset(episode.id, "keyframe", ctx.mode, scene.scene_id);
      const duration = clipLength(episode, scenes, index);
      const plan = planClip(scene, keyframe ? toAbsolute(keyframe.path) : null, duration, pctx, ctx.mode);
      const r = await unit(
        ctx,
        { stage: "clips", sceneId: scene.scene_id, label: `Clip ${scene.scene_id} (${duration.toFixed(1)}s)`, provider: plan.provider.name, model: plan.provider.model, estimate: plan.estimate },
        async (report) => {
          if (!keyframe || !plan.key) throw new Error("No keyframe for this scene — generate keyframes first.");
          const res = await cachedGenerate({
            kind: "clip",
            key: plan.key,
            provider: plan.provider.name,
            model: plan.provider.model,
            force: ctx.force,
            generate: async () => {
              const out = await withRetry(() => plan.provider.generate(plan.req, report));
              return { filePath: out.filePath, ext: "mp4", cost: out.cost, meta: { duration: out.duration, ...(out.meta ?? {}) } };
            },
          });
          const file = placeFile(res.path, path.join(paths.clips, `${scene.scene_id}.mp4`));
          addAsset({
            episode_id: episode.id,
            scene_id: scene.scene_id,
            kind: "clip",
            variant: ctx.mode,
            path: file,
            cache_key: plan.key,
            provider: plan.provider.name,
            model: plan.provider.model,
            cost: res.cost,
            duration: Number(res.meta.duration) || duration,
            meta: { cached: res.cached },
          });
          return { cost: res.cost, cached: res.cached, cacheKey: plan.key };
        },
      );
      cost += r.cost;
      if (!r.ok) failed++;
    });
    if (scenes.every((s) => getCurrentAsset(episode.id, "clip", ctx.mode, s.scene_id))) setStatus(episode.id, "assets_ready", "advance");
    return { cost, failed };
  },

  async thumbnails(ctx) {
    const r = await unit(ctx, { stage: "thumbnails", label: "Thumbnails 9:16 + 16:9" }, async () => {
      const { episode, scenes, pctx, paths } = load(ctx);
      const res = await renderThumbnails(episode, scenes, pctx, ctx.mode, paths);
      addAsset({ episode_id: episode.id, kind: "thumbnail_vertical", variant: ctx.mode, path: res.vertical, cost: res.cost / 2, provider: res.provider, model: res.model });
      addAsset({ episode_id: episode.id, kind: "thumbnail_landscape", variant: ctx.mode, path: res.landscape, cost: res.cost / 2, provider: res.provider, model: res.model });
      return { cost: res.cost, cached: res.cached, provider: res.provider, model: res.model };
    });
    return { cost: r.cost, failed: r.ok ? 0 : 1 };
  },

  async mix(ctx) {
    const r = await unit(ctx, { stage: "mix", label: "Music, SFX & loudness-normalised mix" }, async (report) => {
      const { episode, series, scenes, paths } = load(ctx);
      if (!episode.timeline) throw new Error("No timeline — generate narration first.");
      let plan = episode.sound_plan;
      if (!plan) {
        plan = planSound(series, episode, scenes, episode.timeline, listLocations(series.id));
        updateEpisode(episode.id, { sound_plan: plan });
      }
      const total = episode.timeline.total_duration;
      // Skip when nothing that feeds the mix changed since the last one.
      const inputKey = hashKey({
        v: 1,
        mode: ctx.mode,
        timeline: { ...episode.timeline, computed_at: "" },
        plan,
        voices: episode.timeline.voice.map((v) => (fs.existsSync(toAbsolute(v.file)) ? fileHash(toAbsolute(v.file)) : v.file)),
      });
      const previous = getCurrentAsset(episode.id, "mix", ctx.mode);
      if (!ctx.force && previous?.meta.inputKey === inputKey) return { cached: true, output: { ...previous.meta, reused: true } };
      ensureDir(paths.audio);
      await renderNarrationTrack(episode.timeline, paths.narration, toAbsolute);
      report(0.2);
      const musicSource = await renderMusicTrack(plan, total, paths.music, paths.log);
      report(0.45);
      await renderSfxTrack(plan, total, paths.sfx, paths.log);
      report(0.7);
      const loud = await mixEpisode({
        narration: paths.narration,
        music: paths.music,
        sfx: paths.sfx,
        total,
        musicDb: plan.music.volume_db,
        duckDb: plan.music.duck_db,
        out: paths.mix,
        twoPass: ctx.mode === "final",
        logFile: paths.log,
      });
      addAsset({ episode_id: episode.id, kind: "music", variant: ctx.mode, path: paths.music, duration: total, meta: { source: musicSource } });
      addAsset({ episode_id: episode.id, kind: "sfx", variant: ctx.mode, path: paths.sfx, duration: total });
      addAsset({ episode_id: episode.id, kind: "mix", variant: ctx.mode, path: paths.mix, duration: total, meta: { ...loud, inputKey } });
      return { output: { ...loud, musicSource } };
    });
    return { cost: 0, failed: r.ok ? 0 : 1, fatal: r.ok ? undefined : r.error };
  },

  async assemble(ctx) {
    const r = await unit(ctx, { stage: "assemble", label: "Assemble 9:16 + 16:9 videos" }, async (report) => {
      const { episode, series, scenes, pctx, paths } = load(ctx);
      const timeline = episode.timeline;
      if (!timeline) throw new Error("No timeline — generate narration first.");
      const stale = scenes.filter((s) => !timeline.scenes.some((t) => t.scene_id === s.scene_id));
      if (stale.length) throw new Error(`Timeline is out of date (${stale.map((s) => s.scene_id).join(", ")}) — run narration again.`);
      const clipPaths = new Map<string, string>();
      const missing: string[] = [];
      for (const s of scenes) {
        const a = getCurrentAsset(episode.id, "clip", ctx.mode, s.scene_id);
        if (a) clipPaths.set(s.scene_id, toAbsolute(a.path));
        else missing.push(s.scene_id);
      }
      if (missing.length) throw new Error(`Missing ${ctx.mode} clips for ${missing.join(", ")} — generate or retry them first.`);
      const mix = getCurrentAsset(episode.id, "mix", ctx.mode);
      if (!mix) throw new Error("No mix yet — run the mix stage first.");
      if (!fs.existsSync(paths.assVertical) || !fs.existsSync(paths.assLandscape)) writeSubtitles(timeline, series, listCharacters(series.id), paths);
      // Skip re-assembly when every input is byte-identical to the last render.
      const inputKey = hashKey({
        v: ENCODER_VERSION,
        mode: ctx.mode,
        aspect: pctx.aspect,
        timeline: { ...timeline, computed_at: "" },
        clips: scenes.map((s) => fileHash(clipPaths.get(s.scene_id)!)),
        mix: fileHash(toAbsolute(mix.path)),
        subtitles: [paths.assVertical, paths.assLandscape].map((f) => fileHash(f)),
        settings: series.settings,
        cards: [episode.title, episode.metadata.next_episode_teaser, episode.next_episode_tease],
      });
      const prevV = getCurrentAsset(episode.id, "render_vertical", ctx.mode);
      const prevL = getCurrentAsset(episode.id, "render_landscape", ctx.mode);
      if (!ctx.force && prevV?.meta.inputKey === inputKey && prevL?.meta.inputKey === inputKey) {
        return { cached: true, output: { duration: prevV.duration, reused: true } };
      }
      const res = await assembleEpisode({
        series,
        episode: { ...episode, timeline },
        scenes,
        clipPaths,
        mixPath: toAbsolute(mix.path),
        paths,
        mode: ctx.mode,
        aspect: pctx.aspect,
        onProgress: (f) => report(f),
      });
      const loud = mix.meta as { integratedLufs?: number; truePeakDb?: number };
      addAsset({ episode_id: episode.id, kind: "render_vertical", variant: ctx.mode, path: res.vertical, duration: res.duration, meta: { ...loud, inputKey } });
      addAsset({ episode_id: episode.id, kind: "render_landscape", variant: ctx.mode, path: res.landscape, duration: res.duration, meta: { ...loud, inputKey } });
      fs.writeFileSync(
        path.join(ensureDir(paths.metadata), `render_${ctx.mode}.json`),
        JSON.stringify({ rendered_at: now(), mode: ctx.mode, duration: res.duration, loudness: loud, vertical: res.vertical, landscape: res.landscape }, null, 2),
      );
      setStatus(episode.id, "rendered", "advance");
      return { output: { duration: Math.round(res.duration * 100) / 100, ...loud } };
    });
    return { cost: 0, failed: r.ok ? 0 : 1, fatal: r.ok ? undefined : r.error };
  },

  async continuity(ctx) {
    const r = await unit(ctx, { stage: "continuity", label: "Commit episode to series continuity" }, async () => {
      const { episode, series, scenes } = load(ctx);
      if (!episode.beats.length) throw new Error("Nothing to commit — this episode has no script.");
      const res = await updateContinuity(episode, scenes, ctx.mode);
      updateEpisode(episode.id, { continuity_committed: true });
      exportContinuity(series.id);
      return { cost: res.cost, provider: res.provider, model: res.model, output: { objective: res.data.current_objective } };
    });
    return { cost: r.cost, failed: r.ok ? 0 : 1, fatal: r.ok ? undefined : r.error };
  },
};

function writeSubtitles(timeline: Timeline, series: Series, characters: Character[], paths: EpisodePaths) {
  ensureDir(paths.subtitles);
  const font = series.settings.subtitles.font || config.subtitleFont;
  const highlight = series.settings.subtitles.mode === "word";
  const uppercase = series.settings.subtitles.uppercase;
  fs.writeFileSync(paths.srt, toSrt(buildCaptionChunks(timeline, 21), characters, 42));
  fs.writeFileSync(
    paths.assVertical,
    toAss(buildCaptionChunks(timeline, LAYOUTS.vertical.maxLineChars), characters, { layout: LAYOUTS.vertical, font, highlight, uppercase }),
  );
  fs.writeFileSync(
    paths.assLandscape,
    toAss(buildCaptionChunks(timeline, LAYOUTS.landscape.maxLineChars), characters, { layout: LAYOUTS.landscape, font, highlight, uppercase }),
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
