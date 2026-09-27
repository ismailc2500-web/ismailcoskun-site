import { ProviderError } from "@/lib/ai/retry";

/** fetch wrapper that converts HTTP failures into classified ProviderErrors. */

export interface HttpOptions extends RequestInit {
  provider: string;
  timeoutMs?: number;
}

async function doFetch(url: string, opts: HttpOptions): Promise<Response> {
  const { provider, timeoutMs = 120_000, ...init } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 1500);
      } catch {
        /* ignore */
      }
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 || undefined : undefined;
      const retryable = res.status === 408 || res.status === 409 || res.status === 425 || res.status === 429 || res.status >= 500;
      throw new ProviderError(`${provider} HTTP ${res.status}: ${body || res.statusText}`, {
        provider,
        status: res.status,
        retryable,
        retryAfterMs,
      });
    }
    return res;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError(`${provider}: request timed out after ${Math.round(timeoutMs / 1000)}s`, {
        provider,
        retryable: true,
      });
    }
    throw new ProviderError(`${provider}: network error — ${(err as Error).message}`, { provider, retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(url: string, opts: HttpOptions): Promise<T> {
  const res = await doFetch(url, opts);
  return (await res.json()) as T;
}

export async function fetchBuffer(url: string, opts: HttpOptions): Promise<Buffer> {
  const res = await doFetch(url, opts);
  return Buffer.from(await res.arrayBuffer());
}
