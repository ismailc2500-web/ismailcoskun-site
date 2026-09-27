"use client";

import { useEffect, useMemo, useState } from "react";
import { BEAT_LABELS, BEATS, type GenerationJob, type Scene } from "@/lib/types";
import { FRAMINGS, MOVEMENTS, TRANSITIONS } from "@/lib/prompts/vocabulary";
import { api } from "@/components/hooks";
import { useEpisode } from "@/components/episode/EpisodeShell";
import { Badge, Button, cx, Empty, Field, Input, Select, Textarea } from "@/components/ui";
import { secs } from "@/lib/format";

const PROMPT_FIELDS = ["image_prompt", "video_prompt", "negative_prompt"] as const;

export function SceneEditor() {
  const { view, run, running, refresh, setMessage } = useEpisode();
  const [filter, setFilter] = useState<string>("all");
  const scenes = view.scenes as Scene[];
  if (!scenes.length) {
    return (
      <Empty title="No scenes yet">
        Generate the script and the shot list first (Overview tab).
        <div className="mt-3">
          <Button variant="primary" disabled={running} onClick={() => run({ action: "generate" })}>
            ✨ Generate script → subtitles
          </Button>
        </div>
      </Empty>
    );
  }
  const shown = filter === "all" ? scenes : scenes.filter((s) => s.beat === filter);
  const total = view.episode.timeline?.content_duration ?? scenes.reduce((s, x) => s + x.duration, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {["all", ...BEATS].map((b) => (
            <button
              key={b}
              onClick={() => setFilter(b)}
              className={cx("rounded-full px-3 py-1 text-xs", filter === b ? "bg-gold-400 text-ink-950" : "bg-ink-800 text-stone-300 hover:bg-ink-700")}
            >
              {b === "all" ? `All ${scenes.length}` : BEAT_LABELS[b as keyof typeof BEAT_LABELS]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="self-center text-stone-400">{secs(total)} of content</span>
          <Button size="sm" disabled={running} onClick={() => run({ stages: ["prompts"] })}>
            Rebuild prompts
          </Button>
          <Button size="sm" disabled={running} onClick={() => run({ stages: ["keyframes"] })}>
            Generate keyframes
          </Button>
          <Button size="sm" variant="primary" disabled={running} onClick={() => run({ action: "assets" })}>
            Generate all assets
          </Button>
        </div>
      </div>
      {shown.map((scene) => (
        <SceneCard key={scene.scene_id} scene={scene} />
      ))}
      <Button
        onClick={async () => {
          const r = await api(`/api/episodes/${view.episode.id}/scenes`, "POST", {});
          if (!r.ok) setMessage({ tone: "red", text: r.error ?? "Could not add scene" });
          await refresh();
        }}
      >
        ＋ Add scene
      </Button>
    </div>
  );
}

function SceneCard({ scene }: { scene: Scene }) {
  const { view, asset, refresh, post, running, setMessage } = useEpisode();
  const [draft, setDraft] = useState<Scene>(scene);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"story" | "camera" | "prompts">("story");
  useEffect(() => setDraft(scene), [scene]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(scene);
  const set = <K extends keyof Scene>(k: K, v: Scene[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const keyframe = asset("keyframe", scene.scene_id);
  const clip = asset("clip", scene.scene_id);
  const tl = view.episode.timeline?.scenes.find((t) => t.scene_id === scene.scene_id);
  const units = (view.units as GenerationJob[]).filter((u) => u.scene_id === scene.scene_id);
  const unitStatus = (stage: string) => units.filter((u) => u.stage === stage).pop();
  const locked = new Set(draft.locked_fields);
  const vertical = view.aspect === "9:16";

  const save = async () => {
    setSaving(true);
    const r = await api(`/api/episodes/${view.episode.id}/scenes/${scene.scene_id}`, "PATCH", draft);
    setSaving(false);
    if (!r.ok) setMessage({ tone: "red", text: r.error ?? "Save failed" });
    await refresh();
  };
  const regen = (what: "keyframe" | "clip" | "voice") =>
    post(`/api/episodes/${view.episode.id}/scenes/${scene.scene_id}/regenerate`, { what, newVariation: true });
  const toggleLock = (field: string) => {
    const next = new Set(draft.locked_fields);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    set("locked_fields", [...next]);
  };

  return (
    <article className="rounded-2xl border border-ink-700 bg-ink-900/80 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-gold-400">{scene.scene_id}</span>
          <Badge tone={scene.beat === "hook" || scene.beat === "cliffhanger" ? "gold" : "zinc"}>{BEAT_LABELS[scene.beat]}</Badge>
          <span className="text-sm text-stone-300">{scene.camera}</span>
          <span className="text-xs text-stone-500">
            {tl ? `${secs(tl.start)} → ${secs(tl.start + tl.duration)} (${tl.duration.toFixed(1)}s)` : `${scene.duration}s planned`}
          </span>
          {["keyframes", "clips", "narration"].map((st) => {
            const u = unitStatus(st);
            return u ? (
              <Badge key={st} status={u.status} className="normal-case" >
                {st.replace(/s$/, "")}: {u.status}
              </Badge>
            ) : null;
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={running} onClick={() => regen("keyframe")} title="New seed → new keyframe (and its clip)">
            ↻ Keyframe
          </Button>
          <Button size="sm" disabled={running || !keyframe} onClick={() => regen("clip")}>
            ↻ Clip
          </Button>
          <Button size="sm" disabled={running} onClick={() => regen("voice")}>
            ↻ Voice
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!window.confirm(`Delete ${scene.scene_id}?`)) return;
              await api(`/api/episodes/${view.episode.id}/scenes/${scene.scene_id}`, "DELETE");
              await refresh();
            }}
          >
            Delete
          </Button>
          {dirty && (
            <Button size="sm" variant="primary" busy={saving} onClick={save}>
              Save
            </Button>
          )}
        </div>
      </header>

      <div className={cx("grid gap-4", vertical ? "md:grid-cols-[180px_1fr]" : "md:grid-cols-[300px_1fr]")}>
        <div className="space-y-2">
          <div className={cx("overflow-hidden rounded-xl border border-ink-700 bg-ink-850", vertical ? "aspect-[9/16]" : "aspect-video")}>
            {clip ? (
              <video
                key={clip.url}
                src={clip.url}
                poster={keyframe?.url}
                muted
                loop
                playsInline
                className="h-full w-full object-cover"
                onMouseEnter={(ev) => void ev.currentTarget.play().catch(() => {})}
                onMouseLeave={(ev) => ev.currentTarget.pause()}
              />
            ) : keyframe ? (
              <img src={keyframe.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center p-3 text-center text-xs text-stone-600">no keyframe yet</div>
            )}
          </div>
          <div className="text-[11px] text-stone-500">{clip ? "hover to play clip" : keyframe ? "keyframe (no clip yet)" : ""}</div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex gap-1 border-b border-ink-700 text-xs">
            {(["story", "camera", "prompts"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-3 py-1.5 capitalize", tab === t ? "border-gold-400 text-stone-100" : "border-transparent text-stone-500 hover:text-stone-300")}>
                {t === "prompts" ? `Prompts${draft.locked_fields.length ? ` · ${draft.locked_fields.length} locked` : ""}` : t}
              </button>
            ))}
          </div>

          {tab === "story" && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Scene description" className="md:col-span-2">
                <Textarea rows={2} value={draft.description} onChange={(e) => set("description", e.target.value)} />
              </Field>
              <Field label="Narration" className="md:col-span-2">
                <Textarea rows={2} value={draft.narration} onChange={(e) => set("narration", e.target.value)} />
              </Field>
              <div className="md:col-span-2">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-400">Dialogue</span>
                {draft.dialogue.map((d, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <Select
                      className="!w-44 shrink-0"
                      value={d.character_id}
                      onChange={(e) => set("dialogue", draft.dialogue.map((x, j) => (j === i ? { ...x, character_id: e.target.value } : x)))}
                    >
                      {view.characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.display_name}
                        </option>
                      ))}
                    </Select>
                    <Input value={d.line} onChange={(e) => set("dialogue", draft.dialogue.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)))} />
                    <Button variant="ghost" size="sm" onClick={() => set("dialogue", draft.dialogue.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  </div>
                ))}
                <button
                  className="text-xs text-stone-500 hover:text-gold-300"
                  onClick={() => set("dialogue", [...draft.dialogue, { character_id: draft.characters[0] ?? view.characters[0]?.id ?? "", line: "" }])}
                >
                  + dialogue line
                </button>
              </div>
              <Field label="Characters in frame" className="md:col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  {view.characters.map((c) => {
                    const on = draft.characters.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => set("characters", on ? draft.characters.filter((x) => x !== c.id) : [...draft.characters, c.id])}
                        className={cx("rounded-full border px-2.5 py-1 text-xs", on ? "border-gold-400/60 bg-gold-400/10 text-gold-200" : "border-ink-600 text-stone-400 hover:text-stone-200")}
                      >
                        <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: c.palette.accent }} />
                        {c.display_name} · {c.fruit}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Action (what physically happens)" className="md:col-span-2">
                <Textarea rows={2} value={draft.action} onChange={(e) => set("action", e.target.value)} />
              </Field>
              <Field label="Location">
                <Select value={draft.location} onChange={(e) => set("location", e.target.value)}>
                  {view.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Emotion">
                <Input value={draft.emotion} onChange={(e) => set("emotion", e.target.value)} />
              </Field>
              <Field label="Beat">
                <Select value={draft.beat} onChange={(e) => set("beat", e.target.value as Scene["beat"])}>
                  {BEATS.map((b) => (
                    <option key={b} value={b}>
                      {BEAT_LABELS[b]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Planned duration (s)" hint="The timeline extends a shot if its narration needs more room.">
                <Input type="number" step={0.1} min={1} max={30} value={draft.duration} onChange={(e) => set("duration", Number(e.target.value))} />
              </Field>
              <Field label="Sound design" className="md:col-span-2" hint="Cues: ambience, footsteps, sword, magic, hit, whoosh, creature, riser, heartbeat, thunder, rain, fire, water, wind">
                <Input value={draft.sound_design} onChange={(e) => set("sound_design", e.target.value)} />
              </Field>
            </div>
          )}

          {tab === "camera" && (
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Framing">
                <ComboSelect value={draft.camera_framing} options={FRAMINGS} onChange={(v) => set("camera_framing", v)} />
              </Field>
              <Field label="Camera movement">
                <ComboSelect value={draft.camera_movement} options={MOVEMENTS} onChange={(v) => set("camera_movement", v)} />
              </Field>
              <Field label="Transition to next shot">
                <ComboSelect value={draft.transition} options={TRANSITIONS} onChange={(v) => set("transition", v)} />
              </Field>
              <Field label="Environment" className="md:col-span-3">
                <Textarea rows={2} value={draft.environment} onChange={(e) => set("environment", e.target.value)} />
              </Field>
              <Field label="Lighting" className="md:col-span-3">
                <Input value={draft.lighting} onChange={(e) => set("lighting", e.target.value)} />
              </Field>
              <Field label="Subject motion" className="md:col-span-3">
                <Textarea rows={2} value={draft.subject_motion} onChange={(e) => set("subject_motion", e.target.value)} />
              </Field>
              <Field label="Environment motion" className="md:col-span-3">
                <Textarea rows={2} value={draft.environment_motion} onChange={(e) => set("environment_motion", e.target.value)} />
              </Field>
              <Field label="Facial expression" className="md:col-span-3">
                <Input value={draft.facial_expression} onChange={(e) => set("facial_expression", e.target.value)} />
              </Field>
            </div>
          )}

          {tab === "prompts" && (
            <div className="space-y-3">
              <p className="text-xs text-stone-500">
                Prompts are composed automatically from the character bible + this scene. Editing a prompt locks it 🔒 so regeneration keeps your
                version; unlock to let the engine rebuild it.
              </p>
              {PROMPT_FIELDS.map((f) => (
                <Field
                  key={f}
                  label={
                    <span className="flex items-center gap-2">
                      {f.replace("_", " ")}
                      <button type="button" onClick={() => toggleLock(f)} className={cx("rounded px-1.5 text-[10px] normal-case", locked.has(f) ? "bg-gold-400/20 text-gold-200" : "bg-ink-800 text-stone-500")}>
                        {locked.has(f) ? "🔒 locked — click to unlock" : "auto"}
                      </button>
                    </span>
                  }
                >
                  <Textarea
                    rows={f === "negative_prompt" ? 3 : 8}
                    value={draft[f]}
                    onChange={(e) => set(f, e.target.value)}
                    className="font-mono text-xs"
                  />
                </Field>
              ))}
              <Field label="Seed" hint="Changing the seed produces a new variation (and a new cache entry).">
                <Input type="number" value={draft.seed} onChange={(e) => set("seed", Number(e.target.value))} className="!w-48" />
              </Field>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ComboSelect({ value, options, onChange }: { value: string; options: readonly string[]; onChange: (v: string) => void }) {
  const list = useMemo(() => (options.includes(value) || !value ? options : [value, ...options]), [options, value]);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>
  );
}
