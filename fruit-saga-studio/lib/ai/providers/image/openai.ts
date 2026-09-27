import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import type { ImageProvider, ImageRequest, ImageResult } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { MissingCredentialsError, ProviderError } from "@/lib/ai/retry";
import { fileHash } from "@/lib/ai/cache";

interface ImagesResponse {
  data: { b64_json?: string; url?: string }[];
}

/**
 * OpenAI image generation (gpt-image-1 family). When character reference
 * images exist they are sent to the edits endpoint as visual references,
 * which strongly improves cross-episode consistency.
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  readonly supportsNegativePrompt = false;
  readonly supportsSeed = false;
  readonly supportsReferences = true;
  constructor(
    readonly model: string = config.openai.imageModel,
    private quality: string = "medium",
    private pricing: Record<string, number> = {},
  ) {}

  private size(req: Pick<ImageRequest, "width" | "height">): string {
    if (req.height > req.width) return "1024x1536";
    if (req.width > req.height) return "1536x1024";
    return "1024x1024";
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!config.openai.apiKey) throw new MissingCredentialsError("OpenAI Images", "OPENAI_API_KEY");
    const prompt = `${req.prompt}\n\nAvoid: ${req.negativePrompt}`.slice(0, 31_000);
    const quality = req.quality || this.quality;
    const refs = (req.referenceImages ?? []).filter((p) => fs.existsSync(p)).slice(0, 8);
    let res: ImagesResponse;
    if (refs.length) {
      const form = new FormData();
      form.append("model", this.model);
      form.append("prompt", prompt);
      form.append("size", this.size(req));
      form.append("quality", quality);
      for (const ref of refs) {
        const ext = path.extname(ref).slice(1).toLowerCase();
        const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        form.append("image[]", new Blob([new Uint8Array(fs.readFileSync(ref))], { type }), path.basename(ref));
      }
      res = await fetchJson<ImagesResponse>(`${config.openai.baseUrl}/images/edits`, {
        provider: "openai",
        method: "POST",
        headers: { Authorization: `Bearer ${config.openai.apiKey}` },
        body: form,
        timeoutMs: 300_000,
      });
    } else {
      res = await fetchJson<ImagesResponse>(`${config.openai.baseUrl}/images/generations`, {
        provider: "openai",
        method: "POST",
        headers: { Authorization: `Bearer ${config.openai.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt, size: this.size(req), quality, n: 1 }),
        timeoutMs: 300_000,
      });
    }
    const item = res.data?.[0];
    let buffer: Buffer | null = null;
    if (item?.b64_json) buffer = Buffer.from(item.b64_json, "base64");
    else if (item?.url) buffer = Buffer.from(await (await fetch(item.url)).arrayBuffer());
    if (!buffer) throw new ProviderError("openai images returned no image data", { provider: "openai" });
    return { buffer, ext: "png", cost: this.estimateCost({ ...req, quality }), model: this.model, meta: { references: refs.length } };
  }

  estimateCost(req: Pick<ImageRequest, "width" | "height" | "quality">) {
    const q = req.quality || this.quality;
    return this.pricing[`per_image_${q}`] ?? this.pricing.per_image ?? 0;
  }

  cacheParts(req: ImageRequest) {
    return {
      prompt: req.prompt,
      negative: req.negativePrompt,
      size: this.size(req),
      quality: req.quality || this.quality,
      refs: (req.referenceImages ?? []).filter((p) => fs.existsSync(p)).map(fileHash),
    };
  }
}
