"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BEAT_LABELS, type Beat, type DialogueLine } from "@/lib/types";
import { api } from "@/components/hooks";
import { useEpisode } from "@/components/episode/EpisodeShell";
import { JobsPanel } from "@/components/episode/JobsPanel";
import { CostPanel } from "@/components/episode/CostPanel";
import { PLATFORM_OPTIONS, TONES } from "@/components/NewEpisodeForm";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { epCode } from "@/lib/format";

const STEPS = [
  { action: "script", label: "Generate Script", hint: "Stage 1 · synopsis + continuity → screenplay", after: "draft" },
  { action: "shotlist", label: "Generate Shot List", hint: "Stage 2 · 6–10 shots with varied cameras", after: "scripted" },
  { action: "prompts", label: "Generate Prompts", hint: "Stages 3–4 · image/video prompts + social metadata", after: "shotlisted" },
  { action: "assets", label: "Generate Assets", hint: "Voice, sound plan, subtitles, keyframes, clips, thumbnails", after: "prompted" },
  { action: "render", label: "Render Episode", hint: "Mix to -14 LUFS + assemble 9:16 and 16:9", after: "voiced" },
] as const;

export function Overview() {
  const { view, run, running, refresh, setMessage } = useEpisode();
  const e = view.episode;
  const [form, setForm] = useState({
    episode_number: e.episode_number,
    title: e.title,
    synopsis: e.synopsis,
    tone: e.tone,
    target_duration: e.target_duration,
    platform: e.platform,
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({ episode_number: e.episode_number, title: e.title, synopsis: e.synopsis, tone: e.tone, target_duration: e.target_duration, platform: e.platform });
  }, [e.episode_number, e.title, e.synopsis, e.tone, e.target_duration, e.platform]);
  const dirty =
    form.episode_number !== e.episode_number ||
    form.title !== e.title ||
    form.synopsis !== e.synopsis ||
    form.tone !== e.tone ||
    form.target_duration !== e.target_duration ||
    form.platform !== e.platform;

  async function save() {
    setSaving(true);
    const r = await api(`/api/episodes/${e.id}`, "PATCH", form);
    setSaving(false);
    if (!r.ok) setMessage({ tone: "red", text: r.error ?? "Save failed" });
    await refresh();
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Card title="Episode creator" actions={dirty && <Button variant="primary" size="sm" busy={saving} onClick={save}>Save changes</Button>}>
          <div className="grid gap-4 md:grid-cols-[110px_1fr]">
            <Field label="Episode #">
              <Input type="number" min={1} value={form.episode_number} onChange={(ev) => setForm({ ...form, episode_number: Number(ev.target.value) })} />
            </Field>
            <Field label="Title" hint="Leave empty and the story engine will title it.">
              <Input value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} />
            </Field>
          </div>
          <Field label="Story synopsis" className="mt-4">
            <Textarea rows={3} value={form.synopsis} onChange={(ev) => setForm({ ...form, synopsis: ev.target.value })} />
          </Field>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Field label="Narrative tone">
              <Select value={form.tone} onChange={(ev) => setForm({ ...form, tone: ev.target.value })}>
                {!TONES.some(([v]) => v === form.tone) && <option value={form.tone}>{form.tone}</option>}
                {TONES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Target duration (s)">
              <Input type="number" min={15} max={180} value={form.target_duration} onChange={(ev) => setForm({ ...form, target_duration: Number(ev.target.value) })} />
            </Field>
            <Field label="Platform">
              <Select value={form.platform} onChange={(ev) => setForm({ ...form, platform: ev.target.value as typeof form.platform })}>
                {PLATFORM_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Pipeline" subtitle={`Runs in ${e.mode} mode (switch at the top right). Every step is editable before the next one.`}>
          {view.previousEpisode && !view.previousEpisode.continuity_committed && (
            <Notice tone="sky">
              {epCode(view.previousEpisode.episode_number)} is not committed to continuity yet — it will be folded into the series state
              automatically before this script is written.
            </Notice>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <button
                key={s.action}
                disabled={running || dirty}
                onClick={() => run({ action: s.action })}
                className="group rounded-xl border border-ink-600 bg-ink-850 p-3 text-left transition hover:border-gold-400/60 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="text-[11px] font-mono text-gold-400">{i + 1}</div>
                <div className="text-sm font-semibold text-stone-100">{s.label}</div>
                <div className="mt-1 text-[11px] leading-snug text-stone-500">{s.hint}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={running || dirty} onClick={() => run({ action: "generate" })}>
              ✨ Generate script → subtitles (no images/video)
            </Button>
            <Button disabled={running || dirty} onClick={() => run({ action: "all" })}>
              Run everything
            </Button>
            <Link href={`/episodes/${e.id}/scenes`} className="rounded-lg px-3.5 py-2 text-sm text-stone-300 hover:bg-ink-800">
              Review scenes →
            </Link>
          </div>
          {dirty && <p className="mt-2 text-xs text-amber-300/80">Save the episode changes before generating.</p>}
        </Card>

        <ScriptEditor />
      </div>

      <div className="space-y-5">
        <CostPanel />
        <JobsPanel compact />
        <ContinuityCard />
      </div>
    </div>
  );
}

function ScriptEditor() {
  const { view, refresh, setMessage } = useEpisode();
  const e = view.episode;
  const [beats, setBeats] = useState<Beat[]>(e.beats);
  const [tease, setTease] = useState(e.next_episode_tease);
  const [summary, setSummary] = useState(e.summary);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setBeats(e.beats);
    setTease(e.next_episode_tease);
    setSummary(e.summary);
  }, [e.beats, e.next_episode_tease, e.summary]);
  const dirty = JSON.stringify(beats) !== JSON.stringify(e.beats) || tease !== e.next_episode_tease || summary !== e.summary;
  const charName = (id: string) => view.characters.find((c) => c.id === id)?.display_name ?? id;
  const update = (i: number, patch: Partial<Beat>) => setBeats((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const words = beats.reduce((s, b) => s + wc(b.narration) + b.dialogue.reduce((n, d) => n + wc(d.line), 0), 0);

  if (!beats.length) {
    return (
      <Card title="Screenplay">
        <p className="text-sm text-stone-400">No script yet — click “Generate Script”.</p>
      </Card>
    );
  }

  return (
    <Card
      title="Screenplay"
      subtitle={`${words} spoken words · hook, 5 scenes and a cliffhanger. Edits here update the script; scene narration lives in the Scene Editor after the shot list is generated.`}
      actions={
        dirty && (
          <Button
            variant="primary"
            size="sm"
            busy={saving}
            onClick={async () => {
              setSaving(true);
              const r = await api(`/api/episodes/${e.id}`, "PATCH", { beats, next_episode_tease: tease, summary });
              setSaving(false);
              if (!r.ok) setMessage({ tone: "red", text: r.error ?? "Save failed" });
              await refresh();
            }}
          >
            Save script
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {beats.map((b, i) => (
          <div key={b.beat} className="rounded-xl border border-ink-700 bg-ink-850 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={b.beat === "hook" || b.beat === "cliffhanger" ? "gold" : "zinc"}>{BEAT_LABELS[b.beat]}</Badge>
              <span className="text-stone-500">@{view.locations.find((l) => l.id === b.location)?.name ?? b.location}</span>
              <span className="text-stone-500">· {b.characters.map(charName).join(", ")}</span>
              {b.emotion && <span className="italic text-stone-500">· {b.emotion}</span>}
            </div>
            {b.summary && <p className="mb-2 text-xs text-stone-400">{b.summary}</p>}
            <Textarea rows={2} value={b.narration} onChange={(ev) => update(i, { narration: ev.target.value })} placeholder="Narration" />
            {b.dialogue.map((d, k) => (
              <div key={k} className="mt-2 flex gap-2">
                <Select
                  className="!w-44 shrink-0"
                  value={d.character_id}
                  onChange={(ev) => update(i, { dialogue: b.dialogue.map((x, j) => (j === k ? { ...x, character_id: ev.target.value } : x)) })}
                >
                  {view.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name}
                    </option>
                  ))}
                </Select>
                <Input value={d.line} onChange={(ev) => update(i, { dialogue: b.dialogue.map((x, j) => (j === k ? { ...x, line: ev.target.value } : x)) })} />
                <Button variant="ghost" size="sm" onClick={() => update(i, { dialogue: b.dialogue.filter((_, j) => j !== k) })}>
                  ✕
                </Button>
              </div>
            ))}
            <button
              className="mt-2 text-xs text-stone-500 hover:text-gold-300"
              onClick={() => update(i, { dialogue: [...b.dialogue, { character_id: b.characters[0] ?? view.characters[0]?.id, line: "" } as DialogueLine] })}
            >
              + dialogue line
            </button>
          </div>
        ))}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Next episode tease">
            <Input value={tease} onChange={(ev) => setTease(ev.target.value)} />
          </Field>
          <Field label="Summary (feeds continuity)">
            <Textarea rows={2} value={summary} onChange={(ev) => setSummary(ev.target.value)} />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function ContinuityCard() {
  const { view, run, running } = useEpisode();
  const e = view.episode;
  return (
    <Card title="Continuity" subtitle="Episode N+1 is written from the state after episode N.">
      <p className="text-sm text-stone-400">
        {e.continuity_committed
          ? "This episode is committed to the series state. Re-commit after major script edits."
          : "When this episode is final, commit it so the next episode knows what happened (locations, possessions, injuries, villain, open threads)."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant={e.continuity_committed ? "secondary" : "primary"} disabled={running || !e.beats.length} onClick={() => run({ stages: ["continuity"] })}>
          {e.continuity_committed ? "Re-commit to continuity" : "Commit to continuity"}
        </Button>
        <Link href="/world" className="rounded-lg px-3 py-1 text-xs text-stone-400 hover:bg-ink-800">
          View series state →
        </Link>
      </div>
    </Card>
  );
}

const wc = (t: string) => (t.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
