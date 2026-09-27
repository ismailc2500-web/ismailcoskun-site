import { z } from "zod";

/**
 * Domain model. Zod schemas are the single source of truth: they validate the
 * JSON files in /data, the output of every LLM call and the bodies of API
 * requests. Field names are snake_case so that the JSON on disk maps 1:1 to
 * the TypeScript types.
 */

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits and dashes");

// ---------------------------------------------------------------------------
// Characters & world
// ---------------------------------------------------------------------------

export const ARCHETYPES = ["hero", "mentor", "companion", "ally", "antagonist", "creature", "other"] as const;

export const VoiceConfigSchema = z.object({
  /** Base pitch for the mock / placeholder voice. */
  pitch_hz: z.number().min(40).max(400).optional(),
  /** Speaking speed multiplier (1 = normal). */
  speed: z.number().min(0.5).max(2).optional(),
  openai_voice: z.string().optional(),
  elevenlabs_voice_id: z.string().optional(),
  local_voice: z.string().optional(),
});
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

export const PaletteSchema = z.object({
  primary: z.string().default("#5b6b4a"),
  secondary: z.string().default("#3b3024"),
  accent: z.string().default("#f5b642"),
});

export const CharacterSchema = z.object({
  id: slug,
  display_name: z.string().min(1),
  role: z.string().default(""),
  archetype: z.enum(ARCHETYPES).default("other").catch("other"),
  /** Short noun phrase that opens the consistency block, e.g. "elderly pear-headed wizard". */
  descriptor: z.string().default(""),
  fruit: z.string().min(1),
  fruit_description: z.string().default(""),
  /** How eyes / brows / mouth are integrated into the fruit. */
  face_description: z.string().default(""),
  body_description: z.string().default(""),
  costume: z.string().default(""),
  props: z.array(z.string()).default([]),
  height: z.string().default(""),
  personality: z.string().default(""),
  visual_traits: z.array(z.string()).default([]),
  negative_traits: z.array(z.string()).default([]),
  voice_profile: z.string().default(""),
  voice: VoiceConfigSchema.prefault({}),
  reference_images: z.array(z.string()).default([]),
  palette: PaletteSchema.prefault({}),
  /** When locked, appearance edits are rejected and the frozen block below is injected verbatim. */
  locked: z.boolean().default(false),
  locked_block: z.string().optional(),
});
export type Character = z.infer<typeof CharacterSchema>;
export type CharacterInput = z.input<typeof CharacterSchema>;

/** Fields that define the look of a character (frozen by "lock appearance"). */
export const APPEARANCE_FIELDS = [
  "descriptor",
  "fruit",
  "fruit_description",
  "face_description",
  "body_description",
  "costume",
  "props",
  "height",
  "visual_traits",
  "negative_traits",
  "palette",
] as const;

export const ENVIRONMENT_TYPES = [
  "village",
  "forest",
  "mountain",
  "volcanic",
  "sanctuary",
  "river",
  "cave",
  "castle",
  "plains",
  "other",
] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

export const LocationSchema = z.object({
  id: slug,
  name: z.string().min(1),
  environment_type: z.enum(ENVIRONMENT_TYPES).default("other").catch("other"),
  description: z.string().default(""),
  lighting: z.string().default(""),
  atmosphere: z.string().default(""),
  visual_details: z.array(z.string()).default([]),
  /** Ambience bed used by the sound designer (e.g. forest_ambience). */
  ambience: z.string().default(""),
  palette: z
    .object({
      sky: z.string().default("#1d2433"),
      ground: z.string().default("#1b1f16"),
      accent: z.string().default("#f5b642"),
    })
    .prefault({}),
});
export type Location = z.infer<typeof LocationSchema>;
export type LocationInput = z.input<typeof LocationSchema>;

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export const SeriesSettingsSchema = z.object({
  words_per_minute: z.number().min(90).max(220).default(150),
  narrator_voice: VoiceConfigSchema.prefault({}),
  narrator_voice_profile: z
    .string()
    .default("deep, warm, cinematic trailer narrator with a dry comedic undertone; unhurried, clear diction"),
  default_tone: z.string().default("epic-comedic"),
  intro: z
    .object({
      enabled: z.boolean().default(false),
      duration: z.number().min(0.5).max(6).default(2),
      video_path: z.string().default(""),
      text: z.string().default(""),
    })
    .prefault({}),
  outro: z
    .object({
      enabled: z.boolean().default(true),
      duration: z.number().min(0.5).max(6).default(2),
      video_path: z.string().default(""),
      text: z.string().default(""),
    })
    .prefault({}),
  subtitles: z
    .object({
      mode: z.enum(["phrase", "word"]).default("word"),
      burn_in: z.boolean().default(true),
      uppercase: z.boolean().default(false),
      font: z.string().default(""),
    })
    .prefault({}),
  /** How the 16:9 export is derived from 9:16 material (and vice versa). */
  landscape_strategy: z.enum(["blur", "crop"]).default("blur"),
  music: z
    .object({
      mood: z.string().default("dark-epic"),
      volume_db: z.number().min(-40).max(0).default(-15),
      duck_db: z.number().min(0).max(30).default(10),
    })
    .prefault({}),
  finishing: z
    .object({
      film_grain: z.boolean().default(true),
      vignette: z.boolean().default(true),
    })
    .prefault({}),
  hashtags: z.array(z.string()).default([]),
});
export type SeriesSettings = z.infer<typeof SeriesSettingsSchema>;

export const SeriesSchema = z.object({
  id: slug,
  title: z.string().min(1),
  logline: z.string().default(""),
  tone: z.string().default("epic fantasy parody, cinematic and sincere, with absurd fruit humour"),
  style_notes: z.string().default(""),
  settings: SeriesSettingsSchema.prefault({}),
});
export type Series = z.infer<typeof SeriesSchema>;
export type SeriesInput = z.input<typeof SeriesSchema>;

// ---------------------------------------------------------------------------
// Episodes, beats & scenes
// ---------------------------------------------------------------------------

export const BEATS = ["hook", "scene_1", "scene_2", "scene_3", "scene_4", "scene_5", "cliffhanger"] as const;
export type BeatId = (typeof BEATS)[number];
export const BEAT_LABELS: Record<BeatId, string> = {
  hook: "Hook",
  scene_1: "Scene 1",
  scene_2: "Scene 2",
  scene_3: "Scene 3",
  scene_4: "Scene 4",
  scene_5: "Scene 5 / Climax",
  cliffhanger: "Cliffhanger",
};
/** Default structure for a 60 second episode: [start, end] in seconds. */
export const BEAT_STRUCTURE: Record<BeatId, [number, number]> = {
  hook: [0, 3],
  scene_1: [3, 12],
  scene_2: [12, 22],
  scene_3: [22, 32],
  scene_4: [32, 43],
  scene_5: [43, 53],
  cliffhanger: [53, 60],
};

export const DialogueLineSchema = z.object({
  character_id: z.string().min(1),
  line: z.string().min(1),
});
export type DialogueLine = z.infer<typeof DialogueLineSchema>;

export const BeatSchema = z.object({
  beat: z.enum(BEATS),
  summary: z.string().default(""),
  location: z.string().default(""),
  characters: z.array(z.string()).default([]),
  narration: z.string().default(""),
  dialogue: z.array(DialogueLineSchema).default([]),
  emotion: z.string().default(""),
});
export type Beat = z.infer<typeof BeatSchema>;

export const SceneSchema = z.object({
  scene_id: z.string().min(1),
  beat: z.enum(BEATS).catch("scene_1"),
  duration: z.number().min(1).max(30).default(6),
  description: z.string().default(""),
  characters: z.array(z.string()).default([]),
  location: z.string().default(""),
  /** Human-readable camera summary (framing + movement). */
  camera: z.string().default(""),
  camera_framing: z.string().default(""),
  camera_movement: z.string().default(""),
  action: z.string().default(""),
  subject_motion: z.string().default(""),
  environment: z.string().default(""),
  environment_motion: z.string().default(""),
  facial_expression: z.string().default(""),
  lighting: z.string().default(""),
  emotion: z.string().default(""),
  transition: z.string().default("cut"),
  narration: z.string().default(""),
  dialogue: z.array(DialogueLineSchema).default([]),
  sound_design: z.string().default(""),
  image_prompt: z.string().default(""),
  video_prompt: z.string().default(""),
  negative_prompt: z.string().default(""),
  seed: z.number().int().nonnegative().default(0),
  /** Fields edited by hand; automatic regeneration never overwrites them. */
  locked_fields: z.array(z.string()).default([]),
  notes: z.string().default(""),
});
export type Scene = z.infer<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;

export const EpisodeMetadataSchema = z.object({
  youtube_title: z.string().default(""),
  tiktok_caption: z.string().default(""),
  instagram_caption: z.string().default(""),
  youtube_description: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  thumbnail_text: z.string().default(""),
  thumbnail_concept: z.string().default(""),
  thumbnail_characters: z.array(z.string()).default([]),
  thumbnail_prompt_vertical: z.string().default(""),
  thumbnail_prompt_landscape: z.string().default(""),
  next_episode_teaser: z.string().default(""),
});
export type EpisodeMetadata = z.infer<typeof EpisodeMetadataSchema>;

export const SoundCueSchema = z.object({
  id: z.string(),
  type: z.string(),
  start: z.number().min(0),
  duration: z.number().min(0.05),
  volume_db: z.number().default(-12),
  scene_id: z.string().default(""),
  note: z.string().default(""),
});
export type SoundCue = z.infer<typeof SoundCueSchema>;

export const SoundPlanSchema = z.object({
  music: z
    .object({
      mood: z.string().default("dark-epic"),
      source: z.enum(["procedural", "library"]).default("procedural"),
      file: z.string().default(""),
      volume_db: z.number().default(-15),
      duck_db: z.number().default(10),
      fade_in: z.number().default(0.8),
      fade_out: z.number().default(1.5),
      /** Seconds where the score swells (climax, cliffhanger). */
      swells: z.array(z.number()).default([]),
    })
    .prefault({}),
  ambience: z.array(SoundCueSchema).default([]),
  sfx: z.array(SoundCueSchema).default([]),
});
export type SoundPlan = z.infer<typeof SoundPlanSchema>;

export const WordTimingSchema = z.object({ word: z.string(), start: z.number(), end: z.number() });
export type WordTiming = z.infer<typeof WordTimingSchema>;

export const VoiceClipSchema = z.object({
  id: z.string(),
  scene_id: z.string(),
  speaker: z.string(),
  text: z.string(),
  start: z.number(),
  duration: z.number(),
  file: z.string(),
  words: z.array(WordTimingSchema).default([]),
});
export type VoiceClip = z.infer<typeof VoiceClipSchema>;

export const TimelineSceneSchema = z.object({
  scene_id: z.string(),
  start: z.number(),
  duration: z.number(),
  transition: z.string().default("cut"),
  transition_duration: z.number().default(0),
});
export type TimelineScene = z.infer<typeof TimelineSceneSchema>;

export const TimelineSchema = z.object({
  intro_duration: z.number().default(0),
  outro_duration: z.number().default(0),
  content_duration: z.number(),
  total_duration: z.number(),
  scenes: z.array(TimelineSceneSchema),
  voice: z.array(VoiceClipSchema).default([]),
  computed_at: z.string().default(""),
});
export type Timeline = z.infer<typeof TimelineSchema>;

export const PLATFORMS = ["tiktok", "youtube_shorts", "instagram_reels", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TikTok 9:16",
  youtube_shorts: "YouTube Shorts 9:16",
  instagram_reels: "Instagram Reels 9:16",
  youtube: "YouTube 16:9",
};

export const EPISODE_STATUSES = [
  "draft",
  "scripted",
  "shotlisted",
  "prompted",
  "voiced",
  "assets_ready",
  "rendered",
  "published",
] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const EpisodeSchema = z.object({
  episode_number: z.number().int().min(1),
  title: z.string().default(""),
  summary: z.string().default(""),
  synopsis: z.string().default(""),
  tone: z.string().default("epic-comedic"),
  target_duration: z.number().min(15).max(180).default(60),
  platform: z.enum(PLATFORMS).default("youtube_shorts"),
  mode: z.enum(["preview", "final"]).default("preview"),
  status: z.enum(EPISODE_STATUSES).default("draft").catch("draft"),
  hook: z.string().default(""),
  narration: z.string().default(""),
  beats: z.array(BeatSchema).default([]),
  scenes: z.array(SceneSchema).default([]),
  cliffhanger: z.string().default(""),
  next_episode_tease: z.string().default(""),
  metadata: EpisodeMetadataSchema.prefault({}),
  sound_plan: SoundPlanSchema.nullable().default(null),
  timeline: TimelineSchema.nullable().default(null),
  continuity_committed: z.boolean().default(false),
  notes: z.string().default(""),
});
export type EpisodeData = z.infer<typeof EpisodeSchema>;
export type EpisodeInput = z.input<typeof EpisodeSchema>;

/** Episode as stored in SQLite (scenes live in their own table). */
export type Episode = Omit<EpisodeData, "scenes"> & {
  id: number;
  series_id: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

export const CharacterStateSchema = z.object({
  location: z.string().default(""),
  status: z.string().default("active"),
  possessions: z.array(z.string()).default([]),
  injuries: z.array(z.string()).default([]),
  emotional_state: z.string().default(""),
  notes: z.string().default(""),
});
export type CharacterState = z.infer<typeof CharacterStateSchema>;

export const SeriesStateSchema = z.object({
  series_id: z.string(),
  as_of_episode: z.number().int().min(0).default(0),
  current_objective: z.string().default(""),
  major_events: z.array(z.object({ episode: z.number().int(), event: z.string() })).default([]),
  character_states: z.record(z.string(), CharacterStateSchema).default({}),
  relationships: z
    .array(z.object({ a: z.string(), b: z.string(), status: z.string() }))
    .default([]),
  villain_state: z.string().default(""),
  unresolved_plot_points: z.array(z.string()).default([]),
  world_notes: z.array(z.string()).default([]),
  episode_summaries: z
    .array(
      z.object({
        episode: z.number().int(),
        title: z.string().default(""),
        summary: z.string().default(""),
        cliffhanger: z.string().default(""),
      }),
    )
    .default([]),
  updated_at: z.string().default(""),
});
export type SeriesState = z.infer<typeof SeriesStateSchema>;
export type SeriesStateInput = z.input<typeof SeriesStateSchema>;

// ---------------------------------------------------------------------------
// LLM stage outputs
// ---------------------------------------------------------------------------

export const ScreenplaySchema = z.object({
  title: z.string().min(1),
  summary: z.string().default(""),
  hook: z.string().min(1),
  beats: z.array(BeatSchema).min(5).max(9),
  cliffhanger: z.string().min(1),
  next_episode_tease: z.string().default(""),
});
export type Screenplay = z.infer<typeof ScreenplaySchema>;

export const ShotSchema = z.object({
  beat: z.enum(BEATS).catch("scene_1"),
  duration: z.number().min(1).max(20),
  description: z.string().default(""),
  characters: z.array(z.string()).default([]),
  location: z.string().default(""),
  action: z.string().default(""),
  subject_motion: z.string().default(""),
  camera_framing: z.string().default(""),
  camera_movement: z.string().default(""),
  environment: z.string().default(""),
  environment_motion: z.string().default(""),
  lighting: z.string().default(""),
  emotion: z.string().default(""),
  facial_expression: z.string().default(""),
  transition: z.string().default("cut"),
  narration: z.string().default(""),
  dialogue: z.array(DialogueLineSchema).default([]),
  sound_design: z.string().default(""),
});
export type Shot = z.infer<typeof ShotSchema>;

export const ShotListSchema = z.object({ shots: z.array(ShotSchema).min(3).max(14) });
export type ShotList = z.infer<typeof ShotListSchema>;

export const ContinuityUpdateSchema = SeriesStateSchema.omit({ series_id: true, updated_at: true });
export type ContinuityUpdate = z.infer<typeof ContinuityUpdateSchema>;

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export const STAGES = [
  "script",
  "shotlist",
  "prompts",
  "metadata",
  "narration",
  "sound",
  "subtitles",
  "keyframes",
  "clips",
  "thumbnails",
  "mix",
  "assemble",
  "continuity",
] as const;
export type Stage = (typeof STAGES)[number];

export const PIPELINE_ACTIONS = {
  script: ["script"],
  shotlist: ["shotlist"],
  prompts: ["prompts", "metadata"],
  generate: ["script", "shotlist", "prompts", "metadata", "narration", "sound", "subtitles"],
  assets: ["narration", "sound", "subtitles", "keyframes", "clips", "thumbnails"],
  render: ["narration", "sound", "subtitles", "keyframes", "clips", "thumbnails", "mix", "assemble"],
  all: [
    "script",
    "shotlist",
    "prompts",
    "metadata",
    "narration",
    "sound",
    "subtitles",
    "keyframes",
    "clips",
    "thumbnails",
    "mix",
    "assemble",
  ],
} as const satisfies Record<string, readonly Stage[]>;
export type PipelineAction = keyof typeof PIPELINE_ACTIONS;

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cached" | "skipped";

export interface GenerationJob {
  id: number;
  episode_id: number;
  run_id: string;
  scene_id: string | null;
  stage: Stage;
  label: string;
  status: JobStatus;
  progress: number;
  attempts: number;
  provider: string | null;
  model: string | null;
  cache_key: string | null;
  estimated_cost: number;
  actual_cost: number;
  error: string | null;
  output: Record<string, unknown> | null;
  runner_pid: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export type AssetKind =
  | "keyframe"
  | "clip"
  | "voice"
  | "narration"
  | "music"
  | "sfx"
  | "mix"
  | "subtitle_srt"
  | "subtitle_ass"
  | "render_vertical"
  | "render_landscape"
  | "thumbnail_vertical"
  | "thumbnail_landscape"
  | "reference";

export interface Asset {
  id: number;
  episode_id: number | null;
  scene_id: string | null;
  kind: AssetKind;
  variant: string;
  path: string;
  cache_key: string | null;
  provider: string | null;
  model: string | null;
  cost: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export type ProviderKind = "llm" | "image" | "video" | "tts";

export interface ProviderSetting {
  kind: ProviderKind;
  mode: "preview" | "final";
  provider: string;
  model: string;
  quality: string;
  pricing: Record<string, number>;
}

export interface EpisodeAnalytics {
  id: number;
  episode_id: number;
  platform: string;
  captured_at: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avg_watch_seconds: number;
  completion_rate: number;
  ctr: number;
  followers_gained: number;
  retention: number[];
  notes: string;
}
