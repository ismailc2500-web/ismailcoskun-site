"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { EpisodeView } from "@/lib/views";
import type { Asset, AssetKind, Stage } from "@/lib/types";
import { api, runWithBudget, usePolling, type ApiResult } from "@/components/hooks";
import { Badge, Button, cx, Notice } from "@/components/ui";
import { epCode, money, secs } from "@/lib/format";

export type ViewAsset = Asset & { url: string };

interface EpisodeCtx {
  view: EpisodeView;
  refresh: () => Promise<unknown>;
  run: (payload: { action?: string; stages?: Stage[]; mode?: string; sceneIds?: string[]; force?: boolean }) => Promise<ApiResult<unknown>>;
  post: (url: string, payload: Record<string, unknown>) => Promise<ApiResult<unknown>>;
  asset: (kind: AssetKind, sceneId?: string | null, variant?: string) => ViewAsset | undefined;
  running: boolean;
  message: { tone: "red" | "emerald" | "sky"; text: string } | null;
  setMessage: (m: EpisodeCtx["message"]) => void;
}

const Ctx = createContext<EpisodeCtx | null>(null);

export function useEpisode(): EpisodeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEpisode must be used inside <EpisodeShell>");
  return c;
}

const TABS = [
  ["", "Overview & Script"],
  ["/scenes", "Scene Editor"],
  ["/render", "Render"],
  ["/export", "Export"],
] as const;

export function EpisodeShell({ initial, tab, children }: { initial: EpisodeView; tab: string; children: ReactNode }) {
  const id = initial.episode.id;
  // `boost` = poll quickly. On while a run is active, off a moment after it ends.
  const [boost, setBoost] = useState(Boolean(initial.run));
  const { data: view, refresh } = usePolling<EpisodeView>(`/api/episodes/${id}`, initial, { fast: boost, fastMs: 1200 });
  const liveRunning = Boolean(view.run) || view.runJobs.some((j) => j.status === "running" || j.status === "queued");
  const [message, setMessage] = useState<EpisodeCtx["message"]>(null);
  useEffect(() => {
    if (liveRunning) {
      setBoost(true);
      return;
    }
    if (!boost) return;
    const t = setTimeout(() => setBoost(false), 2500);
    return () => clearTimeout(t);
  }, [liveRunning, boost]);

  const run = useCallback<EpisodeCtx["run"]>(
    async (payload) => {
      setMessage(null);
      const r = await runWithBudget(`/api/episodes/${id}/run`, { mode: view.episode.mode, ...payload });
      if (!r.ok) setMessage({ tone: "red", text: r.error ?? "Failed to start" });
      else setBoost(true);
      await refresh();
      return r;
    },
    [id, refresh, view.episode.mode],
  );

  const post = useCallback<EpisodeCtx["post"]>(
    async (url, payload) => {
      setMessage(null);
      const r = await runWithBudget(url, payload);
      if (!r.ok) setMessage({ tone: "red", text: r.error ?? "Request failed" });
      else setBoost(true);
      await refresh();
      return r;
    },
    [refresh],
  );

  const asset = useCallback<EpisodeCtx["asset"]>(
    (kind, sceneId = null, variant) =>
      (view.assets as ViewAsset[])
        .filter((a) => a.kind === kind && a.variant === (variant ?? view.episode.mode) && (a.scene_id ?? null) === (sceneId ?? null))
        .pop(),
    [view.assets, view.episode.mode],
  );

  const value = useMemo(
    () => ({ view, refresh, run, post, asset, running: liveRunning, message, setMessage }),
    [view, refresh, run, post, asset, liveRunning, message],
  );
  const e = view.episode;
  const failed = view.units.filter((u) => u.status === "failed").length;

  return (
    <Ctx.Provider value={value}>
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link href="/" className="uppercase tracking-[0.2em] text-gold-400 hover:underline">
                  {view.series.title}
                </Link>
                <span className="text-stone-600">/</span>
                <span className="font-mono text-stone-300">{epCode(e.episode_number)}</span>
                <Badge status={e.status}>{e.status.replace("_", " ")}</Badge>
                {liveRunning && <Badge tone="sky">● running</Badge>}
                {failed > 0 && <Badge tone="red">{failed} failed</Badge>}
              </div>
              <h1 className="mt-1 truncate text-3xl font-bold text-stone-50">{e.title || "Untitled episode"}</h1>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-400">
                <span>⏱ {e.timeline ? secs(e.timeline.total_duration) : `target ${e.target_duration}s`}</span>
                <span>🎬 {view.scenes.length} shots</span>
                <span>🗣 {view.words} words</span>
                <span>{view.aspect}</span>
                <span>spent {money(view.spend)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ModeToggle />
              {liveRunning && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={async () => {
                    await api(`/api/episodes/${id}/run`, "DELETE");
                    await refresh();
                  }}
                >
                  Cancel run
                </Button>
              )}
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-b border-ink-700">
            {TABS.map(([suffix, label]) => (
              <Link
                key={suffix}
                href={`/episodes/${id}${suffix}`}
                className={cx(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
                  tab === suffix ? "border-gold-400 text-stone-50" : "border-transparent text-stone-400 hover:text-stone-200",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {children}
      </div>
    </Ctx.Provider>
  );
}

function ModeToggle() {
  const { view, refresh } = useEpisode();
  const mode = view.episode.mode;
  const set = async (m: "preview" | "final") => {
    await api(`/api/episodes/${view.episode.id}`, "PATCH", { mode: m });
    await refresh();
  };
  return (
    <div className="flex rounded-lg border border-ink-600 bg-ink-900 p-0.5 text-xs" title="Preview = cheap, low-res, fast. Final = 1080p, best providers, two-pass loudness.">
      {(["preview", "final"] as const).map((m) => (
        <button
          key={m}
          onClick={() => set(m)}
          className={cx("rounded-md px-3 py-1.5 capitalize", mode === m ? (m === "final" ? "bg-emerald-600 text-white" : "bg-ink-700 text-white") : "text-stone-400 hover:text-stone-200")}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
