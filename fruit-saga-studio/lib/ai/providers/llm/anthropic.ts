import { config } from "@/lib/config";
import type { LLMProvider, LLMRequest, LLMResult } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { MissingCredentialsError, ProviderError } from "@/lib/ai/retry";
import { round4 } from "@/lib/ai/pricing";

interface MessagesResponse {
  model: string;
  content: { type: string; text?: string }[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Anthropic Messages API. JSON is requested in the prompt and extracted by generateJson(). */
export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";
  constructor(
    readonly model: string = config.anthropic.model,
    private pricing: Record<string, number> = {},
  ) {}

  async complete(req: LLMRequest): Promise<LLMResult> {
    if (!config.anthropic.apiKey) throw new MissingCredentialsError("Anthropic", "ANTHROPIC_API_KEY");
    const res = await fetchJson<MessagesResponse>(`${config.anthropic.baseUrl}/v1/messages`, {
      provider: "anthropic",
      method: "POST",
      headers: {
        "x-api-key": config.anthropic.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 8000,
        system: `${req.system}\n\nRespond with a single JSON value only.`,
        messages: [{ role: "user", content: req.prompt }],
      }),
      timeoutMs: 180_000,
    });
    const text = res.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    if (!text) throw new ProviderError(`anthropic returned no text (${res.stop_reason})`, { provider: "anthropic" });
    const inputTokens = res.usage?.input_tokens ?? 0;
    const outputTokens = res.usage?.output_tokens ?? 0;
    return { text, model: res.model ?? this.model, inputTokens, outputTokens, cost: this.estimateCost(inputTokens, outputTokens) };
  }

  estimateCost(inputTokens: number, outputTokens: number) {
    return round4(
      (inputTokens / 1e6) * (this.pricing.input_per_mtok ?? 0) + (outputTokens / 1e6) * (this.pricing.output_per_mtok ?? 0),
    );
  }
}
