import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { seriesDir, type RenderMode } from "@/lib/config";
import {
  APPEARANCE_FIELDS,
  CharacterSchema,
  EpisodeSchema,
  LocationSchema,
  SceneSchema,
  SeriesSchema,
  SeriesStateSchema,
  type Character,
  type CharacterInput,
  type Episode,
  type Scene,
  type SceneInput,
} from "@/lib/types";
import {
  deleteCharacter,
  deleteLocation,
  getCharacter,
  getLatestState,
  getLocation,
  getSeries,
  putSnapshot,
  saveCharacter,
  saveLocation,
  upsertSeries,
} from "@/lib/db/repos/series";
import {
  createEpisode,
  deleteEpisode,
  deleteScene,
  getEpisode,
  getEpisodeByNumber,
  getScene,
  listScenes,
  nextEpisodeNumber,
  replaceScenes,
  saveScene,
  updateEpisode,
} from "@/lib/db/repos/episodes";
import { exportContinuity, exportEpisode, exportSeriesMeta, removeEpisodeFile } from "@/lib/data-sync";
import { aspectForPlatform, promptContext } from "@/lib/context";
import { applyScenePrompts, buildCharacterSheetPrompt, characterBlock, PROMPT_FIELDS } from "@/lib/prompts/engine";
import { getImageProvider, resolveProvider } from "@/lib/ai/registry";
import { cachedGenerate, hashKey } from "@/lib/ai/cache";
import { withRetry } from "@/lib/ai/retry";
import { artSceneForPortrait } from "@/lib/ai/mock/art";
import { hashString } from "@/lib/ai/mock/rng";
import { toRelative } from "@/lib/db/repos/assets";

/**
 * Application services used by the API routes: validation, character locks,
 * hand-edit tracking on scenes, uploads — and keeping the JSON mirror in sync.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Validates a partial update. zod v4's `.partial()` fills in defaults for
 * omitted keys, which would overwrite existing data — so only the keys the
 * client actually sent are kept.
 */
export function parsePatch<S extends z.ZodObject>(schema: S, input: unknown): Partial<z.infer<S>> {
  const raw = z.record(z.string(), z.unknown()).parse(input ?? {});
  const parsed = schema.partial().parse(raw) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(raw).filter((k) => k in schema.shape).map((k) => [k, parsed[k]])) as Partial<z.infer<S>>;
}

export function requireSeries(seriesId: string) {
  const s = getSeries(seriesId);
  if (!s) throw new HttpError(404, `Series "${seriesId}" not found`);
  return s;
}

export function requireEpisode(episodeId: number): Episode {
  const e = getEpisode(episodeId);
  if (!e) throw new HttpError(404, `Episode ${episodeId} not found`);
  return e;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "item"
  );
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export function createSeries(input: unknown) {
  const raw = z.object({ id: z.string().optional(), title: z.string().min(1) }).passthrough().parse(input);
  const id = raw.id || slugify(raw.title);
  if (getSeries(id)) throw new HttpError(409, `A series with id "${id}" already exists`);
  const series = upsertSeries(SeriesSchema.parse({ ...raw, id }));
  exportSeriesMeta(series.id);
  exportContinuity(series.id);
  return series;
}

export function updateSeries(seriesId: string, input: unknown) {
  const current = requireSeries(seriesId);
  const patch = z.record(z.string(), z.unknown()).parse(input);
  const merged = SeriesSchema.parse({
    ...current,
    ...patch,
    id: seriesId,
    settings: { ...current.settings, ...((patch.settings as object) ?? {}) },
  });
  upsertSeries(merged);
  exportSeriesMeta(seriesId);
  return merged;
}

// ---------------------------------------------------------------------------
// Characters (with appearance lock)
// ---------------------------------------------------------------------------

const LOCKED_FIELDS = [...APPEARANCE_FIELDS, "reference_images"] as const;

export function saveCharacterInput(seriesId: string, input: CharacterInput, opts: { create?: boolean } = {}): Character {
  requireSeries(seriesId);
  const parsed = CharacterSchema.parse({ ...input, id: input.id || slugify(input.display_name ?? "") });
  const existing = getCharacter(seriesId, parsed.id);
  if (opts.create && existing) throw new HttpError(409, `Character id "${parsed.id}" already exists`);
  if (existing?.locked && parsed.locked) {
    for (const field of LOCKED_FIELDS) {
      if (JSON.stringify(existing[field]) !== JSON.stringify(parsed[field])) {
        throw new HttpError(423, `${existing.display_name}'s appearance is locked — unlock it to change "${field}".`);
      }
    }
    parsed.locked_block = existing.locked_block ?? characterBlock({ ...existing, locked: false });
  } else if (parsed.locked) {
    // Locking now: freeze the exact consistency block that prompts will use from here on.
    parsed.locked_block = characterBlock({ ...parsed, locked: false });
  } else {
    delete parsed.locked_block;
  }
  const saved = saveCharacter(seriesId, parsed);
  exportSeriesMeta(seriesId);
  return saved;
}

export function removeCharacter(seriesId: string, characterId: string) {
  deleteCharacter(seriesId, characterId);
  exportSeriesMeta(seriesId);
}

function requireUnlocked(c: Character) {
  if (c.locked) throw new HttpError(423, `${c.display_name}'s appearance is locked — unlock it first.`);
}

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function addReferenceImage(seriesId: string, characterId: string, file: File): Promise<Character> {
  const c = getCharacter(seriesId, characterId);
  if (!c) throw new HttpError(404, "Character not found");
  requireUnlocked(c);
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw new HttpError(415, "Upload a PNG, JPEG or WebP image");
  if (file.size > 15 * 1024 * 1024) throw new HttpError(413, "Image too large (max 15 MB)");
  const dir = path.join(seriesDir(seriesId), "references", characterId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${slugify(path.parse(file.name).name)}.${ext}`;
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
  return saveCharacterInput(seriesId, { ...c, reference_images: [...c.reference_images, toRelative(dest)] });
}

export function removeReferenceImage(seriesId: string, characterId: string, relPath: string): Character {
  const c = getCharacter(seriesId, characterId);
  if (!c) throw new HttpError(404, "Character not found");
  requireUnlocked(c);
  if (!c.reference_images.includes(relPath)) throw new HttpError(404, "Reference image not found");
  const abs = path.resolve(relPath);
  if (abs.startsWith(path.resolve(seriesDir(seriesId)))) fs.rmSync(abs, { force: true });
  return saveCharacterInput(seriesId, { ...c, reference_images: c.reference_images.filter((r) => r !== relPath) });
}

/** Generates a character reference sheet with the image provider and attaches it as a reference image. */
export async function generateCharacterSheet(seriesId: string, characterId: string, mode: RenderMode): Promise<{ character: Character; cost: number; cached: boolean }> {
  const c = getCharacter(seriesId, characterId);
  if (!c) throw new HttpError(404, "Character not found");
  requireUnlocked(c);
  const provider = getImageProvider(mode);
  const size = mode === "final" ? { width: 1536, height: 1024 } : { width: 1024, height: 683 };
  const req = {
    prompt: buildCharacterSheetPrompt(c),
    negativePrompt: c.negative_traits.join(", "),
    ...size,
    seed: hashString(`${seriesId}:${c.id}:sheet`),
    quality: resolveProvider("image", mode).quality,
    mockScene: provider.name === "mock" ? artSceneForPortrait(c, size.width, size.height) : undefined,
  };
  const key = hashKey({ kind: "reference", provider: provider.name, model: provider.model, parts: provider.cacheParts(req) });
  const res = await cachedGenerate({
    kind: "reference",
    key,
    provider: provider.name,
    model: provider.model,
    generate: async () => {
      const out = await withRetry(() => provider.generate(req));
      return { buffer: out.buffer, ext: out.ext, cost: out.cost };
    },
  });
  const dir = path.join(seriesDir(seriesId), "references", c.id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `sheet-${key.slice(0, 10)}.png`);
  fs.copyFileSync(res.path, dest);
  const rel = toRelative(dest);
  const character = c.reference_images.includes(rel) ? c : saveCharacterInput(seriesId, { ...c, reference_images: [...c.reference_images, rel] });
  return { character, cost: res.cost, cached: res.cached };
}

// ---------------------------------------------------------------------------
// Locations & continuity
// ---------------------------------------------------------------------------

export function saveLocationInput(seriesId: string, input: unknown, opts: { create?: boolean } = {}) {
  requireSeries(seriesId);
  const raw = z.object({ id: z.string().optional(), name: z.string().min(1) }).passthrough().parse(input);
  const loc = LocationSchema.parse({ ...raw, id: raw.id || slugify(raw.name) });
  if (opts.create && getLocation(seriesId, loc.id)) throw new HttpError(409, `Location id "${loc.id}" already exists`);
  const saved = saveLocation(seriesId, loc);
  exportSeriesMeta(seriesId);
  return saved;
}

export function removeLocation(seriesId: string, locationId: string) {
  deleteLocation(seriesId, locationId);
  exportSeriesMeta(seriesId);
}

/** Manual edit of the latest continuity snapshot (the writers' room override). */
export function saveSeriesState(seriesId: string, input: unknown) {
  requireSeries(seriesId);
  const latest = getLatestState(seriesId);
  const state = SeriesStateSchema.parse({ ...latest, ...(input as object), series_id: seriesId });
  const saved = putSnapshot(seriesId, state.as_of_episode, state);
  exportContinuity(seriesId);
  return saved;
}

// ---------------------------------------------------------------------------
// Episodes & scenes
// ---------------------------------------------------------------------------

export const NewEpisodeSchema = z.object({
  episode_number: z.coerce.number().int().min(1).optional(),
  title: z.string().default(""),
  synopsis: z.string().min(10, "Write at least a sentence of synopsis"),
  tone: z.string().default("epic-comedic"),
  target_duration: z.coerce.number().min(15).max(180).default(60),
  platform: EpisodeSchema.shape.platform,
  mode: EpisodeSchema.shape.mode,
});

export function createEpisodeInput(seriesId: string, input: unknown): Episode {
  requireSeries(seriesId);
  const data = NewEpisodeSchema.parse(input);
  const n = data.episode_number ?? nextEpisodeNumber(seriesId);
  if (getEpisodeByNumber(seriesId, n)) throw new HttpError(409, `Episode ${n} already exists in this series`);
  const ep = createEpisode(seriesId, { ...data, episode_number: n });
  exportEpisode(ep.id);
  return ep;
}

const EpisodePatchSchema = EpisodeSchema.omit({ scenes: true });

export function updateEpisodeInput(episodeId: number, input: unknown): Episode {
  const current = requireEpisode(episodeId);
  const patch = parsePatch(EpisodePatchSchema, input);
  if (patch.episode_number && patch.episode_number !== current.episode_number) {
    if (getEpisodeByNumber(current.series_id, patch.episode_number)) throw new HttpError(409, `Episode ${patch.episode_number} already exists`);
    removeEpisodeFile(current.series_id, current.episode_number);
  }
  if (patch.beats) {
    patch.narration = patch.beats.map((b) => b.narration).filter(Boolean).join(" ");
    patch.hook = patch.beats.find((b) => b.beat === "hook")?.narration ?? patch.hook;
    patch.cliffhanger = patch.beats.find((b) => b.beat === "cliffhanger")?.narration ?? patch.cliffhanger;
  }
  const updated = updateEpisode(episodeId, patch);
  // Aspect ratio lives in the prompts: switching platform orientation re-composes them.
  if (patch.platform && aspectForPlatform(patch.platform) !== aspectForPlatform(current.platform)) {
    const ctx = promptContext(updated.series_id, aspectForPlatform(updated.platform));
    replaceScenes(episodeId, listScenes(episodeId).map((s) => applyScenePrompts(s, ctx)));
  }
  exportEpisode(episodeId);
  return updated;
}

export function removeEpisode(episodeId: number) {
  const ep = requireEpisode(episodeId);
  deleteEpisode(episodeId);
  removeEpisodeFile(ep.series_id, ep.episode_number);
}

const ScenePatchSchema = SceneSchema.omit({ scene_id: true });

/**
 * Applies a Scene Editor change. Hand-edited prompt fields are added to
 * `locked_fields` so regeneration never overwrites them; every other derived
 * field is re-composed from the updated scene and the character bible.
 */
export function updateSceneInput(episodeId: number, sceneId: string, input: unknown): Scene {
  const episode = requireEpisode(episodeId);
  const existing = getScene(episodeId, sceneId);
  if (!existing) throw new HttpError(404, `Scene ${sceneId} not found`);
  const patch = parsePatch(ScenePatchSchema, input);
  const locked = new Set(patch.locked_fields ?? existing.locked_fields);
  for (const f of PROMPT_FIELDS) {
    if (patch[f] !== undefined && patch[f] !== existing[f]) locked.add(f);
  }
  for (const f of ["facial_expression", "environment_motion", "subject_motion"] as const) {
    if (patch[f] !== undefined && patch[f] !== existing[f]) locked.add(f);
  }
  const merged = SceneSchema.parse({ ...existing, ...patch, scene_id: sceneId, locked_fields: [...locked] });
  const ctx = promptContext(episode.series_id, aspectForPlatform(episode.platform));
  const duration = episode.timeline?.scenes.find((s) => s.scene_id === sceneId)?.duration;
  const scene = applyScenePrompts(merged, ctx, duration);
  saveScene(episodeId, scene);
  exportEpisode(episodeId);
  return scene;
}

export function addScene(episodeId: number, input: SceneInput | undefined): Scene {
  const episode = requireEpisode(episodeId);
  const scenes = listScenes(episodeId);
  const used = new Set(scenes.map((s) => s.scene_id));
  let n = scenes.length + 1;
  while (used.has(`s${String(n).padStart(2, "0")}`)) n++;
  const sceneId = `s${String(n).padStart(2, "0")}`;
  const ctx = promptContext(episode.series_id, aspectForPlatform(episode.platform));
  const base = SceneSchema.parse({
    beat: scenes[scenes.length - 1]?.beat ?? "scene_1",
    location: scenes[scenes.length - 1]?.location ?? ctx.locations[0]?.id ?? "",
    camera_framing: "medium shot",
    camera_movement: "slow push-in",
    action: "Describe what happens in this shot",
    ...(input ?? {}),
    scene_id: sceneId,
    seed: hashString(`${episode.series_id}:${episode.episode_number}:${sceneId}:${Date.now()}`),
  });
  const scene = applyScenePrompts(base, ctx);
  saveScene(episodeId, scene);
  exportEpisode(episodeId);
  return scene;
}

export function removeScene(episodeId: number, sceneId: string) {
  requireEpisode(episodeId);
  deleteScene(episodeId, sceneId);
  exportEpisode(episodeId);
}

/** New random seed → the next keyframe/clip generation produces a fresh variation (and a new cache key). */
export function reseedScene(episodeId: number, sceneId: string): Scene {
  const scene = getScene(episodeId, sceneId);
  if (!scene) throw new HttpError(404, `Scene ${sceneId} not found`);
  const next = { ...scene, seed: Math.floor(Math.random() * 2_147_483_647) };
  saveScene(episodeId, next);
  exportEpisode(episodeId);
  return next;
}
