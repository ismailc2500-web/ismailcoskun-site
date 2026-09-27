import { z } from "zod";
import { handle, body } from "@/lib/api";
import { config } from "@/lib/config";
import { DEFAULT_PRICING } from "@/lib/ai/pricing";
import { credentialStatus, mockModeState, PROVIDER_CATALOG, resolveProvider } from "@/lib/ai/registry";
import { cacheStats, clearCache } from "@/lib/db/repos/assets";
import { deleteProviderSetting, saveProviderSetting, setAppSetting } from "@/lib/db/repos/settings";
import { checkFfmpeg } from "@/lib/video/ffmpeg";
import type { ProviderKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: ProviderKind[] = ["llm", "image", "video", "tts"];

export async function GET() {
  return handle(async () => ({
    mock: mockModeState(),
    envMockMode: config.mockMode,
    budget: config.cost.maxEpisodeBudgetUsd,
    concurrency: config.concurrency,
    retry: config.retry,
    catalog: PROVIDER_CATALOG,
    resolved: Object.fromEntries(KINDS.map((k) => [k, { preview: resolveProvider(k, "preview", { ignoreMock: true }), final: resolveProvider(k, "final", { ignoreMock: true }) }])),
    defaultPricing: DEFAULT_PRICING,
    credentials: credentialStatus(),
    ffmpeg: await checkFfmpeg(),
    cache: cacheStats(),
  }));
}

const ProviderPut = z.object({
  kind: z.enum(["llm", "image", "video", "tts"]),
  mode: z.enum(["preview", "final"]),
  provider: z.string().min(1),
  model: z.string().default(""),
  quality: z.string().default(""),
  pricing: z.record(z.string(), z.coerce.number()).default({}),
});

/** PUT { forceMock: boolean } or a provider setting; { kind, mode, reset: true } restores the env default. */
export async function PUT(req: Request) {
  return handle(async () => {
    const input = (await body(req)) as Record<string, unknown>;
    if (typeof input.forceMock === "boolean") {
      setAppSetting("force_mock", input.forceMock);
      return { mock: mockModeState() };
    }
    if (input.reset) {
      const { kind, mode } = ProviderPut.pick({ kind: true, mode: true }).parse(input);
      deleteProviderSetting(kind, mode);
      return resolveProvider(kind, mode, { ignoreMock: true });
    }
    const s = ProviderPut.parse(input);
    if (!PROVIDER_CATALOG[s.kind].some((e) => e.id === s.provider)) throw new Error(`Unknown ${s.kind} provider "${s.provider}"`);
    saveProviderSetting(s);
    return resolveProvider(s.kind, s.mode, { ignoreMock: true });
  });
}

/** DELETE ?kind=clip — clears the generation cache (all kinds when omitted). */
export async function DELETE(req: Request) {
  return handle(async () => ({ removed: clearCache(new URL(req.url).searchParams.get("kind") ?? undefined) }));
}
