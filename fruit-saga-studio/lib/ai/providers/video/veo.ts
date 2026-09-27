import { config } from "@/lib/config";
import type { VideoProvider, VideoRequest, VideoResult } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { MissingCredentialsError } from "@/lib/ai/retry";
import { downloadToTemp, imageBase64, pollUntil } from "@/lib/ai/providers/video/common";

interface Operation {
  name: string;
  done?: boolean;
  error?: { message: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } };
}

/** Google Veo through the Gemini API (predictLongRunning + operation polling). */
export class VeoVideoProvider implements VideoProvider {
  readonly name = "veo";
  readonly durations = [8];
  constructor(
    readonly model: string = config.veo.model,
    private pricing: Record<string, number> = {},
  ) {}

  async generate(req: VideoRequest, onProgress?: (p: number) => void): Promise<VideoResult> {
    if (!config.veo.apiKey) throw new MissingCredentialsError("Google Veo", "GEMINI_API_KEY");
    const headers = { "x-goog-api-key": config.veo.apiKey, "Content-Type": "application/json" };
    const op = await fetchJson<Operation>(`${config.veo.baseUrl}/models/${this.model}:predictLongRunning`, {
      provider: "veo",
      method: "POST",
      headers,
      body: JSON.stringify({
        instances: [{ prompt: req.prompt, image: { bytesBase64Encoded: await imageBase64(req.imagePath), mimeType: "image/jpeg" } }],
        parameters: { aspectRatio: req.aspect, negativePrompt: req.negativePrompt.slice(0, 2000) },
      }),
    });
    const uri = await pollUntil<string>(
      "veo",
      async () => {
        const o = await fetchJson<Operation>(`${config.veo.baseUrl}/${op.name}`, { provider: "veo", headers });
        if (o.error) return { done: false, failed: o.error.message };
        return { done: Boolean(o.done), progress: o.done ? 1 : 0.4, value: o.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri };
      },
      { onProgress, intervalMs: 10_000 },
    );
    return {
      filePath: await downloadToTemp("veo", uri, { "x-goog-api-key": config.veo.apiKey }),
      duration: 8,
      cost: this.estimateCost(),
      model: this.model,
      meta: { operation: op.name },
    };
  }

  estimateCost() {
    return 8 * (this.pricing.per_second ?? 0);
  }

  cacheParts(req: VideoRequest, imageHash: string) {
    return { image: imageHash, prompt: req.prompt, negative: req.negativePrompt, aspect: req.aspect };
  }
}
