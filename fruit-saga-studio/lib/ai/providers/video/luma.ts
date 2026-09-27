import { config } from "@/lib/config";
import type { VideoProvider, VideoRequest, VideoResult } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { MissingCredentialsError } from "@/lib/ai/retry";
import { compactPrompt, downloadToTemp, pollUntil, roundUpDuration } from "@/lib/ai/providers/video/common";
import { toRelative } from "@/lib/db/repos/assets";

interface LumaGeneration {
  id: string;
  state: "queued" | "dreaming" | "completed" | "failed";
  failure_reason?: string;
  assets?: { video?: string };
}

/**
 * Luma Dream Machine (ray-2 / ray-flash-2). Luma needs a public URL for the
 * start keyframe: set PUBLIC_ASSET_BASE_URL to a tunnel pointing at this app
 * (e.g. https://xyz.ngrok.app) and keyframes are passed as
 * <base>/api/files/<path>. Without it the shot falls back to text-to-video.
 */
export class LumaVideoProvider implements VideoProvider {
  readonly name = "luma";
  readonly durations = [5, 9];
  constructor(
    readonly model: string = config.luma.model,
    private pricing: Record<string, number> = {},
  ) {}

  async generate(req: VideoRequest, onProgress?: (p: number) => void): Promise<VideoResult> {
    if (!config.luma.apiKey) throw new MissingCredentialsError("Luma", "LUMA_API_KEY");
    const duration = roundUpDuration(req.duration, this.durations);
    const publicBase = process.env.PUBLIC_ASSET_BASE_URL?.replace(/\/$/, "");
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: compactPrompt(req.prompt, 4000),
      aspect_ratio: req.aspect,
      duration: `${duration}s`,
      resolution: "720p",
    };
    if (publicBase) body.keyframes = { frame0: { type: "image", url: `${publicBase}/api/files/${toRelative(req.imagePath)}` } };
    const headers = { Authorization: `Bearer ${config.luma.apiKey}`, "Content-Type": "application/json" };
    const gen = await fetchJson<LumaGeneration>(`${config.luma.baseUrl}/generations`, {
      provider: "luma",
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const url = await pollUntil<string>(
      "luma",
      async () => {
        const g = await fetchJson<LumaGeneration>(`${config.luma.baseUrl}/generations/${gen.id}`, { provider: "luma", headers });
        if (g.state === "failed") return { done: false, failed: g.failure_reason ?? "failed" };
        return { done: g.state === "completed", progress: g.state === "dreaming" ? 0.5 : 0.1, value: g.assets?.video };
      },
      { onProgress },
    );
    return {
      filePath: await downloadToTemp("luma", url),
      duration,
      cost: this.estimateCost({ duration }),
      model: this.model,
      meta: { generation: gen.id, usedKeyframe: Boolean(publicBase) },
    };
  }

  estimateCost(req: Pick<VideoRequest, "duration">) {
    return roundUpDuration(req.duration, this.durations) * (this.pricing.per_second ?? 0);
  }

  cacheParts(req: VideoRequest, imageHash: string) {
    return { image: imageHash, prompt: req.prompt, d: roundUpDuration(req.duration, this.durations), aspect: req.aspect };
  }
}
