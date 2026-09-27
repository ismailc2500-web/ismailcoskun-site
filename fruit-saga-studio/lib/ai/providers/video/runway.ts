import { config } from "@/lib/config";
import type { VideoProvider, VideoRequest, VideoResult } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { MissingCredentialsError } from "@/lib/ai/retry";
import { compactPrompt, downloadToTemp, imageDataUri, pollUntil, roundUpDuration } from "@/lib/ai/providers/video/common";

interface RunwayTask {
  id: string;
  status: "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  progress?: number;
  output?: string[];
  failure?: string;
}

/** Runway image-to-video (gen4_turbo by default). Docs: https://docs.dev.runwayml.com */
export class RunwayVideoProvider implements VideoProvider {
  readonly name = "runway";
  readonly durations = [5, 10];
  constructor(
    readonly model: string = config.runway.model,
    private pricing: Record<string, number> = {},
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${config.runway.apiKey}`,
      "X-Runway-Version": config.runway.apiVersion,
      "Content-Type": "application/json",
    };
  }

  async generate(req: VideoRequest, onProgress?: (p: number) => void): Promise<VideoResult> {
    if (!config.runway.apiKey) throw new MissingCredentialsError("Runway", "RUNWAY_API_KEY");
    const duration = roundUpDuration(req.duration, this.durations);
    const task = await fetchJson<{ id: string }>(`${config.runway.baseUrl}/v1/image_to_video`, {
      provider: "runway",
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        promptImage: await imageDataUri(req.imagePath),
        promptText: compactPrompt(req.prompt, 990),
        ratio: req.aspect === "9:16" ? "720:1280" : "1280:720",
        duration,
        seed: req.seed % 4_294_967_295,
      }),
    });
    const url = await pollUntil<string>(
      "runway",
      async () => {
        const t = await fetchJson<RunwayTask>(`${config.runway.baseUrl}/v1/tasks/${task.id}`, { provider: "runway", headers: this.headers() });
        if (t.status === "FAILED" || t.status === "CANCELLED") return { done: false, failed: t.failure ?? t.status };
        return { done: t.status === "SUCCEEDED", progress: t.progress, value: t.output?.[0] };
      },
      { onProgress },
    );
    return { filePath: await downloadToTemp("runway", url), duration, cost: this.estimateCost({ duration }), model: this.model, meta: { task: task.id } };
  }

  estimateCost(req: Pick<VideoRequest, "duration">) {
    return roundUpDuration(req.duration, this.durations) * (this.pricing.per_second ?? 0);
  }

  cacheParts(req: VideoRequest, imageHash: string) {
    return { image: imageHash, prompt: req.prompt, d: roundUpDuration(req.duration, this.durations), aspect: req.aspect, seed: req.seed };
  }
}
