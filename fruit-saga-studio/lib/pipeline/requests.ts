import fs from "node:fs";
import { FPS, RESOLUTIONS, type RenderMode } from "@/lib/config";
import type { Character, Episode, Scene, Series } from "@/lib/types";
import type { ImageProvider, ImageRequest, TTSOptions, TTSProvider, TTSVoiceConfig, VideoProvider, VideoRequest } from "@/lib/ai/types";
import { getImageProvider, getTTSProvider, getVideoProvider, resolveProvider } from "@/lib/ai/registry";
import { fileHash, hashKey } from "@/lib/ai/cache";
import { toAbsolute } from "@/lib/db/repos/assets";
import { artSceneFromScene } from "@/lib/ai/mock/art";
import { buildImagePrompt, buildNegativePrompt, buildVideoPrompt, findLocation, sceneCharacters, type Aspect, type PromptContext } from "@/lib/prompts/engine";
import { transitionSpec } from "@/lib/prompts/vocabulary";

/**
 * Request builders shared by generation and cost estimation, so the estimator
 * computes exactly the same cache keys the pipeline will use.
 */

export function frameSize(mode: RenderMode, aspect: Aspect) {
  return RESOLUTIONS[mode][aspect === "9:16" ? "vertical" : "landscape"];
}

/** Seconds a scene occupies on the timeline (timeline wins over the planned duration). */
export function sceneDuration(episode: Pick<Episode, "timeline">, scene: Scene): number {
  return episode.timeline?.scenes.find((s) => s.scene_id === scene.scene_id)?.duration ?? scene.duration;
}

/** Clip length needed for a scene: its duration plus the overlap of the transition into the next shot. */
export function clipLength(episode: Pick<Episode, "timeline">, scenes: Scene[], index: number): number {
  const scene = scenes[index];
  const isLast = index === scenes.length - 1;
  const t = isLast ? 0 : transitionSpec(scene.transition).duration;
  return Math.round((sceneDuration(episode, scene) + t) * 100) / 100;
}

export interface KeyframePlan {
  provider: ImageProvider;
  req: ImageRequest;
  key: string;
  estimate: number;
}

export function planKeyframe(scene: Scene, ctx: PromptContext, mode: RenderMode, providerOverride?: ImageProvider): KeyframePlan {
  const provider = providerOverride ?? getImageProvider(mode);
  const { width, height } = frameSize(mode, ctx.aspect);
  const chars = sceneCharacters(scene, ctx);
  const req: ImageRequest = {
    prompt: scene.image_prompt || buildImagePrompt(scene, ctx),
    negativePrompt: scene.negative_prompt || buildNegativePrompt(scene, ctx),
    width,
    height,
    seed: scene.seed,
    quality: resolveProvider("image", mode).quality,
    referenceImages: provider.supportsReferences
      ? chars.flatMap((c) => c.reference_images.map(toAbsolute)).filter((p) => fs.existsSync(p))
      : undefined,
    mockScene:
      provider.name === "mock"
        ? artSceneFromScene(scene, chars, findLocation(scene.location, ctx), width, height, `MOCK KEYFRAME · ${scene.scene_id} · ${scene.camera_framing}`)
        : undefined,
  };
  const key = hashKey({ kind: "keyframe", provider: provider.name, model: provider.model, parts: provider.cacheParts(req) });
  return { provider, req, key, estimate: provider.estimateCost(req) };
}

export interface ClipPlan {
  provider: VideoProvider;
  req: VideoRequest;
  key: string | null;
  estimate: number;
}

export function planClip(
  scene: Scene,
  keyframePath: string | null,
  duration: number,
  ctx: PromptContext,
  mode: RenderMode,
): ClipPlan {
  const provider = getVideoProvider(mode);
  const { width, height } = frameSize(mode, ctx.aspect);
  const req: VideoRequest = {
    prompt: scene.video_prompt || buildVideoPrompt(scene, ctx, duration),
    negativePrompt: scene.negative_prompt || buildNegativePrompt(scene, ctx),
    imagePath: keyframePath ?? "",
    width,
    height,
    aspect: ctx.aspect,
    duration,
    seed: scene.seed,
    cameraMovement: scene.camera_movement,
    fps: FPS,
  };
  const key =
    keyframePath && fs.existsSync(keyframePath)
      ? hashKey({ kind: "clip", provider: provider.name, model: provider.model, parts: provider.cacheParts(req, fileHash(keyframePath)) })
      : null;
  return { provider, req, key, estimate: provider.estimateCost(req) };
}

export interface VoicePlan {
  index: number;
  speaker: string;
  text: string;
  voice: TTSVoiceConfig;
  options: TTSOptions;
  provider: TTSProvider;
  key: string;
  estimate: number;
}

export function planVoices(scene: Scene, series: Series, characters: Character[], mode: RenderMode, providerOverride?: TTSProvider): VoicePlan[] {
  const provider = providerOverride ?? getTTSProvider(mode);
  const options: TTSOptions = { mode, wordsPerMinute: series.settings.words_per_minute };
  const lines: { speaker: string; text: string }[] = [
    { speaker: "narrator", text: scene.narration.trim() },
    ...scene.dialogue.map((d) => ({ speaker: d.character_id, text: d.line.trim() })),
  ].filter((l) => l.text);
  return lines.map((line, index) => {
    const character = characters.find((c) => c.id === line.speaker);
    const voice: TTSVoiceConfig = character
      ? { ...character.voice, profile: character.voice_profile, speaker: character.id }
      : { ...series.settings.narrator_voice, profile: series.settings.narrator_voice_profile, speaker: "narrator" };
    const key = hashKey({ kind: "voice", provider: provider.name, model: provider.model, parts: provider.cacheParts(line.text, voice, options) });
    return { index, speaker: line.speaker, text: line.text, voice, options, provider, key, estimate: provider.estimateCost(line.text) };
  });
}
