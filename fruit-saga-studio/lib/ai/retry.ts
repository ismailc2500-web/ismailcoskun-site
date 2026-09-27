import { config } from "@/lib/config";

/** Error raised by provider adapters. `retryable` decides whether withRetry tries again. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly opts: { provider?: string; status?: number; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get retryable() {
    return this.opts.retryable ?? true;
  }
}

export class MissingCredentialsError extends ProviderError {
  constructor(provider: string, envVar: string) {
    super(`${provider}: missing ${envVar}. Add it to .env (see .env.example) or switch provider / enable MOCK_MODE.`, {
      provider,
      retryable: false,
    });
    this.name = "MissingCredentialsError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable;
  if (err instanceof Error) {
    if (err.name === "AbortError") return false;
    // Network-level failures (ECONNRESET, ETIMEDOUT, fetch failed…) are transient.
    return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(err.message);
  }
  return false;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RetryObserver = (attempt: number, delayMs: number, err: unknown) => void;
let globalObserver: RetryObserver | null = null;

/** Lets the pipeline record retries on the active job without coupling providers to the job system. */
export function setRetryObserver(observer: RetryObserver | null) {
  globalObserver = observer;
}

/**
 * Runs `fn` with exponential backoff (base · 2^(attempt-1) + jitter), honouring
 * Retry-After. Non-retryable errors (bad request, auth, missing key) fail fast.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? config.retry.maxAttempts;
  const base = opts.baseDelayMs ?? config.retry.baseDelayMs;
  const maxDelay = opts.maxDelayMs ?? 60_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const retryAfter = err instanceof ProviderError ? err.opts.retryAfterMs : undefined;
      const delay = Math.min(maxDelay, retryAfter ?? base * 2 ** (attempt - 1) + Math.random() * base * 0.25);
      opts.onRetry?.(attempt, delay, err);
      globalObserver?.(attempt, delay, err);
      await sleep(delay);
    }
  }
  throw lastError;
}
