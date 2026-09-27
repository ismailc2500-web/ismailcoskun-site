"use client";

import { useCallback, useEffect, useState } from "react";
import type { EpisodeEstimate } from "@/lib/pipeline/estimate";
import { api } from "@/components/hooks";
import { useEpisode } from "@/components/episode/EpisodeShell";
import { Badge, Card, Select } from "@/components/ui";
import { money } from "@/lib/format";

const ACTIONS = [
  ["render", "Render episode (assets + mix + video)"],
  ["assets", "Generate assets only"],
  ["generate", "Text + voice stages"],
  ["all", "Everything from scratch"],
] as const;

/** Estimated API cost before generating — per scene and per episode, cached assets at $0. */
export function CostPanel() {
  const { view, running } = useEpisode();
  const [mode, setMode] = useState<"preview" | "final">(view.episode.mode);
  const [action, setAction] = useState<string>("render");
  const [est, setEst] = useState<EpisodeEstimate | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await api<EpisodeEstimate>(`/api/episodes/${view.episode.id}/estimate?mode=${mode}&action=${action}`);
    if (r.ok) setEst(r.data);
  }, [view.episode.id, mode, action]);

  useEffect(() => {
    void load();
  }, [load, view.episode.updated_at, running]);

  return (
    <Card
      title="Cost estimate"
      subtitle="Before anything is generated. Cached assets cost $0."
      actions={
        <div className="flex gap-2">
          <Select value={mode} onChange={(e) => setMode(e.target.value as "preview" | "final")} className="!w-auto !py-1 text-xs">
            <option value="preview">Preview</option>
            <option value="final">Final</option>
          </Select>
        </div>
      }
    >
      <Select value={action} onChange={(e) => setAction(e.target.value)} className="mb-3 text-xs">
        {ACTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      {!est ? (
        <div className="text-sm text-stone-500">Calculating…</div>
      ) : (
        <>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-bold text-stone-50">{money(est.total)}</div>
              <div className="text-xs text-stone-500">
                without cache {money(est.fullPrice)} · budget {money(est.budget)}
              </div>
            </div>
            {est.mock ? <Badge tone="gold">mock · free</Badge> : est.overBudget ? <Badge tone="red">over budget</Badge> : <Badge tone="emerald">within budget</Badge>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs text-stone-400">
            {(["llm", "image", "video", "tts"] as const).map((k) => (
              <div key={k} className="rounded-md bg-ink-850 px-2 py-1.5">
                <span className="uppercase text-stone-500">{k}</span> · {est.providers[k].provider}
                <div className="truncate text-[11px] text-stone-500">{est.providers[k].model}</div>
              </div>
            ))}
          </div>
          {est.notes.map((n) => (
            <p key={n} className="mt-2 text-xs text-stone-500">
              {n}
            </p>
          ))}
          <button className="mt-3 text-xs text-gold-300 hover:underline" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"} per-scene breakdown
          </button>
          {open && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1">Scene</th>
                  <th>Image</th>
                  <th>Video</th>
                  <th>Voice</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {est.scenes.map((s) => (
                  <tr key={s.scene_id} className="border-t border-ink-700">
                    <td className="py-1 font-mono text-stone-300">{s.scene_id}</td>
                    <td>{s.keyframe ? (s.keyframe.cached ? <span className="text-teal-300">cached</span> : money(s.keyframe.cost)) : "—"}</td>
                    <td>{s.clip ? (s.clip.cached ? <span className="text-teal-300">cached</span> : money(s.clip.cost)) : "—"}</td>
                    <td>{s.voice ? (s.voice.cached ? <span className="text-teal-300">cached</span> : money(s.voice.cost)) : "—"}</td>
                    <td className="text-right text-stone-200">{money(s.total)}</td>
                  </tr>
                ))}
                <tr className="border-t border-ink-600 text-stone-400">
                  <td className="py-1" colSpan={4}>
                    LLM {money(est.llm)} · thumbnails {est.thumbnails ? money(est.thumbnails.cost) : "—"}
                  </td>
                  <td className="text-right font-semibold text-stone-100">{money(est.total)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}
    </Card>
  );
}
