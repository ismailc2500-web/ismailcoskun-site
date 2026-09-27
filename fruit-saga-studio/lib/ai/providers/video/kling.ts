import crypto from "node:crypto";
import { config } from "@/lib/config";
import type { VideoProvider, VideoRequest, VideoResult } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { MissingCredentialsError, ProviderError } from "@/lib/ai/retry";
import { compactPrompt, downloadToTemp, imageBase64, pollUntil, roundUpDuration } from "@/lib/ai/providers/video/common";

interface KlingEnvelope<T> {
  code: number;
  message: string;
  data: T;
}
interface KlingTask {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg?: string;
  task_result?: { videos?: { url: string; duration: string }[] };
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Kling AI image-to-video. Auth is a short-lived HS256 JWT built from the access/secret key pair. */
export class KlingVideoProvider implements VideoProvider {
  readonly name = "kling";
  readonly durations = [5, 10];
  constructor(
    readonly model: string = config.kling.model,
    private mode: "std" | "pro" = "std",
    private pricing: Record<string, number> = {},
  ) {}

  private token(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({ iss: config.kling.accessKey, exp: now + 1800, nbf: now - 5 }));
    const sig = b64url(crypto.createHmac("sha256", config.kling.secretKey).update(`${header}.${payload}`).digest());
    return `${header}.${payload}.${sig}`;
  }

  async generate(req: VideoRequest, onProgress?: (p: number) => void): Promise<VideoResult> {
    if (!config.kling.accessKey || !config.kling.secretKey) throw new MissingCredentialsError("Kling", "KLING_ACCESS_KEY / KLING_SECRET_KEY");
    const duration = roundUpDuration(req.duration, this.durations);
    const headers = () => ({ Authorization: `Bearer ${this.token()}`, "Content-Type": "application/json" });
    const created = await fetchJson<KlingEnvelope<KlingTask>>(`${config.kling.baseUrl}/v1/videos/image2video`, {
      provider: "kling",
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model_name: this.model,
        image: await imageBase64(req.imagePath),
        prompt: compactPrompt(req.prompt, 2400),
        negative_prompt: req.negativePrompt.slice(0, 2400),
        duration: String(duration),
        mode: this.mode,
        cfg_scale: 0.5,
      }),
    });
    if (created.code !== 0) throw new ProviderError(`kling: ${created.message}`, { provider: "kling", retryable: false });
    const id = created.data.task_id;
    const url = await pollUntil<string>(
      "kling",
      async () => {
        const t = await fetchJson<KlingEnvelope<KlingTask>>(`${config.kling.baseUrl}/v1/videos/image2video/${id}`, { provider: "kling", headers: headers() });
        if (t.data.task_status === "failed") return { done: false, failed: t.data.task_status_msg ?? "failed" };
        return { done: t.data.task_status === "succeed", progress: t.data.task_status === "processing" ? 0.5 : 0.1, value: t.data.task_result?.videos?.[0]?.url };
      },
      { onProgress },
    );
    return { filePath: await downloadToTemp("kling", url), duration, cost: this.estimateCost({ duration }), model: this.model, meta: { task: id } };
  }

  estimateCost(req: Pick<VideoRequest, "duration">) {
    return roundUpDuration(req.duration, this.durations) * (this.pricing.per_second ?? 0);
  }

  cacheParts(req: VideoRequest, imageHash: string) {
    return { image: imageHash, prompt: req.prompt, negative: req.negativePrompt, d: roundUpDuration(req.duration, this.durations), mode: this.mode };
  }
}
