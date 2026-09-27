import { z } from "zod";
import type { LLMProvider, LLMRequest, LLMResult } from "@/lib/ai/types";
import { ProviderError, withRetry } from "@/lib/ai/retry";

/** Extracts the first JSON object/array from an LLM response (tolerates code fences and prose). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error("No JSON found in model output");
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON in model output");
}

export interface JsonGeneration<T> {
  data: T;
  calls: LLMResult[];
}

/**
 * Calls the LLM (with network retries) and validates the JSON against `schema`.
 * If validation fails the model gets one repair attempt with the exact errors.
 */
export async function generateJson<T>(
  llm: LLMProvider,
  req: LLMRequest,
  schema: z.ZodType<T>,
  opts: { onRetry?: (attempt: number, err: unknown) => void } = {},
): Promise<JsonGeneration<T>> {
  const calls: LLMResult[] = [];
  let prompt = req.prompt;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await withRetry(() => llm.complete({ ...req, prompt }), {
      onRetry: (a, _d, err) => opts.onRetry?.(a, err),
    });
    calls.push(result);
    try {
      const parsed = schema.safeParse(extractJson(result.text));
      if (parsed.success) return { data: parsed.data, calls };
      lastError = z.prettifyError(parsed.error);
    } catch (err) {
      lastError = (err as Error).message;
    }
    prompt = `${req.prompt}\n\nYour previous answer was invalid:\n${lastError}\n\nReturn ONLY corrected JSON that matches the requested shape.`;
  }
  throw new ProviderError(`${llm.name} returned invalid JSON for "${req.task}": ${lastError.slice(0, 600)}`, {
    provider: llm.name,
    retryable: false,
  });
}

export const approxTokens = (text: string) => Math.ceil(text.length / 4);
