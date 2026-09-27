import { config } from "@/lib/config";
import type { TTSOptions, TTSProvider, TTSResult, TTSVoiceConfig } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { MissingCredentialsError } from "@/lib/ai/retry";
import { toWorkingWav } from "@/lib/audio/convert";
import { wordsFromCharacterAlignment } from "@/lib/audio/timing";
import { round4 } from "@/lib/ai/pricing";

interface TimestampResponse {
  audio_base64: string;
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

/** ElevenLabs text-to-speech with character timestamps → exact word-level subtitle timing. */
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = "elevenlabs";
  constructor(
    readonly model: string = config.elevenlabs.model,
    private pricing: Record<string, number> = {},
  ) {}

  private voiceId(voice: TTSVoiceConfig): string {
    const id = voice.elevenlabs_voice_id || config.elevenlabs.narratorVoiceId;
    if (!id) throw new MissingCredentialsError("ElevenLabs", `a voice id for "${voice.speaker}" (character voice or ELEVENLABS_NARRATOR_VOICE_ID)`);
    return id;
  }

  async generate(text: string, voice: TTSVoiceConfig, options: TTSOptions): Promise<TTSResult> {
    void options;
    if (!config.elevenlabs.apiKey) throw new MissingCredentialsError("ElevenLabs", "ELEVENLABS_API_KEY");
    const res = await fetchJson<TimestampResponse>(
      `${config.elevenlabs.baseUrl}/v1/text-to-speech/${this.voiceId(voice)}/with-timestamps?output_format=mp3_44100_128`,
      {
        provider: "elevenlabs",
        method: "POST",
        headers: { "xi-api-key": config.elevenlabs.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: this.model,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, speed: voice.speed ?? 1 },
        }),
        timeoutMs: 120_000,
      },
    );
    const { wavPath, duration } = await toWorkingWav(Buffer.from(res.audio_base64, "base64"), "mp3");
    const words = res.alignment
      ? wordsFromCharacterAlignment(res.alignment.characters, res.alignment.character_start_times_seconds, res.alignment.character_end_times_seconds)
      : undefined;
    return { wavPath, duration, words, cost: this.estimateCost(text), model: this.model };
  }

  estimateCost(text: string) {
    return round4((text.length / 1000) * (this.pricing.per_1k_chars ?? 0));
  }

  cacheParts(text: string, voice: TTSVoiceConfig) {
    return { text, voice: voice.elevenlabs_voice_id || config.elevenlabs.narratorVoiceId, model: this.model, speed: voice.speed ?? 1 };
  }
}
