import type { ProviderKind } from "@/lib/types";

/**
 * Default price table used for cost ESTIMATES (USD). Provider prices change
 * often — verify against each provider's pricing page and override any value
 * from Settings → Providers (stored per kind/mode in provider_configs).
 *
 * Keys:
 *   llm:   input_per_mtok, output_per_mtok
 *   image: per_image (or per_image_<quality>)
 *   video: per_second
 *   tts:   per_1k_chars
 */
export const DEFAULT_PRICING: Record<ProviderKind, Record<string, Record<string, number>>> = {
  llm: {
    mock: { input_per_mtok: 0, output_per_mtok: 0 },
    ollama: { input_per_mtok: 0, output_per_mtok: 0 },
    openai: { input_per_mtok: 0.25, output_per_mtok: 2.0 },
    anthropic: { input_per_mtok: 3.0, output_per_mtok: 15.0 },
  },
  image: {
    mock: { per_image: 0 },
    openai: { per_image_low: 0.016, per_image_medium: 0.063, per_image_high: 0.25, per_image: 0.063 },
    stability: { per_image: 0.03 },
  },
  video: {
    mock: { per_second: 0 },
    runway: { per_second: 0.05 },
    luma: { per_second: 0.08 },
    kling: { per_second: 0.07 },
    veo: { per_second: 0.15 },
  },
  tts: {
    mock: { per_1k_chars: 0 },
    local: { per_1k_chars: 0 },
    openai: { per_1k_chars: 0.015 },
    elevenlabs: { per_1k_chars: 0.2 },
  },
};

export function priceTable(kind: ProviderKind, provider: string, overrides?: Record<string, number>): Record<string, number> {
  return { ...(DEFAULT_PRICING[kind][provider] ?? {}), ...(overrides ?? {}) };
}

export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
