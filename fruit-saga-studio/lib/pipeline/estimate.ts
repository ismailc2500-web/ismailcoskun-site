import { config, type RenderMode } from "@/lib/config";
import { PIPELINE_ACTIONS, type ProviderKind, type Scene, type Stage } from "@/lib/types";
import { getEpisode, listScenes } from "@/lib/db/repos/episodes";
import { getSeries, listCharacters } from "@/lib/db/repos/series";
import { getCurrentAsset, hasCached, toAbsolute } from "@/lib/db/repos/assets";
import { getImageProvider, getLLM, getTTSProvider, getVideoProvider, mockModeState, resolveProvider } from "@/lib/ai/registry";
import { aspectForPlatform, promptContext } from "@/lib/context";
import { clipLength, planClip, planKeyframe, planVoices } from "@/lib/pipeline/requests";
import { planThumbnails } from "@/lib/video/thumbnails";
import { round4 } from "@/lib/ai/pricing";

/**
 * Cost estimate BEFORE generation, per scene and per episode. Uses the same
 * request builders as the pipeline, so anything already in the cache is
 * shown as $0 — you only pay for what actually changed.
 */

const LLM_TOKENS: Partial<Record<Stage, [number, number]>> = {
  script: [4500, 1800],
  shotlist: [4200, 4500],
  metadata: [1600, 700],
  continuity: [4200, 2600],
};

export interface CostLine {
  cost: number;
  cached: boolean;
}

export interface SceneEstimate {
  scene_id: string;
  keyframe: CostLine | null;
  clip: CostLine | null;
  voice: (CostLine & { lines: number }) | null;
  total: number;
}

export interface EpisodeEstimate {
  mode: RenderMode;
  stages: Stage[];
  mock: boolean;
  providers: Record<ProviderKind, { provider: string; model: string; quality: string }>;
  llm: number;
  thumbnails: CostLine | null;
  scenes: SceneEstimate[];
  hypotheticalScenes: boolean;
  total: number;
  fullPrice: number;
  budget: number;
  overBudget: boolean;
  notes: string[];
}

export function estimateEpisode(episodeId: number, mode: RenderMode, stages: readonly Stage[] = PIPELINE_ACTIONS.all): EpisodeEstimate {
  const episode = getEpisode(episodeId);
  if (!episode) throw new Error(`Episode ${episodeId} not found`);
  const series = getSeries(episode.series_id)!;
  const characters = listCharacters(series.id);
  const ctx = promptContext(series.id, aspectForPlatform(episode.platform));
  const has = (s: Stage) => stages.includes(s);
  const notes: string[] = [];
  const mock = mockModeState().active;

  const providers = Object.fromEntries(
    (["llm", "image", "video", "tts"] as ProviderKind[]).map((k) => {
      const r = resolveProvider(k, mode);
      const model =
        k === "llm" ? getLLM(mode).model : k === "image" ? getImageProvider(mode).model : k === "video" ? getVideoProvider(mode).model : getTTSProvider(mode).model;
      return [k, { provider: r.provider, model, quality: r.quality }];
    }),
  ) as EpisodeEstimate["providers"];

  const llm = getLLM(mode);
  const llmCost = (Object.entries(LLM_TOKENS) as [Stage, [number, number]][])
    .filter(([s]) => has(s))
    .reduce((sum, [, [i, o]]) => sum + llm.estimateCost(i, o), 0);

  // When the shot list will be (re)written, the real scenes are not known yet:
  // estimate with nine typical shots.
  const regenerating = has("script") || has("shotlist");
  let scenes = listScenes(episode.id);
  let hypothetical = false;
  if (!scenes.length || regenerating) {
    hypothetical = true;
    const n = 9;
    scenes = Array.from({ length: n }, (_, i) => ({
      ...placeholderScene(i),
      duration: episode.target_duration / n,
      narration: "x".repeat(95),
    }));
    notes.push("Shot list not final yet — scenes estimated as 9 typical shots.");
  }

  const sceneEstimates: SceneEstimate[] = scenes.map((scene, index) => {
    let keyframe: CostLine | null = null;
    let clip: CostLine | null = null;
    let voice: SceneEstimate["voice"] = null;
    if (has("keyframes")) {
      const plan = planKeyframe(scene, ctx, mode);
      const cached = !hypothetical && hasCached(plan.key);
      keyframe = { cost: cached ? 0 : plan.estimate, cached };
    }
    if (has("clips")) {
      const kf = hypothetical ? null : getCurrentAsset(episode.id, "keyframe", mode, scene.scene_id);
      const plan = planClip(scene, kf ? toAbsolute(kf.path) : null, clipLength(episode, scenes, index), ctx, mode);
      const cached = Boolean(plan.key && hasCached(plan.key));
      clip = { cost: cached ? 0 : plan.estimate, cached };
    }
    if (has("narration")) {
      const plans = planVoices(scene, series, characters, mode);
      const uncached = plans.filter((p) => hypothetical || !hasCached(p.key));
      voice = { cost: uncached.reduce((s, p) => s + p.estimate, 0), cached: uncached.length === 0 && plans.length > 0, lines: plans.length };
    }
    const total = (keyframe?.cost ?? 0) + (clip?.cost ?? 0) + (voice?.cost ?? 0);
    return { scene_id: scene.scene_id, keyframe, clip, voice, total: round4(total) };
  });

  let thumbnails: CostLine | null = null;
  if (has("thumbnails")) {
    const plans = planThumbnails(episode, hypothetical ? [] : scenes, ctx, mode);
    const uncached = plans.filter((p) => hypothetical || !hasCached(p.key));
    thumbnails = { cost: uncached.reduce((s, p) => s + p.estimate, 0), cached: uncached.length === 0 };
  }

  const total = llmCost + (thumbnails?.cost ?? 0) + sceneEstimates.reduce((s, x) => s + x.total, 0);
  const fullPrice =
    llmCost +
    (has("thumbnails") ? 2 * getImageProvider(mode).estimateCost({ width: 1080, height: 1920, quality: providers.image.quality }) : 0) +
    scenes.reduce((sum, scene, index) => {
      let s = 0;
      if (has("keyframes")) s += planKeyframe(scene, ctx, mode).estimate;
      if (has("clips")) s += planClip(scene, null, clipLength(episode, scenes, index), ctx, mode).estimate;
      if (has("narration")) s += planVoices(scene, series, characters, mode).reduce((a, p) => a + p.estimate, 0);
      return sum + s;
    }, 0);
  if (mock) notes.push("Mock mode is active: no paid API will be called.");
  if (providers.video.provider === "mock" && has("clips")) notes.push("Video uses the free animatic renderer (camera moves on keyframes).");
  return {
    mode,
    stages: [...stages],
    mock,
    providers,
    llm: round4(llmCost),
    thumbnails,
    scenes: sceneEstimates,
    hypotheticalScenes: hypothetical,
    total: round4(total),
    fullPrice: round4(fullPrice),
    budget: config.cost.maxEpisodeBudgetUsd,
    overBudget: total > config.cost.maxEpisodeBudgetUsd,
    notes,
  };
}

function placeholderScene(i: number): Scene {
  return {
    scene_id: `s${String(i + 1).padStart(2, "0")}`,
    beat: "scene_1",
    duration: 6,
    description: "",
    characters: [],
    location: "",
    camera: "",
    camera_framing: "medium shot",
    camera_movement: "slow push-in",
    action: "placeholder",
    subject_motion: "",
    environment: "",
    environment_motion: "",
    facial_expression: "",
    lighting: "",
    emotion: "",
    transition: "cut",
    narration: "",
    dialogue: [],
    sound_design: "",
    image_prompt: `placeholder shot ${i}`,
    video_prompt: `placeholder shot ${i}`,
    negative_prompt: "",
    seed: i,
    locked_fields: [],
    notes: "",
  };
}
