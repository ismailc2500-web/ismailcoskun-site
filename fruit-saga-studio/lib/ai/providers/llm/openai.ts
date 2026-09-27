import { config } from "@/lib/config";
import type { LLMProvider, LLMRequest, LLMResult } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { MissingCredentialsError, ProviderError } from "@/lib/ai/retry";
import { round4 } from "@/lib/ai/pricing";

interface ChatResponse {
  model: string;
  choices: { message: { content: string | null }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** OpenAI Chat Completions (JSON mode). Also works with OpenAI-compatible servers via OPENAI_BASE_URL. */
export class OpenAILLMProvider implements LLMProvider {
  readonly name = "openai";
  constructor(
    readonly model: string = config.openai.llmModel,
    private pricing: Record<string, number> = {},
  ) {}

  async complete(req: LLMRequest): Promise<LLMResult> {
    if (!config.openai.apiKey) throw new MissingCredentialsError("OpenAI", "OPENAI_API_KEY");
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: req.maxTokens ?? 8000,
    };
    // Reasoning models (gpt-5, o-series) only accept the default temperature.
    if (req.temperature !== undefined && /^gpt-4/.test(this.model)) body.temperature = req.temperature;
    const res = await fetchJson<ChatResponse>(`${config.openai.baseUrl}/chat/completions`, {
      provider: "openai",
      method: "POST",
      headers: { Authorization: `Bearer ${config.openai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 180_000,
    });
    const text = res.choices[0]?.message?.content ?? "";
    if (!text) throw new ProviderError(`openai returned an empty response (${res.choices[0]?.finish_reason})`, { provider: "openai" });
    const inputTokens = res.usage?.prompt_tokens ?? 0;
    const outputTokens = res.usage?.completion_tokens ?? 0;
    return { text, model: res.model ?? this.model, inputTokens, outputTokens, cost: this.estimateCost(inputTokens, outputTokens) };
  }

  estimateCost(inputTokens: number, outputTokens: number) {
    return round4(
      (inputTokens / 1e6) * (this.pricing.input_per_mtok ?? 0) + (outputTokens / 1e6) * (this.pricing.output_per_mtok ?? 0),
    );
  }
}
