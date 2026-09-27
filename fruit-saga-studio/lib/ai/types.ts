import type { RenderMode } from "@/lib/config";
import type { VoiceConfig, WordTiming } from "@/lib/types";
import type { ArtSceneSpec } from "@/lib/ai/mock/art";

/**
 * Provider adapter interfaces. Every AI capability is reached through one of
 * these four interfaces, so providers can be swapped per mode (preview/final)
 * from the Settings page or env vars without touching pipeline code.
 */

// ---------------------------------------------------------------- LLM

export type LLMTask = "story" | "shotlist" | "continuity" | "metadata" | "freeform";

export interface LLMRequest {
  task: LLMTask;
  system: string;
  prompt: string;
  /**
   * Structured inputs of the task. Real providers ignore it (they read the
   * prompt); the mock provider uses it to write deterministic output offline.
   */
  context?: unknown;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LLMRequest): Promise<LLMResult>;
  estimateCost(inputTokens: number, outputTokens: number): number;
}

// ---------------------------------------------------------------- Image

export interface ImageRequest {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  quality: string;
  /** Absolute paths of reference images (character sheets) for providers that support them. */
  referenceImages?: string[];
  /** Structured scene description used by the mock renderer only. */
  mockScene?: ArtSceneSpec;
}

export interface ImageResult {
  buffer: Buffer;
  ext: "png" | "jpg" | "webp";
  cost: number;
  model: string;
  meta?: Record<string, unknown>;
}

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsNegativePrompt: boolean;
  readonly supportsSeed: boolean;
  readonly supportsReferences: boolean;
  generate(req: ImageRequest): Promise<ImageResult>;
  estimateCost(req: Pick<ImageRequest, "width" | "height" | "quality">): number;
  /** Which request fields influence the output — hashed into the cache key. */
  cacheParts(req: ImageRequest): unknown;
}

// ---------------------------------------------------------------- Video

export interface VideoRequest {
  prompt: string;
  negativePrompt: string;
  /** Absolute path of the keyframe image (image-to-video). */
  imagePath: string;
  width: number;
  height: number;
  aspect: "9:16" | "16:9";
  duration: number;
  seed: number;
  cameraMovement: string;
  fps: number;
}

export interface VideoResult {
  /** Absolute path of a temporary mp4 file (moved into the cache by the caller). */
  filePath: string;
  duration: number;
  cost: number;
  model: string;
  meta?: Record<string, unknown>;
}

export interface VideoProvider {
  readonly name: string;
  readonly model: string;
  /** Durations the provider can generate; requests are rounded up to one of these. */
  readonly durations: number[];
  generate(req: VideoRequest, onProgress?: (p: number) => void): Promise<VideoResult>;
  estimateCost(req: Pick<VideoRequest, "duration" | "width" | "height">): number;
  cacheParts(req: VideoRequest, imageHash: string): unknown;
}

// ---------------------------------------------------------------- TTS

export interface TTSVoiceConfig extends VoiceConfig {
  /** Free-text direction ("deep, warm trailer narrator…"). */
  profile?: string;
  /** "narrator" or a character id. */
  speaker: string;
}

export interface TTSOptions {
  mode: RenderMode;
  wordsPerMinute: number;
}

export interface TTSResult {
  /** Absolute path of a temporary 48 kHz mono WAV file. */
  wavPath: string;
  duration: number;
  /** Word timings relative to the start of the clip, when the provider supplies them. */
  words?: WordTiming[];
  cost: number;
  model: string;
}

export interface TTSProvider {
  readonly name: string;
  readonly model: string;
  generate(text: string, voiceConfig: TTSVoiceConfig, options: TTSOptions): Promise<TTSResult>;
  estimateCost(text: string): number;
  cacheParts(text: string, voiceConfig: TTSVoiceConfig, options: TTSOptions): unknown;
}
