import { ensureBootstrapped } from "@/lib/bootstrap";
import { config } from "@/lib/config";
import { DEFAULT_PRICING } from "@/lib/ai/pricing";
import { credentialStatus, mockModeState, PROVIDER_CATALOG, resolveProvider } from "@/lib/ai/registry";
import { cacheStats } from "@/lib/db/repos/assets";
import { checkFfmpeg } from "@/lib/video/ffmpeg";
import { SettingsView, type SettingsData } from "@/components/SettingsView";
import type { ProviderKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  ensureBootstrapped();
  const kinds: ProviderKind[] = ["llm", "image", "video", "tts"];
  const data: SettingsData = {
    mock: mockModeState(),
    envMockMode: config.mockMode,
    budget: config.cost.maxEpisodeBudgetUsd,
    concurrency: config.concurrency,
    retry: config.retry,
    catalog: PROVIDER_CATALOG,
    resolved: Object.fromEntries(kinds.map((k) => [k, { preview: resolveProvider(k, "preview", { ignoreMock: true }), final: resolveProvider(k, "final", { ignoreMock: true }) }])) as SettingsData["resolved"],
    defaultPricing: DEFAULT_PRICING,
    credentials: credentialStatus(),
    ffmpeg: await checkFfmpeg(),
    cache: cacheStats(),
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-stone-50">Providers & Costs</h1>
        <p className="mt-1 text-sm text-stone-400">
          API keys live in <code className="text-stone-300">.env</code> (never shown here). Prices are editable estimates — check each provider&apos;s pricing page.
        </p>
      </header>
      <SettingsView initial={data} />
    </div>
  );
}
