"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  raw: Record<string, unknown> | null;
}

/** fetch + JSON with uniform error handling. */
export async function api<T = unknown>(url: string, method = "GET", payload?: unknown): Promise<ApiResult<T>> {
  try {
    const init: RequestInit = { method, headers: {} };
    if (payload instanceof FormData) init.body = payload;
    else if (payload !== undefined) {
      init.body = JSON.stringify(payload);
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
    const res = await fetch(url, init);
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { ok: false, status: res.status, data: null, error: (json?.error as string) ?? res.statusText, raw: json };
    return { ok: true, status: res.status, data: json as T, error: null, raw: json };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: (err as Error).message, raw: null };
  }
}

/**
 * Starts a pipeline-like request. When the server answers 402 (estimate above
 * MAX_EPISODE_BUDGET_USD) the user is asked to confirm and the request is
 * re-sent with confirmBudget: true.
 */
export async function runWithBudget<T = unknown>(url: string, payload: Record<string, unknown>): Promise<ApiResult<T>> {
  const first = await api<T>(url, "POST", payload);
  if (first.status === 402 && first.raw?.needsConfirmation) {
    const ok = window.confirm(`${first.error}\n\nContinue anyway?`);
    if (!ok) return first;
    return api<T>(url, "POST", { ...payload, confirmBudget: true });
  }
  return first;
}

/** Polls a JSON endpoint. `fast` switches to a short interval (e.g. while a run is active). */
export function usePolling<T>(url: string, initial: T, opts: { fast?: boolean; fastMs?: number; slowMs?: number } = {}) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;
  const refresh = useCallback(async () => {
    const r = await api<T>(urlRef.current);
    if (r.ok && r.data) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
    return r;
  }, []);
  useEffect(() => {
    const ms = opts.fast ? (opts.fastMs ?? 1200) : (opts.slowMs ?? 0);
    if (!ms) return;
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [opts.fast, opts.fastMs, opts.slowMs, refresh]);
  return { data, setData, refresh, error };
}
