import fs from "node:fs";
import { config, paths } from "@/lib/config";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { listSeries } from "@/lib/db/repos/series";
import { credentialStatus, mockModeState, resolveProvider } from "@/lib/ai/registry";
import { checkFfmpeg } from "@/lib/video/ffmpeg";
import type { ProviderKind } from "@/lib/types";

/** npm run check — verifies FFmpeg, storage, database and provider configuration. */
async function main() {
  const ok = (b: boolean) => (b ? "✓" : "✗");
  console.log("Fruit Saga Studio — environment check\n");
  console.log(`Node ${process.version}`);

  const ff = await checkFfmpeg();
  console.log(`${ok(ff.ok)} FFmpeg: ${ff.version ?? ff.error ?? "not found"}${ff.missingFilters.length ? ` (missing filters: ${ff.missingFilters.join(", ")})` : ""}`);

  for (const [name, dir] of [["data", paths.data], ["output", paths.output], ["cache", paths.cache]] as const) {
    fs.mkdirSync(dir, { recursive: true });
    let writable = true;
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      writable = false;
    }
    console.log(`${ok(writable)} ${name} dir: ${dir}`);
  }

  ensureBootstrapped();
  console.log(`✓ database: ${paths.db} (${listSeries().length} series)`);

  const mock = mockModeState();
  console.log(`\nMock mode: ${mock.active ? `ON (${mock.source}) — no paid API will be called` : "OFF — real providers"}`);
  console.log(`Budget guard: $${config.cost.maxEpisodeBudgetUsd} per run\n`);
  console.log("Providers (preview → final):");
  for (const kind of ["llm", "image", "video", "tts"] as ProviderKind[]) {
    const p = resolveProvider(kind, "preview", { ignoreMock: true });
    const f = resolveProvider(kind, "final", { ignoreMock: true });
    console.log(`  ${kind.padEnd(6)} ${p.provider}${p.model ? `/${p.model}` : ""} → ${f.provider}${f.model ? `/${f.model}` : ""}`);
  }
  console.log("\nAPI keys present:");
  for (const [k, v] of Object.entries(credentialStatus())) console.log(`  ${ok(v)} ${k}`);
  if (!ff.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
