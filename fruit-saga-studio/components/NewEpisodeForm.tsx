"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, runWithBudget } from "@/components/hooks";
import { Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";

export const TONES = [
  ["epic-comedic", "Epic & deadpan comedic"],
  ["dark suspense", "Dark & suspenseful"],
  ["whimsical adventure", "Whimsical adventure"],
  ["heroic", "Heroic & triumphant"],
  ["melancholic", "Melancholic"],
  ["horror-tinged", "Horror-tinged"],
] as const;

export const PLATFORM_OPTIONS = [
  ["youtube_shorts", "YouTube Shorts · 9:16"],
  ["tiktok", "TikTok · 9:16"],
  ["instagram_reels", "Instagram Reels · 9:16"],
  ["youtube", "YouTube · 16:9 (vertical derived)"],
] as const;

export function NewEpisodeForm({ seriesId, nextNumber, previousTease }: { seriesId: string; nextNumber: number; previousTease: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState({
    episode_number: nextNumber,
    title: "",
    synopsis: "",
    tone: "epic-comedic",
    target_duration: 60,
    platform: "youtube_shorts",
    mode: "preview",
  });
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const created = await api<{ id: number }>(`/api/series/${seriesId}/episodes`, "POST", form);
    if (!created.ok || !created.data) {
      setError(created.error);
      setBusy(false);
      return;
    }
    if (autoGenerate) {
      const run = await runWithBudget(`/api/episodes/${created.data.id}/run`, { action: "generate", mode: form.mode });
      if (!run.ok) setError(run.error);
    }
    router.push(`/episodes/${created.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card title="Episode" subtitle="Write the synopsis in your own words — the story engine turns it into a ~60 second screenplay that respects the series continuity.">
        <div className="grid gap-4 md:grid-cols-[140px_1fr]">
          <Field label="Episode #">
            <Input type="number" min={1} value={form.episode_number} onChange={(e) => set("episode_number", Number(e.target.value))} />
          </Field>
          <Field label="Title" hint="Optional — leave empty to let the story engine title it.">
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. The Seed That Whispered" />
          </Field>
        </div>
        <Field label="Story synopsis" className="mt-4" hint={previousTease ? `Previous episode promised: “${previousTease}”` : "One or two sentences is enough."}>
          <Textarea
            required
            rows={4}
            value={form.synopsis}
            onChange={(e) => set("synopsis", e.target.value)}
            placeholder={`Episode ${form.episode_number}: A small fruit-headed traveller receives a mysterious ring-shaped magical object and learns that it must be taken far from home.`}
          />
        </Field>
      </Card>

      <Card title="Format">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Narrative tone">
            <Select value={form.tone} onChange={(e) => set("tone", e.target.value)}>
              {TONES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Target duration · ${form.target_duration}s`} hint="55–65 s recommended for Shorts">
            <input
              type="range"
              min={30}
              max={90}
              step={1}
              value={form.target_duration}
              onChange={(e) => set("target_duration", Number(e.target.value))}
              className="mt-2 w-full accent-[#f5b642]"
            />
          </Field>
          <Field label="Primary platform">
            <Select value={form.platform} onChange={(e) => set("platform", e.target.value)}>
              {PLATFORM_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quality" hint="Preview = cheap & fast · Final = 1080p, best providers">
            <Select value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              <option value="preview">Preview</option>
              <option value="final">Final</option>
            </Select>
          </Field>
        </div>
      </Card>

      <label className="flex items-center gap-2 text-sm text-stone-300">
        <input type="checkbox" checked={autoGenerate} onChange={(e) => setAutoGenerate(e.target.checked)} className="accent-[#f5b642]" />
        Generate immediately: script, shot list, prompts, metadata, narration, sound plan and subtitles (no images or video yet)
      </label>
      {error && <Notice tone="red">{error}</Notice>}
      <div className="flex gap-3">
        <Button type="submit" variant="primary" size="lg" busy={busy}>
          {autoGenerate ? "Create & Generate" : "Create episode"}
        </Button>
      </div>
    </form>
  );
}
