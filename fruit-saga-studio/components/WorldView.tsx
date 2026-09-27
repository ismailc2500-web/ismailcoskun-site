"use client";

import { useEffect, useState } from "react";
import { ENVIRONMENT_TYPES, type Character, type Location, type SeriesState } from "@/lib/types";
import { api } from "@/components/hooks";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";

export function WorldView({
  seriesId,
  locations: initialLocations,
  state: initialState,
  snapshots,
  characters,
}: {
  seriesId: string;
  locations: Location[];
  state: SeriesState;
  snapshots: SeriesState[];
  characters: Character[];
}) {
  const [locations, setLocations] = useState(initialLocations);
  const [editing, setEditing] = useState<string | null>(null);
  const reload = async () => {
    const r = await api<Location[]>(`/api/series/${seriesId}/locations`);
    if (r.ok && r.data) setLocations(r.data);
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <div className="space-y-4">
        <Card title="Locations" subtitle="Environments are injected into every prompt that uses them." actions={<Button size="sm" variant="primary" onClick={() => setEditing("__new")}>＋ Location</Button>}>
          <div className="space-y-2">
            {editing === "__new" && <LocationEditor seriesId={seriesId} location={null} onDone={() => { setEditing(null); void reload(); }} />}
            {locations.map((l) =>
              editing === l.id ? (
                <LocationEditor key={l.id} seriesId={seriesId} location={l} onDone={() => { setEditing(null); void reload(); }} />
              ) : (
                <button key={l.id} onClick={() => setEditing(l.id)} className="flex w-full items-start gap-3 rounded-xl border border-ink-700 bg-ink-850 p-3 text-left hover:border-ink-600">
                  <span className="mt-0.5 h-10 w-10 shrink-0 rounded-lg" style={{ background: `linear-gradient(180deg, ${l.palette.sky}, ${l.palette.ground})`, boxShadow: `inset 0 -6px 12px ${l.palette.accent}55` }} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-stone-100">{l.name}</span>
                      <Badge>{l.environment_type}</Badge>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-stone-400">{l.description}</span>
                  </span>
                </button>
              ),
            )}
          </div>
        </Card>
      </div>
      <ContinuityEditor seriesId={seriesId} initial={initialState} snapshots={snapshots} characters={characters} locations={locations} />
    </div>
  );
}

function LocationEditor({ seriesId, location, onDone }: { seriesId: string; location: Location | null; onDone: () => void }) {
  const [l, setL] = useState<Location>(
    location ?? {
      id: "",
      name: "",
      environment_type: "forest",
      description: "",
      lighting: "",
      atmosphere: "",
      visual_details: [],
      ambience: "",
      palette: { sky: "#1d2433", ground: "#1b1f16", accent: "#f5b642" },
    },
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Location>(k: K, v: Location[K]) => setL((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-3 rounded-xl border border-gold-400/40 bg-ink-850 p-3">
      {error && <Notice tone="red">{error}</Notice>}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <Input value={l.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Environment type">
          <Select value={l.environment_type} onChange={(e) => set("environment_type", e.target.value as Location["environment_type"])}>
            {ENVIRONMENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Description" className="md:col-span-2">
          <Textarea rows={2} value={l.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Lighting">
          <Input value={l.lighting} onChange={(e) => set("lighting", e.target.value)} />
        </Field>
        <Field label="Atmosphere">
          <Input value={l.atmosphere} onChange={(e) => set("atmosphere", e.target.value)} />
        </Field>
        <Field label="Visual details (one per line)">
          <Textarea rows={2} value={l.visual_details.join("\n")} onChange={(e) => set("visual_details", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />
        </Field>
        <Field label="Ambience bed" hint="village_ambience, forest_ambience, wind, fire_ambience, water_ambience, cave_ambience">
          <Input value={l.ambience} onChange={(e) => set("ambience", e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-stone-400">
        {(["sky", "ground", "accent"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="color" value={l.palette[k]} onChange={(e) => set("palette", { ...l.palette, [k]: e.target.value })} className="h-7 w-9 rounded border border-ink-600 bg-transparent" />
            {k}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={async () => {
            const r = location ? await api(`/api/series/${seriesId}/locations/${location.id}`, "PUT", l) : await api(`/api/series/${seriesId}/locations`, "POST", l);
            if (!r.ok) return setError(r.error);
            onDone();
          }}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {location && (
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              if (!window.confirm(`Delete ${location.name}?`)) return;
              await api(`/api/series/${seriesId}/locations/${location.id}`, "DELETE");
              onDone();
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function ContinuityEditor({
  seriesId,
  initial,
  snapshots,
  characters,
  locations,
}: {
  seriesId: string;
  initial: SeriesState;
  snapshots: SeriesState[];
  characters: Character[];
  locations: Location[];
}) {
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setS(initial), [initial]);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
  const list = (v: string[]) => v.join("\n");
  const toList = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

  return (
    <Card
      title="Series continuity"
      subtitle={`The canonical state after episode ${s.as_of_episode}. The story engine reads this — never its own memory — before writing the next episode.`}
      actions={
        dirty && (
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              const r = await api<SeriesState>(`/api/series/${seriesId}/state`, "PUT", s);
              if (r.ok && r.data) {
                setSaved(r.data);
                setS(r.data);
                setMsg("Saved. Written to series_state.json.");
              } else setMsg(r.error);
            }}
          >
            Save state
          </Button>
        )
      }
    >
      {msg && <p className="mb-3 text-xs text-emerald-300">{msg}</p>}
      <div className="space-y-3">
        <Field label="Current objective">
          <Textarea rows={2} value={s.current_objective} onChange={(e) => setS({ ...s, current_objective: e.target.value })} />
        </Field>
        <Field label="Villain state">
          <Textarea rows={2} value={s.villain_state} onChange={(e) => setS({ ...s, villain_state: e.target.value })} />
        </Field>
        <Field label="Unresolved plot points (one per line)">
          <Textarea rows={3} value={list(s.unresolved_plot_points)} onChange={(e) => setS({ ...s, unresolved_plot_points: toList(e.target.value) })} />
        </Field>
        <Field label="World facts (one per line)">
          <Textarea rows={3} value={list(s.world_notes)} onChange={(e) => setS({ ...s, world_notes: toList(e.target.value) })} />
        </Field>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-400">Characters</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-1">Character</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Possessions</th>
                  <th>Injuries</th>
                  <th>Feeling</th>
                </tr>
              </thead>
              <tbody>
                {characters.map((c) => {
                  const cs = s.character_states[c.id] ?? { location: "", status: "active", possessions: [], injuries: [], emotional_state: "", notes: "" };
                  const upd = (patch: Partial<typeof cs>) => setS({ ...s, character_states: { ...s.character_states, [c.id]: { ...cs, ...patch } } });
                  return (
                    <tr key={c.id} className="border-t border-ink-700 align-top">
                      <td className="py-1.5 pr-2 text-stone-200">{c.display_name}</td>
                      <td className="pr-2">
                        <Select className="!py-1 text-xs" value={cs.location} onChange={(e) => upd({ location: e.target.value })}>
                          {!locations.some((l) => l.id === cs.location) && <option value={cs.location}>{locName(cs.location) || "—"}</option>}
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="pr-2">
                        <Input className="!py-1 text-xs" value={cs.status} onChange={(e) => upd({ status: e.target.value })} />
                      </td>
                      <td className="pr-2">
                        <Input className="!py-1 text-xs" value={cs.possessions.join(", ")} onChange={(e) => upd({ possessions: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                      </td>
                      <td className="pr-2">
                        <Input className="!py-1 text-xs" value={cs.injuries.join(", ")} onChange={(e) => upd({ injuries: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                      </td>
                      <td>
                        <Input className="!py-1 text-xs" value={cs.emotional_state} onChange={(e) => upd({ emotional_state: e.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-400">Relationships</div>
          <ul className="space-y-1 text-sm text-stone-300">
            {s.relationships.map((r, i) => (
              <li key={i}>
                <b className="text-stone-100">{r.a}</b> & <b className="text-stone-100">{r.b}</b>: {r.status}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-stone-400">Major events</div>
          <ol className="space-y-1 text-sm text-stone-300">
            {s.major_events.map((ev, i) => (
              <li key={i}>
                <span className="mr-2 font-mono text-xs text-gold-400">EP{ev.episode}</span>
                {ev.event}
              </li>
            ))}
          </ol>
        </div>
        <details className="text-xs text-stone-400">
          <summary className="cursor-pointer text-stone-300">History: {snapshots.length} snapshot(s)</summary>
          <ul className="mt-2 space-y-1">
            {snapshots.map((snap) => (
              <li key={snap.as_of_episode}>
                after EP {snap.as_of_episode}: <span className="text-stone-300">{snap.current_objective || "—"}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Card>
  );
}
