import { config } from "@/lib/config";
import type { ImageProvider, ImageRequest, ImageResult } from "@/lib/ai/types";
import { fetchBuffer } from "@/lib/ai/http";
import { MissingCredentialsError } from "@/lib/ai/retry";

/** Stability AI Stable Image (core / ultra / sd3). Supports negative prompts and seeds. */
export class StabilityImageProvider implements ImageProvider {
  readonly name = "stability";
  readonly supportsNegativePrompt = true;
  readonly supportsSeed = true;
  readonly supportsReferences = false;
  constructor(
    readonly model: string = config.stability.model,
    private pricing: Record<string, number> = {},
  ) {}

  private endpoint() {
    const m = this.model.toLowerCase();
    if (m === "ultra") return "ultra";
    if (m.startsWith("sd3")) return "sd3";
    return "core";
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!config.stability.apiKey) throw new MissingCredentialsError("Stability", "STABILITY_API_KEY");
    const form = new FormData();
    form.append("prompt", req.prompt.slice(0, 9_900));
    form.append("negative_prompt", req.negativePrompt.slice(0, 9_900));
    form.append("aspect_ratio", req.height > req.width ? "9:16" : req.width > req.height ? "16:9" : "1:1");
    form.append("seed", String(req.seed % 4_294_967_294));
    form.append("output_format", "png");
    if (this.endpoint() === "sd3") form.append("model", this.model);
    const buffer = await fetchBuffer(`${config.stability.baseUrl}/v2beta/stable-image/generate/${this.endpoint()}`, {
      provider: "stability",
      method: "POST",
      headers: { Authorization: `Bearer ${config.stability.apiKey}`, Accept: "image/*" },
      body: form,
      timeoutMs: 180_000,
    });
    return { buffer, ext: "png", cost: this.estimateCost(), model: this.model };
  }

  estimateCost() {
    return this.pricing.per_image ?? 0;
  }

  cacheParts(req: ImageRequest) {
    return { prompt: req.prompt, negative: req.negativePrompt, seed: req.seed, aspect: `${req.width}x${req.height}` };
  }
}
