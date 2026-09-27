import { config } from "@/lib/config";
import type { LLMProvider, LLMRequest, LLMResult } from "@/lib/ai/types";
import { fetchJson } from "@/lib/ai/http";
import { ProviderError } from "@/lib/ai/retry";

interface OllamaChatResponse {
  model: string;
  message?: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Local LLM through Ollama (free, runs on your machine): `ollama pull llama3.1`. */
export class OllamaLLMProvider implements LLMProvider {
  readonly name = "ollama";
  constructor(readonly model: string = config.ollama.model) {}

  async complete(req: LLMRequest): Promise<LLMResult> {
    const res = await fetchJson<OllamaChatResponse>(`${config.ollama.baseUrl}/api/chat`, {
      provider: "ollama",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: "json",
        options: { temperature: req.temperature ?? 0.8, num_ctx: 16384 },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
      }),
      timeoutMs: 600_000,
    });
    const text = res.message?.content ?? "";
    if (!text) throw new ProviderError("ollama returned an empty response", { provider: "ollama" });
    return { text, model: res.model ?? this.model, inputTokens: res.prompt_eval_count ?? 0, outputTokens: res.eval_count ?? 0, cost: 0 };
  }

  estimateCost() {
    return 0;
  }
}
