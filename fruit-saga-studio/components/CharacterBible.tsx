"use client";

import { useEffect, useState } from "react";
import { ARCHETYPES, type Character } from "@/lib/types";
import { api } from "@/components/hooks";
import { Badge, Button, Card, cx, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { money } from "@/lib/format";

type CharacterWithBlock = Character & { prompt_block: string };

const EMPTY: Character = {
  id: "",
  display_name: "",
  role: "",
  archetype: "ally",
  descriptor: "",
  fruit: "",
  fruit_description: "",
  face_description: "",
  body_description: "",
  costume: "",
  props: [],
  height: "",
  personality: "",
  visual_traits: [],
  negative_traits: [],
  voice_profile: "",
  voice: {},
  reference_images: [],
  palette: { primary: "#5b6b4a", secondary: "#3b3024", accent: "#f5b642" },
  locked: false,
};

export function CharacterBible({ seriesId, initial, mode }: { seriesId: string; initial: CharacterWithBlock[]; mode: "preview" | "final" }) {
  const [chars, setChars] = useState<CharacterWithBlock[]>(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const reload = async (select?: string) => {
    const r = await api<CharacterWithBlock[]>(`/api/series/${seriesId}/characters`);
    if (r.ok && r.data) {
      setChars(r.data);
      if (select) setSelected(select);
    }
  };
  const current = creating ? null : (chars.find((c) => c.id === selected) ?? null);

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <div className="space-y-2">
        <Button
          variant="primary"
          className="w-full"
          onClick={() => {
            setCreating(true);
            setSelected(null);
          }}
        >
          ＋ New character
        </Button>
        {chars.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setCreating(false);
              setSelected(c.id);
            }}
            className={cx(
              "flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition",
              selected === c.id && !creating ? "border-gold-400/60 bg-gold-400/5" : "border-ink-700 bg-ink-900 hover:border-ink-600",
            )}
          >
            <span className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border-2" style={{ borderColor: c.palette.accent, background: c.palette.primary }}>
              {c.reference_images[0] ? (
                <img src={`/api/files/${c.reference_images[0]}`} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg">{fruitIcon(c.fruit)}</span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-stone-100">{c.display_name}</span>
                {c.locked && <span title="Appearance locked">🔒</span>}
              </span>
              <span className="block truncate text-xs text-stone-400">{c.descriptor || `${c.fruit}-headed ${c.role}`}</span>
            </span>
            <Badge tone={c.archetype === "antagonist" ? "red" : c.archetype === "creature" ? "fuchsia" : c.archetype === "hero" ? "gold" : "zinc"}>{c.archetype}</Badge>
          </button>
        ))}
      </div>
      <CharacterEditor
        key={creating ? "__new" : (current?.id ?? "none")}
        seriesId={seriesId}
        character={current}
        mode={mode}
        onSaved={(id) => {
          setCreating(false);
          void reload(id);
        }}
        onDeleted={() => {
          setSelected(null);
          void reload();
        }}
      />
    </div>
  );
}

function CharacterEditor({
  seriesId,
  character,
  mode,
  onSaved,
  onDeleted,
}: {
  seriesId: string;
  character: CharacterWithBlock | null;
  mode: "preview" | "final";
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const isNew = !character;
  const [c, setC] = useState<Character>(character ?? EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => setC(character ?? EMPTY), [character]);
  const set = <K extends keyof Character>(k: K, v: Character[K]) => setC((x) => ({ ...x, [k]: v }));
  const lockedUi = Boolean(character?.locked && c.locked);
  const lines = (v: string[]) => v.join("\n");
  const toList = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  async function save(next: Character = c) {
    setBusy("save");
    setError(null);
    const r = isNew
      ? await api<Character>(`/api/series/${seriesId}/characters`, "POST", next)
      : await api<Character>(`/api/series/${seriesId}/characters/${character!.id}`, "PUT", next);
    setBusy(null);
    if (!r.ok || !r.data) return setError(r.error);
    onSaved(r.data.id);
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    setBusy("upload");
    const r = await api(`/api/series/${seriesId}/characters/${character!.id}/references`, "POST", form);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onSaved(character!.id);
  }

  return (
    <Card
      title={isNew ? "New character" : c.display_name}
      subtitle={isNew ? "Every major character has a realistic fruit as their head." : `${c.archetype} · ${c.role}`}
      actions={
        <>
          {!isNew && (
            <Button
              variant={c.locked ? "secondary" : "ghost"}
              onClick={() => {
                const next = { ...c, locked: !c.locked };
                setC(next);
                void save(next);
              }}
              busy={busy === "save"}
              title="Locked characters keep an exact frozen prompt block; appearance fields become read-only."
            >
              {c.locked ? "🔓 Unlock appearance" : "🔒 Lock appearance"}
            </Button>
          )}
          <Button variant="primary" onClick={() => save()} busy={busy === "save"} disabled={!c.display_name || !c.fruit}>
            {isNew ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Notice tone="red">{error}</Notice>
        </div>
      )}
      {info && (
        <div className="mb-3">
          <Notice tone="emerald">{info}</Notice>
        </div>
      )}
      {lockedUi && (
        <div className="mb-4">
          <Notice>Appearance is locked: prompts use the frozen consistency block below. Unlock to change the fruit, face, body, costume, props or references.</Notice>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Display name">
          <Input value={c.display_name} onChange={(e) => set("display_name", e.target.value)} placeholder="Pip Applebrook" />
        </Field>
        <Field label="Id" hint={isNew ? "lowercase, used in scripts (auto from name)" : "fixed"}>
          <Input value={c.id} disabled={!isNew} onChange={(e) => set("id", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="auto" />
        </Field>
        <Field label="Archetype">
          <Select value={c.archetype} onChange={(e) => set("archetype", e.target.value as Character["archetype"])}>
            {ARCHETYPES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="Role">
          <Input value={c.role} onChange={(e) => set("role", e.target.value)} placeholder="reluctant ring-bearer" />
        </Field>
        <Field label="Descriptor" hint="Opens every prompt, e.g. “elderly pear-headed wizard”" className="md:col-span-2">
          <Input value={c.descriptor} disabled={lockedUi} onChange={(e) => set("descriptor", e.target.value)} />
        </Field>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">Fruit head</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Fruit">
          <Input value={c.fruit} disabled={lockedUi} onChange={(e) => set("fruit", e.target.value)} placeholder="apple" />
        </Field>
        <Field label="Fruit description" className="md:col-span-2">
          <Textarea rows={2} value={c.fruit_description} disabled={lockedUi} onChange={(e) => set("fruit_description", e.target.value)} />
        </Field>
        <Field label="Face (eyes, brows, mouth in the fruit)" className="md:col-span-3">
          <Textarea rows={2} value={c.face_description} disabled={lockedUi} onChange={(e) => set("face_description", e.target.value)} />
        </Field>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">Body & costume</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Body description">
          <Textarea rows={2} value={c.body_description} disabled={lockedUi} onChange={(e) => set("body_description", e.target.value)} />
        </Field>
        <Field label="Costume (clothing)">
          <Textarea rows={2} value={c.costume} disabled={lockedUi} onChange={(e) => set("costume", e.target.value)} />
        </Field>
        <Field label="Height">
          <Input value={c.height} disabled={lockedUi} onChange={(e) => set("height", e.target.value)} />
        </Field>
        <Field label="Props (one per line)">
          <Textarea rows={2} value={lines(c.props)} disabled={lockedUi} onChange={(e) => set("props", toList(e.target.value))} />
        </Field>
        <Field label="Visual traits that never change (one per line)">
          <Textarea rows={3} value={lines(c.visual_traits)} disabled={lockedUi} onChange={(e) => set("visual_traits", toList(e.target.value))} />
        </Field>
        <Field label="Negative traits (one per line)">
          <Textarea rows={3} value={lines(c.negative_traits)} disabled={lockedUi} onChange={(e) => set("negative_traits", toList(e.target.value))} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        {(["primary", "secondary", "accent"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-xs text-stone-400">
            <input type="color" value={c.palette[k]} disabled={lockedUi} onChange={(e) => set("palette", { ...c.palette, [k]: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-ink-600 bg-transparent" />
            {k} {k === "accent" ? "(subtitles & UI)" : k === "primary" ? "(costume)" : ""}
          </label>
        ))}
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">Personality & voice</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Personality">
          <Textarea rows={2} value={c.personality} onChange={(e) => set("personality", e.target.value)} />
        </Field>
        <Field label="Voice profile (sent to TTS as direction)">
          <Textarea rows={2} value={c.voice_profile} onChange={(e) => set("voice_profile", e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <Field label="OpenAI voice">
          <Input value={c.voice.openai_voice ?? ""} onChange={(e) => set("voice", { ...c.voice, openai_voice: e.target.value || undefined })} placeholder="fable" />
        </Field>
        <Field label="ElevenLabs voice id">
          <Input value={c.voice.elevenlabs_voice_id ?? ""} onChange={(e) => set("voice", { ...c.voice, elevenlabs_voice_id: e.target.value || undefined })} />
        </Field>
        <Field label="Local voice">
          <Input value={c.voice.local_voice ?? ""} onChange={(e) => set("voice", { ...c.voice, local_voice: e.target.value || undefined })} />
        </Field>
        <Field label="Mock pitch (Hz)">
          <Input type="number" value={c.voice.pitch_hz ?? ""} onChange={(e) => set("voice", { ...c.voice, pitch_hz: e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
        <Field label="Speed">
          <Input type="number" step={0.05} min={0.5} max={2} value={c.voice.speed ?? ""} onChange={(e) => set("voice", { ...c.voice, speed: e.target.value ? Number(e.target.value) : undefined })} placeholder="1" />
        </Field>
      </div>

      {!isNew && (
        <>
          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">Reference images</h3>
          <p className="mb-3 text-xs text-stone-500">Sent to image providers that support visual references (OpenAI Images) to keep this character identical across episodes.</p>
          <div className="flex flex-wrap gap-3">
            {character!.reference_images.map((ref) => (
              <div key={ref} className="group relative">
                <img src={`/api/files/${ref}`} alt="" className="h-32 rounded-lg border border-ink-700 object-cover" />
                {!lockedUi && (
                  <button
                    className="absolute right-1 top-1 hidden rounded bg-black/70 px-1.5 text-xs text-white group-hover:block"
                    onClick={async () => {
                      const r = await api(`/api/series/${seriesId}/characters/${character!.id}/references?path=${encodeURIComponent(ref)}`, "DELETE");
                      if (!r.ok) setError(r.error);
                      else onSaved(character!.id);
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {!lockedUi && (
              <label className="grid h-32 w-24 cursor-pointer place-items-center rounded-lg border border-dashed border-ink-600 text-center text-xs text-stone-500 hover:border-gold-400/60 hover:text-stone-300">
                {busy === "upload" ? "uploading…" : "＋ upload"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            )}
          </div>
          {!lockedUi && (
            <div className="mt-3 flex items-center gap-3">
              <Button
                size="sm"
                busy={busy === "sheet"}
                onClick={async () => {
                  setBusy("sheet");
                  setError(null);
                  const r = await api<{ cost: number; cached: boolean }>(`/api/series/${seriesId}/characters/${character!.id}/sheet`, "POST", { mode });
                  setBusy(null);
                  if (!r.ok || !r.data) return setError(r.error);
                  setInfo(`Reference sheet ${r.data.cached ? "reused from cache" : "generated"} (${money(r.data.cost)}).`);
                  onSaved(character!.id);
                }}
              >
                Generate reference sheet ({mode})
              </Button>
              <span className="text-xs text-stone-500">Tip: generate, pick the best sheet, delete the rest, then lock the character.</span>
            </div>
          )}

          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">Prompt consistency block</h3>
          <p className="mb-2 text-xs text-stone-500">Injected verbatim into every image, video and thumbnail prompt this character appears in — never just the name.</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-ink-950/80 p-3 font-mono text-xs leading-relaxed text-stone-300">{character!.prompt_block}</pre>

          <div className="mt-6 border-t border-ink-700 pt-4">
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                if (!window.confirm(`Delete ${c.display_name}? Scenes referencing "${c.id}" keep the id but lose the description.`)) return;
                await api(`/api/series/${seriesId}/characters/${character!.id}`, "DELETE");
                onDeleted();
              }}
            >
              Delete character
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function fruitIcon(fruit: string): string {
  const f = fruit.toLowerCase();
  const map: [RegExp, string][] = [
    [/apple/, "🍎"],
    [/pear/, "🍐"],
    [/orange|tangerine/, "🍊"],
    [/lemon|lime/, "🍋"],
    [/coconut/, "🥥"],
    [/strawberr/, "🍓"],
    [/pineapple/, "🍍"],
    [/melon/, "🍉"],
    [/peach/, "🍑"],
    [/cherr/, "🍒"],
    [/grape|passion|plum/, "🍇"],
    [/dragon/, "🐉"],
    [/pomegranate/, "🔴"],
  ];
  return map.find(([re]) => re.test(f))?.[1] ?? "🍏";
}
