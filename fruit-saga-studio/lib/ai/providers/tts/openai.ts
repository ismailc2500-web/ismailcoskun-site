import { config } from "@/lib/config";
import type { TTSOptions, TTSProvider, TTSResult, TTSVoiceConfig } from "@/lib/ai/types";
import { fetchBuffer } from "@/lib/ai/http";
import { MissingCredentialsError } from "@/lib/ai/retry";
import { toWorkingWav } from "@/lib/audio/convert";
import { round4 } from "@/lib/ai/pricing";

/**
 * OpenAI speech. gpt-4o-mini-tts accepts free-text `instructions`, which is
 * where each character's voice_profile goes. Word timings are estimated from
 * the measured duration (OpenAI does not return timestamps).
 */
export class OpenAITTSProvider implements TTSProvider {
  readonly name = "openai";
  constructor(
    readonly model: string = config.openai.ttsModel,
    private pricing: Record<string, number> = {},
  ) {}

  async generate(text: string, voice: TTSVoiceConfig, options: TTSOptions): Promise<TTSResult> {
    void options;
    if (!config.openai.apiKey) throw new MissingCredentialsError("OpenAI TTS", "OPENAI_API_KEY");
    const body: Record<string, unknown> = {
      model: this.model,
      voice: voice.openai_voice || config.openai.narratorVoice,
      input: text,
      response_format: "wav",
    };
    if (voice.speed && voice.speed !== 1) body.speed = voice.speed;
    if (this.model.includes("gpt-4o") && voice.profile) body.instructions = `Voice direction: ${voice.profile}`;
    const audio = await fetchBuffer(`${config.openai.baseUrl}/audio/speech`, {
      provider: "openai",
      method: "POST",
      headers: { Authorization: `Bearer ${config.openai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    });
    const { wavPath, duration } = await toWorkingWav(audio, "wav");
    return { wavPath, duration, cost: this.estimateCost(text), model: this.model };
  }

  estimateCost(text: string) {
    return round4((text.length / 1000) * (this.pricing.per_1k_chars ?? 0));
  }

  cacheParts(text: string, voice: TTSVoiceConfig) {
    return { text, voice: voice.openai_voice || config.openai.narratorVoice, profile: voice.profile, speed: voice.speed ?? 1 };
  }
}
