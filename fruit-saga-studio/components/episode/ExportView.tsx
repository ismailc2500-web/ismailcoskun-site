"use client";

import { useEffect, useState } from "react";
import { PLATFORM_LABELS, type EpisodeAnalytics, type EpisodeMetadata, type Platform } from "@/lib/types";
import { api } from "@/components/hooks";
import { useEpisode } from "@/components/episode/EpisodeShell";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";

const PLATFORMS: Platform[] = ["tiktok", "youtube_shorts", "instagram_reels", "youtube"];

export function ExportView() {
  const { view, asset, run, running, refresh, setMessage } = useEpisode();
  const e = view.episode;
  const m = e.metadata;
  const vertical = asset("render_vertical");
  const landscape = asset("render_landscape");
  const thumbV = asset("thumbnail_vertical");
  const thumbL = asset("thumbnail_landscape");
  const [exported, setExported] = useState<Record<string, { folder: string; video: string; caption: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const captionFor = (p: Platform) => {
    const tags = m.hashtags.join(" ");
    if (p === "tiktok") return `${m.tiktok_caption}\n\n${tags}`;
    if (p === "instagram_reels") return `${m.instagram_caption}\n\n${tags}`;
    const title = p === "youtube" ? m.youtube_title.replace(/\s*#Shorts/i, "") : m.youtube_title;
    return `${title}\n\n${m.youtube_description}\n\n${p === "youtube" ? tags.replace(/#Shorts\s*/i, "") : tags}`;
  };

  async function exportPlatforms(platforms: Platform[]) {
    setBusy(platforms.join(","));
    const r = await api<{ platform: string; folder: string; video: string; caption: string }[]>(`/api/episodes/${e.id}/export`, "POST", { platforms, mode: e.mode });
    setBusy(null);
    if (!r.ok || !r.data) return setMessage({ tone: "red", text: r.error ?? "Export failed" });
    setExported((x) => ({ ...x, ...Object.fromEntries(r.data!.map((d) => [d.platform, d])) }));
    setMessage({ tone: "emerald", text: `Exported to ${r.data[0]?.folder.replace(/\/[^/]+$/, "")}/…` });
  }

  return (
    <div className="space-y-5">
      {!vertical && (
        <Notice>
          This episode has no {e.mode} render yet.{" "}
          <button className="underline" disabled={running} onClick={() => run({ action: "render" })}>
            Render it now
          </button>
          .
        </Notice>
      )}
      <Card
        title="Export"
        subtitle="Each package = video + caption.txt + thumbnail in output/…/exports/<platform>/"
        actions={
          <Button variant="primary" disabled={!vertical || !!busy} busy={busy === PLATFORMS.join(",")} onClick={() => exportPlatforms(PLATFORMS)}>
            Export all platforms
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLATFORMS.map((p) => {
            const video = p === "youtube" ? landscape : vertical;
            return (
              <div key={p} className="flex flex-col rounded-xl border border-ink-700 bg-ink-850 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-stone-100">{PLATFORM_LABELS[p]}</span>
                  {exported[p] && <Badge tone="emerald">exported</Badge>}
                </div>
                <div className={p === "youtube" ? "aspect-video" : "mx-auto aspect-[9/16] w-2/3"}>
                  {video ? (
                    <video src={video.url} poster={(p === "youtube" ? thumbL : thumbV)?.url} controls playsInline className="h-full w-full rounded-lg bg-black object-contain" />
                  ) : (
                    <div className="grid h-full place-items-center rounded-lg bg-ink-900 text-xs text-stone-600">no render</div>
                  )}
                </div>
                <CopyBox text={captionFor(p)} />
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  {video && (
                    <a href={`${video.url}&download=1`} className="rounded-lg bg-ink-700 px-3 py-1.5 text-xs hover:bg-ink-600">
                      ⬇ Video
                    </a>
                  )}
                  <Button size="sm" disabled={!video || !!busy} busy={busy === p} onClick={() => exportPlatforms([p])}>
                    Export package
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <MetadataEditor metadata={m} />
        <Card
          title="Thumbnails"
          subtitle="1–3 big fruit faces, clear conflict, space for text"
          actions={
            <Button size="sm" disabled={running} onClick={() => run({ stages: ["thumbnails"] })}>
              Regenerate
            </Button>
          }
        >
          <div className="grid grid-cols-[2fr_3fr] items-start gap-3">
            {thumbV ? (
              <a href={thumbV.url} target="_blank" rel="noreferrer"><img src={thumbV.url} alt="9:16 thumbnail" className="rounded-lg border border-ink-700" /></a>
            ) : (
              <div className="aspect-[9/16] rounded-lg bg-ink-850" />
            )}
            {thumbL ? (
              <a href={thumbL.url} target="_blank" rel="noreferrer"><img src={thumbL.url} alt="16:9 thumbnail" className="rounded-lg border border-ink-700" /></a>
            ) : (
              <div className="aspect-video rounded-lg bg-ink-850" />
            )}
          </div>
          <details className="mt-3 text-xs text-stone-400">
            <summary className="cursor-pointer text-stone-300">Thumbnail prompts</summary>
            <p className="mt-2 whitespace-pre-wrap font-mono">{m.thumbnail_prompt_vertical}</p>
            <p className="mt-2 whitespace-pre-wrap font-mono">{m.thumbnail_prompt_landscape}</p>
          </details>
        </Card>
      </div>

      <AnalyticsCard />

      <Card title="Publishing">
        <div className="flex flex-wrap items-center gap-3 text-sm text-stone-400">
          <span>Status:</span>
          <Badge status={e.status}>{e.status.replace("_", " ")}</Badge>
          <Button
            size="sm"
            onClick={async () => {
              await api(`/api/episodes/${e.id}`, "PATCH", { status: e.status === "published" ? "rendered" : "published" });
              await refresh();
            }}
          >
            {e.status === "published" ? "Mark as not published" : "Mark as published"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-3">
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-950/70 p-2 text-[11px] leading-relaxed text-stone-300">{text}</pre>
      <button
        className="absolute right-1.5 top-1.5 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-stone-200 hover:bg-ink-600"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

function MetadataEditor({ metadata }: { metadata: EpisodeMetadata }) {
  const { view, run, running, refresh, setMessage } = useEpisode();
  const [m, setM] = useState(metadata);
  useEffect(() => setM(metadata), [metadata]);
  const dirty = JSON.stringify(m) !== JSON.stringify(metadata);
  const set = <K extends keyof EpisodeMetadata>(k: K, v: EpisodeMetadata[K]) => setM((x) => ({ ...x, [k]: v }));
  return (
    <Card
      title="Social metadata"
      subtitle="Curiosity-driven, not clickbait. Regenerate or edit by hand."
      actions={
        <>
          <Button size="sm" disabled={running} onClick={() => run({ stages: ["metadata"] })}>
            Regenerate
          </Button>
          {dirty && (
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const r = await api(`/api/episodes/${view.episode.id}`, "PATCH", { metadata: m });
                if (!r.ok) setMessage({ tone: "red", text: r.error ?? "Save failed" });
                await refresh();
              }}
            >
              Save
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={`YouTube Shorts title · ${m.youtube_title.length}/100`} className="md:col-span-2">
          <Input value={m.youtube_title} onChange={(e) => set("youtube_title", e.target.value)} />
        </Field>
        <Field label={`TikTok caption · ${m.tiktok_caption.length}`}>
          <Textarea rows={3} value={m.tiktok_caption} onChange={(e) => set("tiktok_caption", e.target.value)} />
        </Field>
        <Field label="Instagram caption">
          <Textarea rows={3} value={m.instagram_caption} onChange={(e) => set("instagram_caption", e.target.value)} />
        </Field>
        <Field label="YouTube description" className="md:col-span-2">
          <Textarea rows={5} value={m.youtube_description} onChange={(e) => set("youtube_description", e.target.value)} />
        </Field>
        <Field label="Hashtags (space separated)" className="md:col-span-2">
          <Input value={m.hashtags.join(" ")} onChange={(e) => set("hashtags", e.target.value.split(/\s+/).filter(Boolean))} />
        </Field>
        <Field label="Thumbnail text">
          <Input value={m.thumbnail_text} onChange={(e) => set("thumbnail_text", e.target.value)} />
        </Field>
        <Field label="Next episode teaser">
          <Input value={m.next_episode_teaser} onChange={(e) => set("next_episode_teaser", e.target.value)} />
        </Field>
        <Field label="Thumbnail concept" className="md:col-span-2">
          <Textarea rows={2} value={m.thumbnail_concept} onChange={(e) => set("thumbnail_concept", e.target.value)} />
        </Field>
      </div>
    </Card>
  );
}

function AnalyticsCard() {
  const { view } = useEpisode();
  const [rows, setRows] = useState<EpisodeAnalytics[]>([]);
  const [form, setForm] = useState({ platform: "youtube_shorts", views: "", likes: "", comments: "", shares: "", saves: "", avg_watch_seconds: "", completion_rate: "", ctr: "", followers_gained: "", notes: "" });
  const load = async () => {
    const r = await api<EpisodeAnalytics[]>(`/api/episodes/${view.episode.id}/analytics`);
    if (r.ok && r.data) setRows(r.data);
  };
  useEffect(() => {
    void load();
  }, [view.episode.id]);
  const num = (k: keyof typeof form, label: string) => (
    <Field label={label}>
      <Input type="number" min={0} step="any" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Card title="Performance log" subtitle="Record platform stats over time — the dashboard ranks hooks, casts and durations by completion rate.">
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="Platform">
          <Select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
        {num("views", "Views")}
        {num("likes", "Likes")}
        {num("comments", "Comments")}
        {num("shares", "Shares")}
        {num("saves", "Saves")}
        {num("avg_watch_seconds", "Avg watch (s)")}
        {num("completion_rate", "Completion %")}
        {num("ctr", "CTR %")}
        {num("followers_gained", "Followers gained")}
      </div>
      <div className="mt-3 flex gap-2">
        <Input placeholder="Notes (e.g. posted 18:00, trending sound)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        <Button
          variant="primary"
          onClick={async () => {
            const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k === "platform" || k === "notes" ? v : Number(v || 0)]));
            const r = await api(`/api/episodes/${view.episode.id}/analytics`, "POST", payload);
            if (r.ok) {
              setForm({ ...form, views: "", likes: "", comments: "", shares: "", saves: "", avg_watch_seconds: "", completion_rate: "", ctr: "", followers_gained: "", notes: "" });
              await load();
            }
          }}
        >
          Log
        </Button>
      </div>
      {rows.length > 0 && (
        <table className="mt-4 w-full text-left text-xs">
          <thead className="text-stone-500">
            <tr>
              <th className="py-1">When</th>
              <th>Platform</th>
              <th>Views</th>
              <th>Likes</th>
              <th>Avg watch</th>
              <th>Completion</th>
              <th>CTR</th>
              <th>Followers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-ink-700 text-stone-300">
                <td className="py-1.5">{new Date(r.captured_at).toLocaleString()}</td>
                <td>{r.platform}</td>
                <td>{r.views.toLocaleString()}</td>
                <td>{r.likes.toLocaleString()}</td>
                <td>{r.avg_watch_seconds}s</td>
                <td>{r.completion_rate}%</td>
                <td>{r.ctr}%</td>
                <td>{r.followers_gained}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
