import { z } from "zod";
import type { RenderMode } from "@/lib/config";
import {
  BEATS,
  ContinuityUpdateSchema,
  EpisodeMetadataSchema,
  ScreenplaySchema,
  ShotListSchema,
  type Beat,
  type Character,
  type Episode,
  type EpisodeMetadata,
  type Location,
  type Scene,
  type Screenplay,
  type SeriesState,
  type Shot,
} from "@/lib/types";
import { getLLM } from "@/lib/ai/registry";
import { generateJson } from "@/lib/ai/json";
import type { LLMResult } from "@/lib/ai/types";
import { renderChatPrompt } from "@/lib/prompts/template";
import {
  countWords,
  formatBeatsAsScreenplay,
  formatCharacterList,
  formatContinuity,
  formatLocationList,
  formatScenesAsScript,
  formatStructure,
  spokenWords,
} from "@/lib/prompts/formatters";
import { applyScenePrompts, buildThumbnailPrompts, type PromptContext } from "@/lib/prompts/engine";
import { FRAMINGS, MOVEMENTS, TRANSITIONS } from "@/lib/prompts/vocabulary";
import { getSeries, getStateBefore, listCharacters, listLocations, putSnapshot } from "@/lib/db/repos/series";
import { listEpisodes, listScenes } from "@/lib/db/repos/episodes";
import { hashString, Rng } from "@/lib/ai/mock/rng";
import type { ContinuityContext, MetadataContext, PreviousEpisode, ShotContext, StoryContext } from "@/lib/story/contexts";

/** Result of an LLM-backed stage: the data plus what it cost. */
export interface StageResult<T> {
  data: T;
  cost: number;
  provider: string;
  model: string;
  calls: LLMResult[];
}

function summarize<T>(data: T, llmName: string, calls: LLMResult[]): StageResult<T> {
  return { data, cost: calls.reduce((s, c) => s + c.cost, 0), provider: llmName, model: calls[0]?.model ?? "", calls };
}

export function wordBudget(targetDuration: number, wpm: number) {
  const base = (targetDuration * wpm) / 60;
  // Leaves room for pauses, lead-ins and transitions inside the target duration.
  return { min: Math.round(base * 0.8), max: Math.round(base * 0.93) };
}

function previousEpisodes(seriesId: string, episodeNumber: number): PreviousEpisode[] {
  return listEpisodes(seriesId)
    .filter((e) => e.episode_number < episodeNumber && (e.summary || e.hook))
    .slice(-3)
    .map((e) => ({
      episode_number: e.episode_number,
      title: e.title,
      summary: e.summary,
      cliffhanger: e.cliffhanger,
      next_episode_tease: e.next_episode_tease,
    }));
}

function formatPrevious(prev: PreviousEpisode[]): string {
  if (!prev.length) return "This is the first episode of the series.";
  return prev
    .map(
      (p) =>
        `EP ${p.episode_number} "${p.title}": ${p.summary}\n  Ended on: ${p.cliffhanger}\n  Promised next: ${p.next_episode_tease}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// STAGE 1 — Story
// ---------------------------------------------------------------------------

export async function generateScreenplay(episode: Episode, mode: RenderMode): Promise<StageResult<Screenplay>> {
  const series = getSeries(episode.series_id)!;
  const characters = listCharacters(series.id);
  const locations = listLocations(series.id);
  // Continuity comes from the database snapshot, never from LLM memory.
  const state = getStateBefore(series.id, episode.episode_number);
  const previous = previousEpisodes(series.id, episode.episode_number);
  const wpm = series.settings.words_per_minute;
  const budget = wordBudget(episode.target_duration, wpm);
  const ctx: StoryContext = {
    series,
    episodeNumber: episode.episode_number,
    synopsis: episode.synopsis,
    tone: episode.tone,
    targetDuration: episode.target_duration,
    wordsPerMinute: wpm,
    minWords: budget.min,
    maxWords: budget.max,
    characters,
    locations,
    state,
    previous,
  };
  const prompt = renderChatPrompt("story_prompt", {
    series_title: series.title,
    series_logline: series.logline,
    series_tone: series.tone,
    episode_number: episode.episode_number,
    target_duration: episode.target_duration,
    synopsis: episode.synopsis,
    tone: episode.tone,
    character_list: formatCharacterList(characters),
    location_list: formatLocationList(locations),
    continuity: formatContinuity(state, characters, locations),
    previously: formatPrevious(previous),
    structure: formatStructure(episode.target_duration),
    min_words: budget.min,
    max_words: budget.max,
    wpm,
  });
  const llm = getLLM(mode);
  const { data, calls } = await generateJson(llm, { task: "story", system: prompt.system, prompt: prompt.user, context: ctx, maxTokens: 6000 }, ScreenplaySchema);
  return summarize(sanitizeScreenplay(data, characters, locations), llm.name, calls);
}

function sanitizeScreenplay(sp: Screenplay, characters: Character[], locations: Location[]): Screenplay {
  const charIds = new Set(characters.map((c) => c.id));
  const locIds = new Set(locations.map((l) => l.id));
  const fallbackLoc = locations[0]?.id ?? "";
  const byBeat = new Map(sp.beats.map((b) => [b.beat, b]));
  const beats: Beat[] = BEATS.map((id) => {
    const b = byBeat.get(id) ?? { beat: id, summary: "", location: fallbackLoc, characters: [], narration: "", dialogue: [], emotion: "" };
    return {
      ...b,
      location: locIds.has(b.location) ? b.location : (locations.find((l) => l.name.toLowerCase() === b.location.toLowerCase())?.id ?? fallbackLoc),
      characters: b.characters.filter((c) => charIds.has(c)),
      dialogue: b.dialogue.filter((d) => charIds.has(d.character_id)),
    };
  });
  const hookBeat = beats[0];
  if (!hookBeat.narration) hookBeat.narration = sp.hook;
  const cliff = beats[beats.length - 1];
  if (!cliff.narration) cliff.narration = sp.cliffhanger;
  return { ...sp, hook: hookBeat.narration, cliffhanger: cliff.narration, beats };
}

export function screenplayToEpisodePatch(sp: Screenplay, current: Episode) {
  return {
    title: current.title || sp.title,
    summary: sp.summary,
    hook: sp.hook,
    beats: sp.beats,
    cliffhanger: sp.cliffhanger,
    next_episode_tease: sp.next_episode_tease,
    narration: sp.beats.map((b) => b.narration).filter(Boolean).join(" "),
  };
}

export function screenplayWordCount(beats: Beat[]) {
  return spokenWords(beats);
}

// ---------------------------------------------------------------------------
// STAGE 2 — Shot list
// ---------------------------------------------------------------------------

export async function generateShotList(episode: Episode, ctx: PromptContext, mode: RenderMode): Promise<StageResult<Scene[]>> {
  const series = ctx.series;
  if (!episode.beats.length) throw new Error("Generate the script first — this episode has no beats yet.");
  const shotCtx: ShotContext = {
    series,
    episodeNumber: episode.episode_number,
    targetDuration: episode.target_duration,
    minShots: 6,
    maxShots: 10,
    wordsPerMinute: series.settings.words_per_minute,
    beats: episode.beats,
    characters: ctx.characters,
    locations: ctx.locations,
  };
  const prompt = renderChatPrompt("shotlist_prompt", {
    series_title: series.title,
    target_duration: episode.target_duration,
    min_shots: 6,
    max_shots: 10,
    screenplay: formatBeatsAsScreenplay(episode.beats, ctx.characters),
    character_list: formatCharacterList(ctx.characters),
    location_list: formatLocationList(ctx.locations),
    framings: FRAMINGS.join(", "),
    movements: MOVEMENTS.join(", "),
    transitions: TRANSITIONS.join(", "),
  });
  const llm = getLLM(mode);
  const { data, calls } = await generateJson(llm, { task: "shotlist", system: prompt.system, prompt: prompt.user, context: shotCtx, maxTokens: 8000 }, ShotListSchema);
  const scenes = shotsToScenes(data.shots, episode, ctx);
  return summarize(scenes, llm.name, calls);
}

/** Post-processing that holds regardless of which LLM wrote the shot list. */
export function shotsToScenes(input: Shot[], episode: Pick<Episode, "series_id" | "episode_number" | "target_duration">, ctx: PromptContext): Scene[] {
  let shots = [...input];
  // Hard cap of 10 shots: merge the shortest neighbouring pair within the same beat.
  while (shots.length > 10) {
    let best = -1;
    for (let i = 0; i < shots.length - 1; i++) {
      if (shots[i].beat !== shots[i + 1].beat) continue;
      if (best < 0 || shots[i].duration + shots[i + 1].duration < shots[best].duration + shots[best + 1].duration) best = i;
    }
    if (best < 0) best = shots.length - 2;
    const a = shots[best];
    const b = shots[best + 1];
    shots.splice(best, 2, {
      ...a,
      duration: a.duration + b.duration,
      narration: [a.narration, b.narration].filter(Boolean).join(" "),
      dialogue: [...a.dialogue, ...b.dialogue],
      characters: [...new Set([...a.characters, ...b.characters])],
    });
  }
  const charIds = new Set(ctx.characters.map((c) => c.id));
  const locIds = new Set(ctx.locations.map((l) => l.id));
  const rng = new Rng(`${episode.series_id}:${episode.episode_number}:camera`);
  // Camera variety: never the same framing or movement twice in a row.
  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1];
    const cur = shots[i];
    if (norm(cur.camera_framing) === norm(prev.camera_framing)) {
      cur.camera_framing = rng.pick(FRAMINGS.filter((f) => norm(f) !== norm(prev.camera_framing) && norm(f) !== norm(shots[i + 1]?.camera_framing ?? "")));
    }
    if (norm(cur.camera_movement) === norm(prev.camera_movement)) {
      cur.camera_movement = rng.pick(MOVEMENTS.filter((m) => norm(m) !== norm(prev.camera_movement) && norm(m) !== norm(shots[i + 1]?.camera_movement ?? "")));
    }
  }
  // Durations: 2–11 s each, total within ±2 s of the target.
  shots = shots.map((s) => ({ ...s, duration: Math.min(11, Math.max(2, s.duration)) }));
  const total = shots.reduce((s, x) => s + x.duration, 0);
  if (Math.abs(total - episode.target_duration) > 2) {
    const k = episode.target_duration / total;
    shots = shots.map((s) => ({ ...s, duration: Math.round(Math.min(11, Math.max(2, s.duration * k)) * 10) / 10 }));
  }
  return shots.map((shot, i) => {
    const sceneId = `s${String(i + 1).padStart(2, "0")}`;
    const scene: Scene = {
      scene_id: sceneId,
      beat: shot.beat,
      duration: Math.round(shot.duration * 10) / 10,
      description: shot.description,
      characters: shot.characters.filter((c) => charIds.has(c)),
      location: locIds.has(shot.location) ? shot.location : (ctx.locations[0]?.id ?? ""),
      camera: "",
      camera_framing: shot.camera_framing || "medium shot",
      camera_movement: shot.camera_movement || "slow push-in",
      action: shot.action,
      subject_motion: shot.subject_motion,
      environment: shot.environment,
      environment_motion: shot.environment_motion,
      facial_expression: shot.facial_expression,
      lighting: shot.lighting,
      emotion: shot.emotion,
      transition: shot.transition || "cut",
      narration: shot.narration,
      dialogue: shot.dialogue.filter((d) => charIds.has(d.character_id)),
      sound_design: shot.sound_design,
      image_prompt: "",
      video_prompt: "",
      negative_prompt: "",
      seed: hashString(`${episode.series_id}:${episode.episode_number}:${sceneId}`),
      locked_fields: [],
      notes: "",
    };
    return applyScenePrompts(scene, ctx);
  });
}

const norm = (s: string) => s.trim().toLowerCase();

// ---------------------------------------------------------------------------
// STAGES 3 & 4 — Prompts (deterministic)
// ---------------------------------------------------------------------------

export function regeneratePrompts(scenes: Scene[], ctx: PromptContext, durations?: Map<string, number>): Scene[] {
  return scenes.map((s) => applyScenePrompts(s, ctx, durations?.get(s.scene_id)));
}

// ---------------------------------------------------------------------------
// Social metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(episode: Episode, scenes: Scene[], ctx: PromptContext, mode: RenderMode): Promise<StageResult<EpisodeMetadata>> {
  const series = ctx.series;
  const inEpisode = new Set(scenes.flatMap((s) => s.characters));
  const characters = ctx.characters.filter((c) => inEpisode.has(c.id));
  const metaCtx: MetadataContext = {
    series,
    episodeNumber: episode.episode_number,
    title: episode.title,
    summary: episode.summary,
    hook: episode.hook,
    cliffhanger: episode.cliffhanger,
    nextEpisodeTease: episode.next_episode_tease,
    characters: characters.length ? characters : ctx.characters,
  };
  const prompt = renderChatPrompt("metadata_prompt", {
    series_title: series.title,
    episode_number: episode.episode_number,
    episode_code: String(episode.episode_number).padStart(2, "0"),
    episode_title: episode.title,
    summary: episode.summary,
    hook: episode.hook,
    cliffhanger: episode.cliffhanger,
    next_episode_tease: episode.next_episode_tease,
    character_list: formatCharacterList(metaCtx.characters),
    series_hashtags: series.settings.hashtags.join(" "),
  });
  const llm = getLLM(mode);
  const { data, calls } = await generateJson(
    llm,
    { task: "metadata", system: prompt.system, prompt: prompt.user, context: metaCtx, maxTokens: 2500 },
    z.record(z.string(), z.unknown()),
  );
  // Only the keys the model returned replace existing metadata.
  const returned = Object.fromEntries(Object.entries(data).filter(([k, v]) => k in EpisodeMetadataSchema.shape && v !== undefined && v !== null));
  const merged = EpisodeMetadataSchema.parse({ ...episode.metadata, ...returned });
  merged.hashtags = normalizeHashtags(merged.hashtags);
  merged.thumbnail_characters = merged.thumbnail_characters.filter((id) => ctx.characters.some((c) => c.id === id)).slice(0, 3);
  const thumbs = buildThumbnailPrompts(merged, scenes, ctx);
  merged.thumbnail_prompt_vertical = thumbs.vertical;
  merged.thumbnail_prompt_landscape = thumbs.landscape;
  return summarize(merged, llm.name, calls);
}

function normalizeHashtags(tags: string[]): string[] {
  const out = tags
    .flatMap((t) => t.split(/\s+/))
    .map((t) => t.replace(/[^\p{L}\p{N}_#]/gu, ""))
    .filter((t) => t.replace("#", "").length > 1)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
  return [...new Map(out.map((t) => [t.toLowerCase(), t])).values()].slice(0, 10);
}

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

export async function updateContinuity(episode: Episode, scenes: Scene[], mode: RenderMode): Promise<StageResult<SeriesState>> {
  const series = getSeries(episode.series_id)!;
  const characters = listCharacters(series.id);
  const locations = listLocations(series.id);
  const previousState = getStateBefore(series.id, episode.episode_number);
  const ctx: ContinuityContext = {
    series,
    episodeNumber: episode.episode_number,
    episodeTitle: episode.title,
    summary: episode.summary,
    cliffhanger: episode.cliffhanger,
    nextEpisodeTease: episode.next_episode_tease,
    synopsis: episode.synopsis,
    beats: episode.beats,
    previousState,
    characters,
    locations,
  };
  const { series_id: _sid, updated_at: _ua, ...prevForPrompt } = previousState;
  void _sid;
  void _ua;
  const prompt = renderChatPrompt("continuity_prompt", {
    series_title: series.title,
    episode_number: episode.episode_number,
    episode_title: episode.title,
    previous_state: JSON.stringify(prevForPrompt, null, 2),
    episode_script: scenes.length
      ? formatScenesAsScript(episode, scenes, characters)
      : formatBeatsAsScreenplay(episode.beats, characters),
    character_ids: characters.map((c) => c.id).join(", "),
    location_ids: locations.map((l) => l.id).join(", "),
  });
  const llm = getLLM(mode);
  const { data, calls } = await generateJson(
    llm,
    { task: "continuity", system: prompt.system, prompt: prompt.user, context: ctx, maxTokens: 6000 },
    ContinuityUpdateSchema,
  );
  const validIds = new Set(characters.map((c) => c.id));
  const character_states = Object.fromEntries(
    Object.entries({ ...previousState.character_states, ...data.character_states }).filter(([id]) => validIds.has(id)),
  );
  const state = putSnapshot(series.id, episode.episode_number, { ...data, character_states, as_of_episode: episode.episode_number, series_id: series.id });
  return summarize(state, llm.name, calls);
}

export { countWords };
