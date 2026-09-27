import path from "node:path";
import fs from "node:fs";

/**
 * Central configuration. Everything reads env vars through here so that the
 * rest of the code base never touches process.env directly.
 */

const ROOT = process.cwd();

loadDotEnv();

function loadDotEnv() {
  // Next.js loads .env automatically; CLI scripts (tsx) do not. Load it here
  // without overriding anything that is already set.
  for (const file of [".env.local", ".env"]) {
    const p = path.join(/*turbopackIgnore: true*/ ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      const hash = value.indexOf(" #");
      if (hash >= 0 && !value.startsWith('"')) value = value.slice(0, hash).trim();
      value = value.replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== "" ? v : fallback;
}

// DATA_DIR / OUTPUT_DIR / CACHE_DIR let you keep media on another disk (and
// let the test suite run in a throw-away directory). The seed stays in the repo.
const DATA = path.resolve(/*turbopackIgnore: true*/ ROOT, str("DATA_DIR", "./data"));

export const paths = {
  root: ROOT,
  data: DATA,
  seed: path.join(ROOT, "data", "seed"),
  series: path.join(/*turbopackIgnore: true*/ DATA, "series"),
  audioLibrary: path.join(ROOT, "data", "audio-library"),
  prompts: path.join(ROOT, "prompts"),
  output: path.resolve(/*turbopackIgnore: true*/ ROOT, str("OUTPUT_DIR", "./output")),
  cache: path.resolve(/*turbopackIgnore: true*/ ROOT, str("CACHE_DIR", "./cache")),
  migrations: path.join(ROOT, "db", "migrations"),
  fonts: path.join(ROOT, "assets", "fonts"),
  db: path.resolve(/*turbopackIgnore: true*/ ROOT, str("DATABASE_PATH", path.join(DATA, "studio.db"))),
};

export const seriesDir = (seriesId: string) => path.join(/*turbopackIgnore: true*/ paths.series, seriesId);
export const episodeDirName = (n: number) => `episode_${String(n).padStart(3, "0")}`;
export const episodeOutputDir = (seriesId: string, episodeNumber: number) =>
  path.join(paths.output, seriesId, episodeDirName(episodeNumber));

export type RenderMode = "preview" | "final";

export const config = {
  /** When true no paid API is ever called, regardless of provider settings. */
  mockMode: bool("MOCK_MODE", true),
  defaultMode: (str("DEFAULT_RENDER_MODE", "preview") === "final" ? "final" : "preview") as RenderMode,
  ffmpegPath: str("FFMPEG_PATH", "ffmpeg"),
  ffprobePath: str("FFPROBE_PATH", "ffprobe"),

  providers: {
    llm: str("LLM_PROVIDER", "openai"),
    image: str("IMAGE_PROVIDER", "openai"),
    video: str("VIDEO_PROVIDER", "runway"),
    tts: str("TTS_PROVIDER", "openai"),
    previewVideo: str("PREVIEW_VIDEO_PROVIDER", "mock"),
    previewImage: str("PREVIEW_IMAGE_PROVIDER", ""),
    previewTts: str("PREVIEW_TTS_PROVIDER", ""),
  },

  openai: {
    apiKey: str("OPENAI_API_KEY"),
    baseUrl: str("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
    llmModel: str("OPENAI_LLM_MODEL", "gpt-5-mini"),
    imageModel: str("OPENAI_IMAGE_MODEL", "gpt-image-1"),
    ttsModel: str("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
    ttsPreviewModel: str("OPENAI_TTS_PREVIEW_MODEL", "tts-1"),
    narratorVoice: str("OPENAI_TTS_VOICE", "onyx"),
  },
  anthropic: {
    apiKey: str("ANTHROPIC_API_KEY"),
    baseUrl: str("ANTHROPIC_BASE_URL", "https://api.anthropic.com").replace(/\/$/, ""),
    model: str("ANTHROPIC_MODEL", "claude-sonnet-5"),
  },
  ollama: {
    baseUrl: str("OLLAMA_BASE_URL", "http://localhost:11434").replace(/\/$/, ""),
    model: str("OLLAMA_MODEL", "llama3.1"),
  },
  stability: {
    apiKey: str("STABILITY_API_KEY"),
    baseUrl: str("STABILITY_BASE_URL", "https://api.stability.ai").replace(/\/$/, ""),
    model: str("STABILITY_MODEL", "core"),
  },
  runway: {
    apiKey: str("RUNWAY_API_KEY"),
    baseUrl: str("RUNWAY_BASE_URL", "https://api.dev.runwayml.com").replace(/\/$/, ""),
    model: str("RUNWAY_MODEL", "gen4_turbo"),
    apiVersion: str("RUNWAY_API_VERSION", "2024-11-06"),
  },
  luma: {
    apiKey: str("LUMA_API_KEY"),
    baseUrl: str("LUMA_BASE_URL", "https://api.lumalabs.ai/dream-machine/v1").replace(/\/$/, ""),
    model: str("LUMA_MODEL", "ray-2"),
    previewModel: str("LUMA_PREVIEW_MODEL", "ray-flash-2"),
  },
  kling: {
    accessKey: str("KLING_ACCESS_KEY"),
    secretKey: str("KLING_SECRET_KEY"),
    baseUrl: str("KLING_BASE_URL", "https://api-singapore.klingai.com").replace(/\/$/, ""),
    model: str("KLING_MODEL", "kling-v2-1"),
  },
  veo: {
    apiKey: str("GEMINI_API_KEY"),
    baseUrl: str("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
    model: str("VEO_MODEL", "veo-3.0-fast-generate-001"),
  },
  elevenlabs: {
    apiKey: str("ELEVENLABS_API_KEY"),
    baseUrl: str("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io").replace(/\/$/, ""),
    model: str("ELEVENLABS_MODEL", "eleven_multilingual_v2"),
    narratorVoiceId: str("ELEVENLABS_NARRATOR_VOICE_ID"),
  },
  localTts: {
    command: str("LOCAL_TTS_COMMAND"),
  },

  cost: {
    maxEpisodeBudgetUsd: num("MAX_EPISODE_BUDGET_USD", 5),
    imageQualityPreview: str("IMAGE_QUALITY_PREVIEW", "low"),
    imageQualityFinal: str("IMAGE_QUALITY_FINAL", "high"),
  },
  retry: {
    maxAttempts: Math.max(1, num("RETRY_MAX_ATTEMPTS", 4)),
    baseDelayMs: Math.max(0, num("RETRY_BASE_DELAY_MS", 2000)),
  },
  concurrency: Math.max(1, num("GENERATION_CONCURRENCY", 2)),
  subtitleFont: str("SUBTITLE_FONT", "Arial"),
  mockLabels: bool("MOCK_LABELS", true),
};

export const RESOLUTIONS = {
  final: { vertical: { width: 1080, height: 1920 }, landscape: { width: 1920, height: 1080 } },
  preview: { vertical: { width: 540, height: 960 }, landscape: { width: 960, height: 540 } },
} as const;

export const FPS = 30;
