"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Series } from "@/lib/types";
import { api } from "@/components/hooks";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";

type SeriesRow = Series & { episodes: number; characters: number };

export function SeriesManager({ series, active }: { series: SeriesRow[]; active: string | null }) {
  const router = useRouter();
  const [creating, setCreating] = useState({ title: "", logline: "" });
  const [error, setError] = useState<string | null>(null);
  const current = series.find((s) => s.id === active) ?? series[0];

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <Card title="Your series">
          <div className="space-y-2">
            {series.map((s) => (
              <button
                key={s.id}
                onClick={async () => {
                  await api("/api/active-series", "POST", { seriesId: s.id });
                  router.refresh();
                }}
                className={`w-full rounded-xl border p-3 text-left ${s.id === current?.id ? "border-gold-400/60 bg-gold-400/5" : "border-ink-700 bg-ink-850 hover:border-ink-600"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-100">{s.title}</span>
                  {s.id === current?.id && <Badge tone="gold">active</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-stone-500">
                  {s.episodes} episodes · {s.characters} characters · <code>{s.id}</code>
                </div>
              </button>
            ))}
          </div>
        </Card>
        <Card title="New series" subtitle="Starts empty — add characters and locations next.">
          {error && <Notice tone="red">{error}</Notice>}
          <div className="space-y-3">
            <Field label="Title">
              <Input value={creating.title} onChange={(e) => setCreating({ ...creating, title: e.target.value })} placeholder="The Orchard Chronicles" />
            </Field>
            <Field label="Logline">
              <Textarea rows={2} value={creating.logline} onChange={(e) => setCreating({ ...creating, logline: e.target.value })} />
            </Field>
            <Button
              variant="primary"
              disabled={!creating.title}
              onClick={async () => {
                const r = await api<Series>("/api/series", "POST", creating);
                if (!r.ok || !r.data) return setError(r.error);
                await api("/api/active-series", "POST", { seriesId: r.data.id });
                setCreating({ title: "", logline: "" });
                router.push("/characters");
                router.refresh();
              }}
            >
              Create series
            </Button>
          </div>
        </Card>
      </div>
      {current && <SeriesSettings key={current.id} series={current} />}
    </div>
  );
}

function SeriesSettings({ series }: { series: Series }) {
  const router = useRouter();
  const [s, setS] = useState(series);
  const [msg, setMsg] = useState<{ tone: "red" | "emerald"; text: string } | null>(null);
  const st = s.settings;
  const setSettings = (patch: Partial<Series["settings"]>) => setS({ ...s, settings: { ...st, ...patch } });
  const dirty = JSON.stringify(s) !== JSON.stringify(series);
  return (
    <Card
      title={`${series.title} · settings`}
      subtitle="Applies to every episode of this series."
      actions={
        dirty && (
          <Button
            variant="primary"
            onClick={async () => {
              const r = await api(`/api/series/${series.id}`, "PUT", s);
              setMsg(r.ok ? { tone: "emerald", text: "Saved." } : { tone: "red", text: r.error ?? "Save failed" });
              router.refresh();
            }}
          >
            Save settings
          </Button>
        )
      }
    >
      {msg && (
        <div className="mb-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title">
          <Input value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} />
        </Field>
        <Field label="Series hashtags (space separated)">
          <Input value={st.hashtags.join(" ")} onChange={(e) => setSettings({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })} />
        </Field>
        <Field label="Logline" className="md:col-span-2">
          <Textarea rows={2} value={s.logline} onChange={(e) => setS({ ...s, logline: e.target.value })} />
        </Field>
        <Field label="Series tone (story engine)" className="md:col-span-2">
          <Textarea rows={2} value={s.tone} onChange={(e) => setS({ ...s, tone: e.target.value })} />
        </Field>
        <Field label="Visual style notes (appended to every image prompt)" className="md:col-span-2">
          <Textarea rows={2} value={s.style_notes} onChange={(e) => setS({ ...s, style_notes: e.target.value })} />
        </Field>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">Narration</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Words per minute" hint="Drives the word budget">
          <Input type="number" min={90} max={220} value={st.words_per_minute} onChange={(e) => setSettings({ words_per_minute: Number(e.target.value) })} />
        </Field>
        <Field label="Narrator OpenAI voice">
          <Input value={st.narrator_voice.openai_voice ?? ""} onChange={(e) => setSettings({ narrator_voice: { ...st.narrator_voice, openai_voice: e.target.value || undefined } })} placeholder="onyx" />
        </Field>
        <Field label="Narrator ElevenLabs id">
          <Input value={st.narrator_voice.elevenlabs_voice_id ?? ""} onChange={(e) => setSettings({ narrator_voice: { ...st.narrator_voice, elevenlabs_voice_id: e.target.value || undefined } })} />
        </Field>
        <Field label="Mock pitch (Hz)">
          <Input type="number" value={st.narrator_voice.pitch_hz ?? ""} onChange={(e) => setSettings({ narrator_voice: { ...st.narrator_voice, pitch_hz: e.target.value ? Number(e.target.value) : undefined } })} />
        </Field>
        <Field label="Narrator direction" className="md:col-span-4">
          <Input value={st.narrator_voice_profile} onChange={(e) => setSettings({ narrator_voice_profile: e.target.value })} />
        </Field>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">Subtitles, music & finishing</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Subtitle style">
          <Select value={st.subtitles.mode} onChange={(e) => setSettings({ subtitles: { ...st.subtitles, mode: e.target.value as "word" | "phrase" } })}>
            <option value="word">Word-by-word highlight</option>
            <option value="phrase">Phrase captions</option>
          </Select>
        </Field>
        <Field label="Burn into video">
          <Select value={st.subtitles.burn_in ? "yes" : "no"} onChange={(e) => setSettings({ subtitles: { ...st.subtitles, burn_in: e.target.value === "yes" } })}>
            <option value="yes">Yes</option>
            <option value="no">No (SRT/ASS only)</option>
          </Select>
        </Field>
        <Field label="Uppercase captions">
          <Select value={st.subtitles.uppercase ? "yes" : "no"} onChange={(e) => setSettings({ subtitles: { ...st.subtitles, uppercase: e.target.value === "yes" } })}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </Select>
        </Field>
        <Field label="Caption font">
          <Input value={st.subtitles.font} onChange={(e) => setSettings({ subtitles: { ...st.subtitles, font: e.target.value } })} placeholder="SUBTITLE_FONT (Arial)" />
        </Field>
        <Field label="Music mood" hint="dark-epic · tense · whimsical · heroic (or a library file prefix)">
          <Input value={st.music.mood} onChange={(e) => setSettings({ music: { ...st.music, mood: e.target.value } })} />
        </Field>
        <Field label="Music level (dB)">
          <Input type="number" value={st.music.volume_db} onChange={(e) => setSettings({ music: { ...st.music, volume_db: Number(e.target.value) } })} />
        </Field>
        <Field label="Ducking under voice (dB)">
          <Input type="number" value={st.music.duck_db} onChange={(e) => setSettings({ music: { ...st.music, duck_db: Number(e.target.value) } })} />
        </Field>
        <Field label="16:9 ⇄ 9:16 reframing">
          <Select value={st.landscape_strategy} onChange={(e) => setSettings({ landscape_strategy: e.target.value as "blur" | "crop" })}>
            <option value="blur">Blurred fill (no crop)</option>
            <option value="crop">Crop</option>
          </Select>
        </Field>
        <Field label="Film grain">
          <Select value={st.finishing.film_grain ? "yes" : "no"} onChange={(e) => setSettings({ finishing: { ...st.finishing, film_grain: e.target.value === "yes" } })}>
            <option value="yes">On</option>
            <option value="no">Off</option>
          </Select>
        </Field>
        <Field label="Vignette">
          <Select value={st.finishing.vignette ? "yes" : "no"} onChange={(e) => setSettings({ finishing: { ...st.finishing, vignette: e.target.value === "yes" } })}>
            <option value="yes">On</option>
            <option value="no">Off</option>
          </Select>
        </Field>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">Intro & outro</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {(["intro", "outro"] as const).map((k) => (
          <div key={k} className="space-y-3 rounded-xl border border-ink-700 p-3">
            <label className="flex items-center gap-2 text-sm capitalize text-stone-200">
              <input type="checkbox" checked={st[k].enabled} onChange={(e) => setSettings({ [k]: { ...st[k], enabled: e.target.checked } } as Partial<Series["settings"]>)} className="accent-[#f5b642]" />
              {k} {k === "intro" ? "(off by default — hooks work better without one)" : ""}
            </label>
            <Field label="Duration (s)">
              <Input type="number" step={0.5} min={0.5} max={6} value={st[k].duration} onChange={(e) => setSettings({ [k]: { ...st[k], duration: Number(e.target.value) } } as Partial<Series["settings"]>)} />
            </Field>
            <Field label="Card text">
              <Input value={st[k].text} onChange={(e) => setSettings({ [k]: { ...st[k], text: e.target.value } } as Partial<Series["settings"]>)} />
            </Field>
            <Field label="Custom video file (optional)" hint="Path relative to the project, e.g. assets/intro.mp4">
              <Input value={st[k].video_path} onChange={(e) => setSettings({ [k]: { ...st[k], video_path: e.target.value } } as Partial<Series["settings"]>)} />
            </Field>
          </div>
        ))}
      </div>
    </Card>
  );
}
