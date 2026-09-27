import type { RenderMode } from "@/lib/config";
import { listJobs } from "@/lib/db/repos/jobs";
import type { RunSummary } from "@/lib/pipeline/runner";

/** Small helpers shared by the CLI scripts. */

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

export function modeArg(fallback: RenderMode = "preview"): RenderMode {
  const m = arg("mode");
  return m === "final" ? "final" : m === "preview" ? "preview" : fallback;
}

export function printRun(title: string, episodeId: number, summary: RunSummary, startedMs: number) {
  const jobs = listJobs(episodeId, { runId: summary.runId }).reverse();
  console.log(`\n${title} — ${summary.status.toUpperCase()} in ${((Date.now() - startedMs) / 1000).toFixed(1)}s, cost $${summary.cost.toFixed(4)}`);
  for (const j of jobs) {
    const icon = j.status === "failed" ? "✗" : j.status === "cached" ? "≡" : j.status === "skipped" ? "–" : "✓";
    console.log(`  ${icon} [${j.stage.padEnd(10)}] ${j.label}${j.status === "cached" ? " (cache)" : ""}${j.error && j.status === "failed" ? `\n      ${j.error}` : ""}`);
  }
  for (const e of summary.errors) console.log(`  ! ${e}`);
}
