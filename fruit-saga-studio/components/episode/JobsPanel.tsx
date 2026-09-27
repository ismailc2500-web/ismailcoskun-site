"use client";

import { useState } from "react";
import type { GenerationJob } from "@/lib/types";
import { useEpisode } from "@/components/episode/EpisodeShell";
import { Badge, Button, Card, Progress } from "@/components/ui";
import { money } from "@/lib/format";

/** Live view of the latest run + every failed unit with a one-click retry. */
export function JobsPanel({ compact }: { compact?: boolean }) {
  const { view, post, running } = useEpisode();
  const [showAll, setShowAll] = useState(false);
  const jobs = view.runJobs as GenerationJob[];
  const failedUnits = (view.units as GenerationJob[]).filter((u) => u.status === "failed");
  const done = jobs.filter((j) => ["succeeded", "cached", "failed", "skipped"].includes(j.status)).length;
  const active = jobs.filter((j) => j.status === "running");
  const visible = showAll ? jobs : jobs.filter((j) => j.status !== "succeeded" && j.status !== "cached").slice(-12);
  const cost = jobs.reduce((s, j) => s + j.actual_cost, 0);

  return (
    <Card
      title="Generation jobs"
      subtitle={jobs.length ? `${done}/${jobs.length} done in the latest run · ${money(cost)}` : "Nothing generated yet"}
      actions={
        failedUnits.length > 0 && (
          <Button size="sm" variant="primary" onClick={() => post(`/api/episodes/${view.episode.id}/jobs`, { retryFailed: true })} disabled={running}>
            Retry {failedUnits.length} failed
          </Button>
        )
      }
    >
      {jobs.length > 0 && <Progress value={jobs.length ? done / jobs.length : 0} className="mb-3" />}
      {active.map((j) => (
        <div key={j.id} className="mb-2 rounded-lg border border-sky-900/60 bg-sky-950/30 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sky-200">{j.label}</span>
            <span className="text-xs text-sky-300/70">{Math.round(j.progress * 100)}%</span>
          </div>
          <Progress value={j.progress} className="mt-1.5" />
          {j.error && <div className="mt-1 text-xs text-amber-300/80">{j.error}</div>}
        </div>
      ))}
      <ul className="space-y-1 text-sm">
        {visible
          .filter((j) => j.status !== "running")
          .map((j) => (
            <li key={j.id} className="flex items-start justify-between gap-2 rounded-md px-2 py-1 hover:bg-ink-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge status={j.status}>{j.status}</Badge>
                  <span className="truncate text-stone-300">{j.label}</span>
                </div>
                {j.error && j.status === "failed" && <div className="mt-0.5 break-words text-xs text-red-300/90">{j.error}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-stone-500">
                {j.actual_cost > 0 && <span>{money(j.actual_cost)}</span>}
                {j.status === "failed" && (
                  <Button size="sm" onClick={() => post(`/api/jobs/${j.id}/retry`, {})} disabled={running}>
                    Retry
                  </Button>
                )}
              </div>
            </li>
          ))}
      </ul>
      {!compact && jobs.length > 0 && (
        <button className="mt-2 text-xs text-stone-500 hover:text-stone-300" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Hide completed" : `Show all ${jobs.length} jobs`}
        </button>
      )}
      {failedUnits.filter((u) => !jobs.some((j) => j.id === u.id)).length > 0 && (
        <div className="mt-3 border-t border-ink-700 pt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-stone-500">Failed in earlier runs</div>
          {failedUnits
            .filter((u) => !jobs.some((j) => j.id === u.id))
            .map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span className="truncate text-stone-300">{u.label}</span>
                <Button size="sm" onClick={() => post(`/api/jobs/${u.id}/retry`, {})} disabled={running}>
                  Retry
                </Button>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}
