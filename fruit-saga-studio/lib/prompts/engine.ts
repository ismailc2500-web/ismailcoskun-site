import type { Character, EpisodeMetadata, Location, Scene, Series } from "@/lib/types";
import { loadGlobalNegatives, loadStyle, renderPrompt } from "@/lib/prompts/template";
import {
  defaultEnvironmentMotion,
  describeCameraMotion,
  expressionFor,
  lensFor,
} from "@/lib/prompts/vocabulary";

/**
 * STAGES 3 & 4 — deterministic prompt composition.
 *
 * Character appearance is never left to the LLM: every prompt is assembled
 * here from the character bible, so a character always looks the same no
 * matter which provider or model renders it.
 */

export type Aspect = "9:16" | "16:9";

export interface PromptContext {
  series: Series;
  characters: Character[];
  locations: Location[];
  aspect: Aspect;
}

const STOP_TOKENS = new Set(["The", "Of", "King", "Queen", "Lord", "Lady", "Sir", "Old", "Young", "Wanderer", "Charred"]);

export function characterDescriptor(c: Character): string {
  return (c.descriptor || `${c.fruit}-headed ${c.role || "character"}`).trim();
}

/** The consistency block for one character (the frozen copy when the character is locked). */
export function characterBlock(c: Character): string {
  if (c.locked && c.locked_block) return c.locked_block;
  return renderPrompt("character_prompt", {
    descriptor: characterDescriptor(c),
    fruit: c.fruit,
    fruit_description: c.fruit_description || `a realistic ${c.fruit}`,
    face_description:
      c.face_description || "expressive eyes, brows and mouth sculpted naturally into the fruit surface",
    body_description: c.body_description || "a humanoid body with natural proportions",
    costume: c.costume || "simple original fantasy travelling clothes",
    props: c.props,
    height: c.height,
    visual_traits: c.visual_traits,
  }).replace(/\s+/g, " ");
}

export function charactersBlock(chars: Character[]): string {
  if (!chars.length) return "";
  if (chars.length === 1) return `CHARACTER: ${characterBlock(chars[0])}.`;
  return [
    `CHARACTERS (${chars.length} distinct characters — keep every design separate and exact):`,
    ...chars.map((c, i) => `${i + 1}) ${characterBlock(c)}.`),
  ].join("\n");
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameVariants(c: Character): string[] {
  const variants = new Set<string>();
  const name = c.display_name.trim();
  variants.add(name);
  variants.add(name.replace(/["“”]/g, ""));
  const nick = name.match(/["“](.+?)["”]/);
  if (nick) variants.add(nick[1]);
  const plain = name.replace(/["“].+?["”]/g, " ").replace(/\s+/g, " ").trim();
  variants.add(plain);
  const titleIdx = plain.indexOf(" the ");
  if (titleIdx > 0) {
    variants.add(plain.slice(0, titleIdx));
    variants.add(plain.slice(titleIdx + 1)); // "the Charred King"
  }
  for (const token of plain.split(/\s+/)) {
    if (/^[A-Z][\w'-]{2,}$/.test(token) && !STOP_TOKENS.has(token)) variants.add(token);
  }
  return [...variants].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length);
}

/** Replaces character names with their visual descriptors ("Pip waves" → "the small apple-headed traveller waves"). */
export function deName(text: string, chars: Character[]): string {
  if (!text) return text;
  let out = text;
  for (const c of chars) {
    const desc = characterDescriptor(c);
    for (const variant of nameVariants(c)) {
      const re = new RegExp(`\\b(?:the\\s+[a-z-]+\\s+)?${escapeRegExp(variant)}('s)?(?![\\w-])`, "g");
      out = out.replace(re, (_m, poss?: string) => `the ${desc}${poss ?? ""}`);
    }
  }
  out = out
    .replace(/\bthe the\b/gi, "the")
    .replace(/\b(a|an|tiny|little|small|young|old|poor|brave|dear|mighty|great|lone|our|brave little) the\b/gi, "the");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const stripEnd = (s: string) => s.trim().replace(/[.;,\s]+$/, "");

export function sceneCharacters(scene: Scene, ctx: PromptContext): Character[] {
  return scene.characters
    .map((id) => ctx.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c));
}

export function findLocation(id: string, ctx: PromptContext): Location | undefined {
  return ctx.locations.find((l) => l.id === id) ?? ctx.locations.find((l) => l.name.toLowerCase() === id.toLowerCase());
}

function composition(aspect: Aspect, framing: string): string {
  const f = framing.toLowerCase();
  if (aspect === "9:16") {
    return f.includes("wide")
      ? "vertical 9:16 composition with strong depth layers, subject readable in the central band, lower third kept simple for captions"
      : "vertical 9:16 composition, subject centred in the upper two-thirds with clear headroom, lower third kept simple for captions, readable on a phone screen";
  }
  return "widescreen composition on the rule of thirds, subject readable at small size";
}

export function buildImagePrompt(scene: Scene, ctx: PromptContext): string {
  const chars = sceneCharacters(scene, ctx);
  const loc = findLocation(scene.location, ctx);
  const style = loadStyle();
  const framing = scene.camera_framing || "medium shot";
  const environment = stripEnd(deName(scene.environment || loc?.description || scene.location, ctx.characters));
  const locationDetails =
    loc && scene.environment && !scene.environment.includes(loc.description)
      ? `${loc.description}, ${loc.atmosphere} atmosphere`
      : loc?.atmosphere
        ? `${loc.atmosphere} atmosphere`
        : "";
  // Names are scrubbed from the whole prompt: bible fields may mention other characters.
  return scrubNames(renderPrompt("image_prompt", {
    characters_block: charactersBlock(chars),
    action: stripEnd(deName(scene.action || scene.description, ctx.characters)),
    facial_expression: stripEnd(lowerFirst(deName(scene.facial_expression || expressionFor(scene.emotion).text, ctx.characters))),
    emotion: scene.emotion || "cinematic tension",
    environment,
    location_details: locationDetails,
    camera_framing: framing,
    lens: lensFor(framing),
    composition: composition(ctx.aspect, framing),
    lighting: stripEnd(scene.lighting || loc?.lighting || "dramatic cinematic key light with strong rim light"),
    style: [style.full, ctx.series.style_notes].filter(Boolean).join(" "),
    aspect: ctx.aspect,
    orientation: ctx.aspect === "9:16" ? "vertical" : "horizontal",
  }), ctx.characters);
}

/** deName without touching the leading character (prompts start with labels). */
function scrubNames(text: string, chars: Character[]): string {
  const out = deName(text, chars);
  return text.charAt(0) + out.slice(1);
}

function shortCostume(c: Character): string {
  return (c.costume.split(",")[0] || c.costume).trim();
}

export function buildVideoPrompt(scene: Scene, ctx: PromptContext, duration = scene.duration): string {
  const chars = sceneCharacters(scene, ctx);
  const loc = findLocation(scene.location, ctx);
  const style = loadStyle();
  const cameraMotion = describeCameraMotion(scene.camera_movement);
  const envMotion = stripEnd(
    deName(scene.environment_motion || defaultEnvironmentMotion(loc?.environment_type ?? "other"), ctx.characters),
  );
  const subjectMotion = stripEnd(deName(scene.subject_motion || scene.action || scene.description, ctx.characters));
  const speakers = scene.dialogue
    .map((d) => ctx.characters.find((c) => c.id === d.character_id))
    .filter((c): c is Character => Boolean(c));
  const speaking = [...new Set(speakers)]
    .map(
      (c) =>
        `the ${characterDescriptor(c)}'s mouth moves naturally with speech, the ${c.fruit} skin flexing and deforming subtly around the lips`,
    )
    .join("; ");
  const action = stripEnd(deName(scene.action || scene.description, ctx.characters));
  return scrubNames(renderPrompt("video_prompt", {
    summary_sentence: `${action}; ${lowerFirst(cameraMotion)}; ${lowerFirst(envMotion)}.`,
    duration: Math.round(duration * 10) / 10,
    subject_motion: subjectMotion,
    camera_motion: cameraMotion.charAt(0).toUpperCase() + cameraMotion.slice(1),
    environment_motion: envMotion,
    facial_expression: stripEnd(deName(scene.facial_expression || expressionFor(scene.emotion).text, ctx.characters)),
    speaking,
    characters_short: chars.map((c) => `${characterDescriptor(c)} (${c.fruit} head, ${shortCostume(c)})`).join("; "),
    style_short: style.short,
  }), ctx.characters);
}

const stripNo = (t: string) => t.replace(/^\s*(no|not|never|without)\s+/i, "").trim();

export function buildNegativePrompt(scene: Scene, ctx: PromptContext): string {
  const items = [...loadGlobalNegatives()];
  for (const c of sceneCharacters(scene, ctx)) for (const t of c.negative_traits) items.push(stripNo(t));
  return [...new Set(items.map((i) => i.trim()).filter(Boolean))].join(", ");
}

export const PROMPT_FIELDS = ["image_prompt", "video_prompt", "negative_prompt"] as const;

/**
 * Fills derived fields of a scene. Fields listed in `locked_fields` (edited by
 * hand in the Scene Editor) are never overwritten.
 */
export function applyScenePrompts(scene: Scene, ctx: PromptContext, duration?: number): Scene {
  const locked = new Set(scene.locked_fields);
  const loc = findLocation(scene.location, ctx);
  const next: Scene = { ...scene };
  const setIfOpen = <K extends keyof Scene>(key: K, value: Scene[K], onlyIfEmpty = false) => {
    if (locked.has(key as string)) return;
    if (onlyIfEmpty && next[key] !== "" && next[key] !== undefined) return;
    next[key] = value;
  };
  setIfOpen("camera", [scene.camera_framing, scene.camera_movement].filter(Boolean).join(", "));
  setIfOpen("facial_expression", expressionFor(scene.emotion).text, true);
  setIfOpen("environment_motion", defaultEnvironmentMotion(loc?.environment_type ?? "other"), true);
  setIfOpen("subject_motion", scene.action, true);
  setIfOpen("image_prompt", buildImagePrompt(next, ctx));
  setIfOpen("video_prompt", buildVideoPrompt(next, ctx, duration ?? scene.duration));
  setIfOpen("negative_prompt", buildNegativePrompt(next, ctx));
  return next;
}

// ---------------------------------------------------------------------------
// Thumbnails & character sheets
// ---------------------------------------------------------------------------

export function thumbnailCharacters(metadata: EpisodeMetadata, scenes: Scene[], ctx: PromptContext): Character[] {
  const chosen = metadata.thumbnail_characters
    .map((id) => ctx.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c));
  if (chosen.length) return chosen.slice(0, 3);
  const counts = new Map<string, number>();
  for (const s of scenes) for (const id of s.characters) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => ctx.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c))
    .slice(0, 2);
}

export function buildThumbnailPrompts(
  metadata: EpisodeMetadata,
  scenes: Scene[],
  ctx: PromptContext,
): { vertical: string; landscape: string } {
  const chars = thumbnailCharacters(metadata, scenes, ctx);
  const climax = scenes.find((s) => s.beat === "scene_5") ?? scenes[Math.floor(scenes.length / 2)];
  const loc = climax ? findLocation(climax.location, ctx) : undefined;
  const style = loadStyle();
  const concept = deName(
    metadata.thumbnail_concept || `${chars.map((c) => characterDescriptor(c)).join(" confronting ")} in a moment of high drama`,
    ctx.characters,
  );
  const base = {
    concept: stripEnd(concept),
    characters_block: charactersBlock(chars),
    environment: loc?.description ?? "a dark atmospheric fantasy backdrop",
    style_short: style.short,
  };
  return {
    vertical: scrubNames(
      renderPrompt("thumbnail_prompt", { ...base, aspect: "9:16", orientation: "vertical", text_space: "in the top third of the frame" }),
      ctx.characters,
    ),
    landscape: scrubNames(
      renderPrompt("thumbnail_prompt", { ...base, aspect: "16:9", orientation: "horizontal", text_space: "on the left third of the frame" }),
      ctx.characters,
    ),
  };
}

export function buildCharacterSheetPrompt(c: Character): string {
  const style = loadStyle();
  return [
    "Character design reference sheet for an original 3D animated fantasy series: full-body front view and three-quarter view of the same character side by side, neutral mid-grey studio backdrop, soft even key light with a gentle rim light.",
    `${characterBlock(c)}.`,
    `${style.short}. No text, no labels, no watermark.`,
  ].join(" ");
}
