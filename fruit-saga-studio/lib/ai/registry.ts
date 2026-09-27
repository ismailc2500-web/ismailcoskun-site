import { config, type RenderMode } from "@/lib/config";
import type { ProviderKind } from "@/lib/types";
import type { ImageProvider, LLMProvider, TTSProvider, VideoProvider } from "@/lib/ai/types";
import { getAppSetting, getProviderSetting } from "@/lib/db/repos/settings";
import { priceTable } from "@/lib/ai/pricing";
import { MockLLMProvider } from "@/lib/ai/providers/llm/mock";
import { OpenAILLMProvider } from "@/lib/ai/providers/llm/openai";
import { AnthropicLLMProvider } from "@/lib/ai/providers/llm/anthropic";
import { OllamaLLMProvider } from "@/lib/ai/providers/llm/ollama";
import { MockImageProvider } from "@/lib/ai/providers/image/mock";
import { OpenAIImageProvider } from "@/lib/ai/providers/image/openai";
import { StabilityImageProvider } from "@/lib/ai/providers/image/stability";
import { MockVideoProvider } from "@/lib/ai/providers/video/mock";
import { RunwayVideoProvider } from "@/lib/ai/providers/video/runway";
import { LumaVideoProvider } from "@/lib/ai/providers/video/luma";
import { KlingVideoProvider } from "@/lib/ai/providers/video/kling";
import { VeoVideoProvider } from "@/lib/ai/providers/video/veo";
import { MockTTSProvider } from "@/lib/ai/providers/tts/mock";
import { OpenAITTSProvider } from "@/lib/ai/providers/tts/openai";
import { ElevenLabsTTSProvider } from "@/lib/ai/providers/tts/elevenlabs";
import { LocalTTSProvider } from "@/lib/ai/providers/tts/local";

/**
 * Which adapter runs for a given capability and render mode:
 *   1. MOCK_MODE (env) or the Settings "force mock" toggle → mock, always.
 *   2. Settings → Providers (provider_configs table).
 *   3. Environment variables (LLM_PROVIDER, IMAGE_PROVIDER, …).
 *
 * To add a provider: implement the interface in lib/ai/types.ts, add it to
 * PROVIDER_CATALOG and to the matching switch below. See README.
 */

export interface CatalogEntry {
  id: string;
  label: string;
  env: string[];
  note?: string;
}

export const PROVIDER_CATALOG: Record<ProviderKind, CatalogEntry[]> = {
  llm: [
    { id: "mock", label: "Mock writer (offline)", env: [] },
    { id: "openai", label: "OpenAI", env: ["OPENAI_API_KEY"] },
    { id: "anthropic", label: "Anthropic", env: ["ANTHROPIC_API_KEY"] },
    { id: "ollama", label: "Ollama (local)", env: [], note: "Requires a running Ollama server" },
  ],
  image: [
    { id: "mock", label: "Procedural placeholder art", env: [] },
    { id: "openai", label: "OpenAI Images (reference-image aware)", env: ["OPENAI_API_KEY"] },
    { id: "stability", label: "Stability AI", env: ["STABILITY_API_KEY"] },
  ],
  video: [
    { id: "mock", label: "Animatic (camera moves on keyframes, free)", env: [] },
    { id: "runway", label: "Runway", env: ["RUNWAY_API_KEY"] },
    { id: "luma", label: "Luma Dream Machine", env: ["LUMA_API_KEY"], note: "Set PUBLIC_ASSET_BASE_URL to use keyframes" },
    { id: "kling", label: "Kling", env: ["KLING_ACCESS_KEY", "KLING_SECRET_KEY"] },
    { id: "veo", label: "Google Veo (Gemini API)", env: ["GEMINI_API_KEY"] },
  ],
  tts: [
    { id: "mock", label: "Placeholder voice (offline)", env: [] },
    { id: "openai", label: "OpenAI TTS", env: ["OPENAI_API_KEY"] },
    { id: "elevenlabs", label: "ElevenLabs (word timestamps)", env: ["ELEVENLABS_API_KEY"] },
    { id: "local", label: "Local engine (espeak-ng / say / piper)", env: [] },
  ],
};

export function mockModeState(): { active: boolean; source: "env" | "settings" | null } {
  if (config.mockMode) return { active: true, source: "env" };
  if (getAppSetting("force_mock", false)) return { active: true, source: "settings" };
  return { active: false, source: null };
}

export interface ResolvedProvider {
  kind: ProviderKind;
  mode: RenderMode;
  provider: string;
  model: string;
  quality: string;
  pricing: Record<string, number>;
  source: "mock-mode" | "settings" | "env";
}

function envDefault(kind: ProviderKind, mode: RenderMode): string {
  const p = config.providers;
  switch (kind) {
    case "llm":
      return p.llm;
    case "image":
      return mode === "preview" ? p.previewImage || p.image : p.image;
    case "video":
      return mode === "preview" ? p.previewVideo || "mock" : p.video;
    case "tts":
      return mode === "preview" ? p.previewTts || p.tts : p.tts;
  }
}

function defaultQuality(kind: ProviderKind, mode: RenderMode): string {
  if (kind === "image") return mode === "preview" ? config.cost.imageQualityPreview : config.cost.imageQualityFinal;
  if (kind === "video") return mode === "preview" ? "std" : "pro";
  return "";
}

/** `ignoreMock` shows what is configured underneath mock mode (used by the Settings page). */
export function resolveProvider(kind: ProviderKind, mode: RenderMode, opts: { ignoreMock?: boolean } = {}): ResolvedProvider {
  if (!opts.ignoreMock && mockModeState().active) {
    return { kind, mode, provider: "mock", model: "", quality: defaultQuality(kind, mode), pricing: priceTable(kind, "mock"), source: "mock-mode" };
  }
  const saved = getProviderSetting(kind, mode);
  if (saved) {
    return {
      kind,
      mode,
      provider: saved.provider,
      model: saved.model,
      quality: saved.quality || defaultQuality(kind, mode),
      pricing: priceTable(kind, saved.provider, saved.pricing),
      source: "settings",
    };
  }
  const provider = envDefault(kind, mode);
  return { kind, mode, provider, model: "", quality: defaultQuality(kind, mode), pricing: priceTable(kind, provider), source: "env" };
}

function unknown(kind: string, id: string): never {
  const known = PROVIDER_CATALOG[kind as ProviderKind]?.map((e) => e.id).join(", ");
  throw new Error(`Unknown ${kind} provider "${id}". Available: ${known}`);
}

export function getLLM(mode: RenderMode = "final"): LLMProvider {
  const r = resolveProvider("llm", mode);
  switch (r.provider) {
    case "mock":
      return new MockLLMProvider();
    case "openai":
      return new OpenAILLMProvider(r.model || config.openai.llmModel, r.pricing);
    case "anthropic":
      return new AnthropicLLMProvider(r.model || config.anthropic.model, r.pricing);
    case "ollama":
      return new OllamaLLMProvider(r.model || config.ollama.model);
    default:
      return unknown("llm", r.provider);
  }
}

export function getImageProvider(mode: RenderMode): ImageProvider {
  const r = resolveProvider("image", mode);
  switch (r.provider) {
    case "mock":
      return new MockImageProvider();
    case "openai":
      return new OpenAIImageProvider(r.model || config.openai.imageModel, r.quality, r.pricing);
    case "stability":
      return new StabilityImageProvider(r.model || config.stability.model, r.pricing);
    default:
      return unknown("image", r.provider);
  }
}

export function getVideoProvider(mode: RenderMode): VideoProvider {
  const r = resolveProvider("video", mode);
  switch (r.provider) {
    case "mock":
      return new MockVideoProvider(mode === "preview");
    case "runway":
      return new RunwayVideoProvider(r.model || config.runway.model, r.pricing);
    case "luma":
      return new LumaVideoProvider(r.model || (mode === "preview" ? config.luma.previewModel : config.luma.model), r.pricing);
    case "kling":
      return new KlingVideoProvider(r.model || config.kling.model, r.quality === "pro" ? "pro" : "std", r.pricing);
    case "veo":
      return new VeoVideoProvider(r.model || config.veo.model, r.pricing);
    default:
      return unknown("video", r.provider);
  }
}

export function getTTSProvider(mode: RenderMode): TTSProvider {
  const r = resolveProvider("tts", mode);
  switch (r.provider) {
    case "mock":
      return new MockTTSProvider();
    case "openai":
      return new OpenAITTSProvider(r.model || (mode === "preview" ? config.openai.ttsPreviewModel : config.openai.ttsModel), r.pricing);
    case "elevenlabs":
      return new ElevenLabsTTSProvider(r.model || config.elevenlabs.model, r.pricing);
    case "local":
      return new LocalTTSProvider();
    default:
      return unknown("tts", r.provider);
  }
}

/** Which env vars are present (values are never exposed). */
export function credentialStatus(): Record<string, boolean> {
  const vars = new Set(Object.values(PROVIDER_CATALOG).flatMap((list) => list.flatMap((e) => e.env)));
  return Object.fromEntries([...vars].map((v) => [v, Boolean(process.env[v])]));
}
