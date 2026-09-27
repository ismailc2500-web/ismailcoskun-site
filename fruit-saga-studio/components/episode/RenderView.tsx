"use client";

import { useEffect, useRef, useState } from "react";
import type { GenerationJob, Scene, SoundCue, Timeline } from "@/lib/types";
import { useEpisode } from "@/components/episode/EpisodeShell";
import { JobsPanel } from "@/components/episode/JobsPanel";
import { Badge, Button, Card, cx, Empty, Progress } from "@/components/ui";
import { money, secs } from "@/lib/format";

const SFX_COLORS: Record<string, string> = {
  hit: "#ef4444",
  whoosh: "#38bdf8",
  magic: "#c084fc",
  riser: "#f59e0b",
  creature: "#84cc16",
  footsteps: "#a8a29e",
  sword: "#e5e7eb",
  heartbeat: "#f43f5e",
  thunder: "#60a5fa",
};

export function RenderView() {
  const { view, run, running, asset } = useEpisode();
  const e = view.episode;
  const timeline = e.timeline as Timeline | null;
  const vertical = asset("render_vertical");
  const landscape = asset("render_landscape");
  const other = e.mode === "final" ? "preview" : "final";
  const otherVertical = asset("render_vertical", null, other);
  const mix = asset("mix");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const assembleJob = (view.runJobs as GenerationJob[]).find((j) => j.stage === "assemble");

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setT(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [vertical?.url]);

  const seek = (s: number) => {
    setT(s);
    if (videoRef.current) videoRef.current.currentTime = s;
  };

  return (
    <div className="space-y-5">
      <Card
        title="Render"
        subtitle={`Mode: ${e.mode}. Missing assets are generated first; everything already made is reused from the cache.`}
        actions={
          <>
            <Button variant="primary" disabled={running} onClick={() => run({ action: "render" })}>
              ▶ Render episode ({e.mode})
            </Button>
            <Button disabled={running} onClick={() => run({ stages: ["mix", "assemble"] })}>
              Re-mix & re-assemble only
            </Button>
          </>
        }
      >
        {assembleJob && assembleJob.status === "running" && (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-sm text-stone-300">
              <span>Assembling video…</span>
              <span>{Math.round(assembleJob.progress * 100)}%</span>
            </div>
            <Progress value={assembleJob.progress} />
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-stone-300">9:16 vertical</span>
              {vertical && (
                <a className="text-xs text-gold-300 hover:underline" href={`${vertical.url}&download=1`}>
                  ⬇ download
                </a>
              )}
            </div>
            <div className="aspect-[9/16] overflow-hidden rounded-xl border border-ink-700 bg-black">
              {vertical ? <video ref={videoRef} key={vertical.url} src={vertical.url} poster={asset("thumbnail_vertical")?.url} controls playsInline className="h-full w-full" /> : <Placeholder />}
            </div>
          </div>
          <div className="min-w-0 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-stone-300">16:9 YouTube</span>
                {landscape && (
                  <a className="text-xs text-gold-300 hover:underline" href={`${landscape.url}&download=1`}>
                    ⬇ download
                  </a>
                )}
              </div>
              <div className="aspect-video overflow-hidden rounded-xl border border-ink-700 bg-black">
                {landscape ? <video key={landscape.url} src={landscape.url} poster={asset("thumbnail_landscape")?.url} controls playsInline className="h-full w-full" /> : <Placeholder />}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <Metric label="Duration" value={vertical?.duration ? secs(vertical.duration) : timeline ? secs(timeline.total_duration) : "—"} />
              <Metric label="Loudness" value={mix?.meta.integratedLufs !== undefined ? `${mix.meta.integratedLufs} LUFS` : "—"} hint="target -14" />
              <Metric label="True peak" value={mix?.meta.truePeakDb !== undefined ? `${mix.meta.truePeakDb} dBTP` : "—"} hint="ceiling -1.5" />
              <Metric label="Spent" value={money(view.spend)} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {(["narration", "music", "sfx", "mix", "subtitle_srt"] as const).map((k) => {
                const a = asset(k);
                return a ? (
                  <a key={k} href={a.url} target="_blank" className="rounded-md bg-ink-800 px-2 py-1 text-stone-300 hover:bg-ink-700" rel="noreferrer">
                    {k.replace("subtitle_", "")}
                  </a>
                ) : null;
              })}
              {asset("subtitle_ass", null, `${e.mode}:vertical`) && (
                <a href={asset("subtitle_ass", null, `${e.mode}:vertical`)!.url} target="_blank" className="rounded-md bg-ink-800 px-2 py-1 text-stone-300 hover:bg-ink-700" rel="noreferrer">
                  ass (9:16)
                </a>
              )}
              {view.logUrl && (
                <a href={view.logUrl} target="_blank" className="rounded-md bg-ink-800 px-2 py-1 text-stone-300 hover:bg-ink-700" rel="noreferrer">
                  render.log
                </a>
              )}
              {otherVertical && (
                <a href={otherVertical.url} target="_blank" className="rounded-md bg-ink-800 px-2 py-1 text-stone-300 hover:bg-ink-700" rel="noreferrer">
                  {other} render
                </a>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Timeline" subtitle="Click to seek the 9:16 preview. Voice clips are placed exactly where the subtitles expect them.">
        {timeline ? <TimelineView timeline={timeline} scenes={view.scenes as Scene[]} time={t} onSeek={seek} /> : <Empty title="No timeline yet">Generate narration (Generate Assets) to lay out the episode.</Empty>}
      </Card>

      <JobsPanel />
    </div>
  );
}

function Placeholder() {
  return <div className="grid h-full place-items-center text-sm text-stone-600">not rendered yet</div>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-ink-850 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-stone-100">{value}</div>
      {hint && <div className="text-[10px] text-stone-600">{hint}</div>}
    </div>
  );
}

function TimelineView({ timeline, scenes, time, onSeek }: { timeline: Timeline; scenes: Scene[]; time: number; onSeek: (s: number) => void }) {
  const { view, asset } = useEpisode();
  const total = timeline.total_duration;
  const pct = (s: number) => `${(s / total) * 100}%`;
  const plan = view.episode.sound_plan;
  const speakerColor = (id: string) => view.characters.find((c) => c.id === id)?.palette.accent ?? "#f5b642";
  const ticks = Array.from({ length: Math.floor(total / 5) + 1 }, (_, i) => i * 5);
  const lane = (label: string, children: React.ReactNode, h = "h-10") => (
    <div className="flex items-stretch gap-2">
      <div className="w-20 shrink-0 pt-1 text-[11px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className={cx("relative flex-1 rounded-md bg-ink-850", h)}>{children}</div>
    </div>
  );
  return (
    <div
      className="relative space-y-1.5 select-none"
      onClick={(e) => {
        const lanes = (e.currentTarget as HTMLElement).querySelector("[data-ruler]") as HTMLElement | null;
        if (!lanes) return;
        const r = lanes.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        if (x >= 0 && x <= 1) onSeek(x * total);
      }}
    >
      {lane(
        "time",
        <div data-ruler className="absolute inset-0">
          {ticks.map((s) => (
            <span key={s} className="absolute top-0 text-[10px] text-stone-500" style={{ left: pct(s) }}>
              <span className="block h-2 border-l border-ink-600" />
              {s}s
            </span>
          ))}
        </div>,
        "h-7",
      )}
      {lane(
        "video",
        <>
          {timeline.intro_duration > 0 && <Block left={0} width={timeline.intro_duration} total={total} color="#3f3f46" label="intro" />}
          {timeline.scenes.map((s) => {
            const scene = scenes.find((x) => x.scene_id === s.scene_id);
            const kf = asset("keyframe", s.scene_id);
            return (
              <div
                key={s.scene_id}
                className="absolute inset-y-0 overflow-hidden rounded border border-black/60"
                style={{ left: pct(s.start), width: pct(s.duration), backgroundImage: kf ? `url(${kf.url})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }}
                title={`${s.scene_id} · ${scene?.camera ?? ""} · ${s.duration.toFixed(1)}s · → ${s.transition}`}
              >
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-mono text-[10px] text-gold-300">{s.scene_id}</span>
                {s.transition_duration > 0 && <span className="absolute inset-y-0 right-0 bg-white/25" style={{ width: `${(s.transition_duration / s.duration) * 100}%` }} title={s.transition} />}
              </div>
            );
          })}
          {timeline.outro_duration > 0 && <Block left={total - timeline.outro_duration} width={timeline.outro_duration} total={total} color="#3f3f46" label="outro" />}
        </>,
        "h-20",
      )}
      {lane(
        "voice",
        timeline.voice.map((v) => (
          <div
            key={v.id}
            className="absolute inset-y-1 overflow-hidden rounded px-1 text-[10px] leading-4 text-ink-950"
            style={{ left: pct(v.start), width: pct(v.duration), background: v.speaker === "narrator" ? "#e7e5e4" : speakerColor(v.speaker) }}
            title={`${v.speaker}: ${v.text}`}
          >
            {v.speaker === "narrator" ? v.text : `${v.speaker}: ${v.text}`}
          </div>
        )),
      )}
      {plan &&
        lane(
          "music",
          <>
            <div className="absolute inset-y-3 left-0 right-0 rounded bg-gradient-to-r from-violet-900/70 via-violet-700/60 to-violet-900/70" title={`${plan.music.mood} · ${plan.music.volume_db} dB · ducks ${plan.music.duck_db} dB under voice`} />
            {plan.music.swells.map((s) => (
              <span key={s} className="absolute inset-y-0 w-0.5 bg-violet-300" style={{ left: pct(s) }} title="swell" />
            ))}
            <span className="absolute left-1 top-1 text-[10px] text-violet-200">{plan.music.mood}</span>
          </>,
          "h-8",
        )}
      {plan &&
        lane(
          "ambience",
          plan.ambience.map((c: SoundCue) => {
            const weather = c.note !== "location bed";
            return (
              <div
                key={c.id}
                className="absolute h-[45%] overflow-hidden rounded px-1 text-[10px] text-stone-200"
                style={{ top: weather ? "52%" : "3%", left: pct(c.start), width: pct(c.duration), background: weather ? "#1e3a5f" : "#14532d" }}
                title={`${c.type} (${c.note})`}
              >
                {c.type.replace("_ambience", "")}
              </div>
            );
          }),
          "h-11",
        )}
      {plan &&
        lane(
          "sfx",
          plan.sfx.map((c: SoundCue) => (
            <div key={c.id} className="absolute inset-y-1 rounded px-0.5 text-[9px] text-black/80" style={{ left: pct(c.start), width: `max(6px, ${pct(c.duration)})`, background: SFX_COLORS[c.type] ?? "#a1a1aa" }} title={`${c.type} @${c.start}s (${c.volume_db} dB) ${c.note}`}>
              {c.type}
            </div>
          )),
        )}
      <div className="pointer-events-none absolute inset-y-0 left-[5.5rem] right-0">
        <div className="absolute inset-y-0 w-0.5 bg-gold-400 shadow-[0_0_8px_rgba(245,182,66,0.9)]" style={{ left: pct(Math.min(time, total)) }} />
      </div>
      <div className="flex flex-wrap gap-3 pt-2 text-xs text-stone-500">
        <span>content {secs(timeline.content_duration)}</span>
        <span>total {secs(timeline.total_duration)}</span>
        <span>{timeline.voice.length} voice clips</span>
        {plan && <span>{plan.sfx.length} sfx · {plan.ambience.length} beds</span>}
        <Badge tone={timeline.total_duration >= 55 && timeline.total_duration <= 65 ? "emerald" : "amber"}>
          {timeline.total_duration >= 55 && timeline.total_duration <= 65 ? "within 55–65 s" : "outside 55–65 s"}
        </Badge>
      </div>
    </div>
  );
}

function Block({ left, width, total, color, label }: { left: number; width: number; total: number; color: string; label: string }) {
  return (
    <div className="absolute inset-y-1 overflow-hidden rounded px-1 text-[10px] text-stone-200" style={{ left: `${(left / total) * 100}%`, width: `${(width / total) * 100}%`, background: color }} title={label}>
      {label}
    </div>
  );
}
