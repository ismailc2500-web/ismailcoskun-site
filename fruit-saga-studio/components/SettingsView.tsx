"use client";

import { useState } from "react";
import type { CatalogEntry, ResolvedProvider } from "@/lib/ai/registry";
import type { ProviderKind } from "@/lib/types";
import { api } from "@/components/hooks";
import { Badge, Button, Card, Field, Input, Notice, Select } from "@/components/ui";
import { money } from "@/lib/format";

export interface SettingsData {
  mock: { active: boolean; source: "env" | "settings" | null };
  envMockMode: boolean;
  budget: number;
  concurrency: number;
  retry: { maxAttempts: number; baseDelayMs: number };
  catalog: Record<ProviderKind, CatalogEntry[]>;
  resolved: Record<ProviderKind, { preview: ResolvedProvider; final: ResolvedProvider }>;
  defaultPricing: Record<ProviderKind, Record<string, Record<string, number>>>;
  credentials: Record<string, boolean>;
  ffmpeg: { ok: boolean; version?: string; error?: string; missingFilters: string[] };
  cache: { kind: string; entries: number; hits: number; savedUsd: number }[];
}

const KIND_LABELS: Record<ProviderKind, string> = { llm: "Story LLM", image: "Keyframe images", video: "Image-to-video", tts: "Voice (TTS)" };

export function SettingsView({ initial }: { initial: SettingsData }) {
  const [data, setData] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const reload = async () => {
    const r = await api<SettingsData>("/api/settings");
    if (r.ok && r.data) setData(r.data);
  };

  return (
    <div className="space-y-6">
      <Card title="Mock mode" subtitle="With mock mode no paid API is ever called: placeholder art, animatic video, placeholder voice, offline writer.">
        <div className="flex flex-wrap items-center gap-3">
          {data.mock.active ? <Badge tone="gold">mock mode active ({data.mock.source})</Badge> : <Badge tone="red">live providers</Badge>}
          {data.envMockMode ? (
            <span className="text-sm text-stone-400">
              Set <code className="text-stone-200">MOCK_MODE=false</code> in <code className="text-stone-200">.env</code> and restart to enable real providers.
            </span>
          ) : (
            <Button
              size="sm"
              onClick={async () => {
                await api("/api/settings", "PUT", { forceMock: !data.mock.active });
                await reload();
              }}
            >
              {data.mock.active ? "Use live providers" : "Force mock mode"}
            </Button>
          )}
        </div>
        <div className="mt-4 grid gap-3 text-sm text-stone-400 md:grid-cols-3">
          <div>
            Budget guard: <b className="text-stone-200">{money(data.budget)}</b> per run <span className="text-xs">(MAX_EPISODE_BUDGET_USD)</span>
          </div>
          <div>
            Concurrency: <b className="text-stone-200">{data.concurrency}</b> <span className="text-xs">(GENERATION_CONCURRENCY)</span>
          </div>
          <div>
            Retries: <b className="text-stone-200">{data.retry.maxAttempts}</b> attempts, exponential backoff from {data.retry.baseDelayMs / 1000}s
          </div>
        </div>
      </Card>

      {msg && <Notice tone="emerald">{msg}</Notice>}

      <Card title="Providers" subtitle="Choose a provider per capability and per mode. Preview can use cheaper models (or the free animatic for video).">
        <div className="space-y-5">
          {(Object.keys(KIND_LABELS) as ProviderKind[]).map((kind) => (
            <div key={kind}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-gold-400">{KIND_LABELS[kind]}</h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {(["preview", "final"] as const).map((mode) => (
                  <ProviderEditor
                    key={`${kind}-${mode}-${data.resolved[kind][mode].provider}`}
                    kind={kind}
                    mode={mode}
                    resolved={data.resolved[kind][mode]}
                    catalog={data.catalog[kind]}
                    credentials={data.credentials}
                    defaultPricing={data.defaultPricing[kind]}
                    mockActive={data.mock.active}
                    onSaved={async (text) => {
                      setMsg(text);
                      await reload();
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="FFmpeg">
          {data.ffmpeg.ok ? (
            <p className="text-sm text-emerald-300">✓ {data.ffmpeg.version}</p>
          ) : (
            <Notice tone="red">
              {data.ffmpeg.error ?? `Missing filters: ${data.ffmpeg.missingFilters.join(", ")}`}. Install FFmpeg 6+ (see README) or set FFMPEG_PATH.
            </Notice>
          )}
        </Card>
        <Card
          title="Generation cache"
          subtitle="Identical requests (prompt + model + seed + settings) are never paid for twice."
          actions={
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!window.confirm("Delete every cached generation? Future renders will regenerate (and pay) again.")) return;
                const r = await api<{ removed: number }>("/api/settings", "DELETE");
                setMsg(`Removed ${r.data?.removed ?? 0} cached files.`);
                await reload();
              }}
            >
              Clear cache
            </Button>
          }
        >
          {data.cache.length === 0 ? (
            <p className="text-sm text-stone-500">Empty.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-stone-500">
                <tr>
                  <th className="py-1">Kind</th>
                  <th>Entries</th>
                  <th>Reuses</th>
                  <th>Saved</th>
                </tr>
              </thead>
              <tbody>
                {data.cache.map((c) => (
                  <tr key={c.kind} className="border-t border-ink-700 text-stone-300">
                    <td className="py-1">{c.kind}</td>
                    <td>{c.entries}</td>
                    <td>{c.hits}</td>
                    <td>{money(c.savedUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function ProviderEditor({
  kind,
  mode,
  resolved,
  catalog,
  credentials,
  defaultPricing,
  mockActive,
  onSaved,
}: {
  kind: ProviderKind;
  mode: "preview" | "final";
  resolved: ResolvedProvider;
  catalog: CatalogEntry[];
  credentials: Record<string, boolean>;
  defaultPricing: Record<string, Record<string, number>>;
  mockActive: boolean;
  onSaved: (msg: string) => void;
}) {
  const [provider, setProvider] = useState(resolved.provider);
  const [model, setModel] = useState(resolved.model);
  const [quality, setQuality] = useState(resolved.quality);
  const [pricing, setPricing] = useState<Record<string, number>>(resolved.pricing);
  const [error, setError] = useState<string | null>(null);
  const entry = catalog.find((c) => c.id === provider);
  const missing = entry?.env.filter((v) => !credentials[v]) ?? [];
  const priceKeys = Object.keys({ ...(defaultPricing[provider] ?? {}), ...pricing });

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold capitalize text-stone-100">{mode}</span>
        <span className="text-xs text-stone-500">
          {mockActive ? `from ${resolved.source} · mock mode overrides it` : `from ${resolved.source}`}
        </span>
      </div>
      {error && <Notice tone="red">{error}</Notice>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Provider" className="sm:col-span-2">
          <Select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setPricing(defaultPricing[e.target.value] ?? {});
              setModel("");
            }}
          >
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Model" hint="empty = default">
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" />
        </Field>
        <Field label="Quality">
          {kind === "image" ? (
            <Select value={quality} onChange={(e) => setQuality(e.target.value)}>
              {["low", "medium", "high"].map((q) => (
                <option key={q}>{q}</option>
              ))}
            </Select>
          ) : kind === "video" ? (
            <Select value={quality} onChange={(e) => setQuality(e.target.value)}>
              <option value="std">std</option>
              <option value="pro">pro</option>
            </Select>
          ) : (
            <Input value={quality} onChange={(e) => setQuality(e.target.value)} placeholder="—" />
          )}
        </Field>
      </div>
      {missing.length > 0 && provider !== "mock" && <p className="mt-2 text-xs text-red-300">Missing env: {missing.join(", ")}</p>}
      {entry?.note && <p className="mt-1 text-xs text-stone-500">{entry.note}</p>}
      {priceKeys.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {priceKeys.map((k) => (
            <Field key={k} label={k.replace(/_/g, " ")}>
              <Input type="number" step="any" min={0} value={pricing[k] ?? defaultPricing[provider]?.[k] ?? 0} onChange={(e) => setPricing({ ...pricing, [k]: Number(e.target.value) })} />
            </Field>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={async () => {
            setError(null);
            const r = await api("/api/settings", "PUT", { kind, mode, provider, model, quality, pricing });
            if (!r.ok) return setError(r.error);
            onSaved(`Saved ${kind} (${mode}) → ${provider}`);
          }}
        >
          Save
        </Button>
        {resolved.source === "settings" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await api("/api/settings", "PUT", { kind, mode, reset: true });
              onSaved(`Reset ${kind} (${mode}) to the .env default`);
            }}
          >
            Reset to .env
          </Button>
        )}
      </div>
    </div>
  );
}
