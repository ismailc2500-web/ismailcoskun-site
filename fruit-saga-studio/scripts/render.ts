import { ensureBootstrapped } from "@/lib/bootstrap";
import { getEpisodeByNumber } from "@/lib/db/repos/episodes";
import { listSeries } from "@/lib/db/repos/series";
import { getCurrentAsset } from "@/lib/db/repos/assets";
import { PIPELINE_ACTIONS, STAGES, type PipelineAction, type Stage } from "@/lib/types";
import { runPipeline } from "@/lib/pipeline/runner";
import { estimateEpisode } from "@/lib/pipeline/estimate";
import { mockModeState } from "@/lib/ai/registry";
import { arg, modeArg, printRun } from "./cli";

/**
 * Run any part of the pipeline from the terminal.
 *
 *   npm run render -- --episode 2                       # render (assets + mix + assembly), preview
 *   npm run render -- --episode 2 --mode final --yes    # final quality, skip budget prompt
 *   npm run render -- --episode 2 --action generate     # script → subtitles (no images/video)
 *   npm run render -- --episode 2 --stages keyframes,clips --scenes s03,s04 --force
 *   npm run render -- --series my-series --episode 1 --estimate
 */
async function main() {
  ensureBootstrapped();
  const seriesId = arg("series") ?? listSeries()[0]?.id;
  const number = Number(arg("episode") ?? 1);
  const episode = seriesId ? getEpisodeByNumber(seriesId, number) : null;
  if (!episode) throw new Error(`Episode ${number} not found in series ${seriesId}`);
  const mode = modeArg(episode.mode);
  const action = (arg("action") ?? "render") as PipelineAction;
  const stages: Stage[] = arg("stages")
    ? (arg("stages")!.split(",").map((s) => s.trim()) as Stage[]).filter((s) => STAGES.includes(s))
    : [...(PIPELINE_ACTIONS[action] ?? PIPELINE_ACTIONS.render)];
  const est = estimateEpisode(episode.id, mode, stages);
  console.log(`EP${episode.episode_number} "${episode.title}" — ${mode} — stages: ${stages.join(", ")}`);
  console.log(`Estimated cost: $${est.total.toFixed(4)} (without cache: $${est.fullPrice.toFixed(4)})`);
  for (const s of est.scenes) console.log(`  ${s.scene_id}: $${s.total.toFixed(4)}`);
  if (arg("estimate")) return;
  const t = Date.now();
  const summary = await runPipeline(episode.id, stages, {
    mode,
    force: Boolean(arg("force")),
    sceneIds: arg("scenes")?.split(","),
    confirmBudget: Boolean(arg("yes")) || mockModeState().active,
  });
  printRun(`EP${episode.episode_number}`, episode.id, summary, t);
  for (const kind of ["render_vertical", "render_landscape"] as const) {
    const a = getCurrentAsset(episode.id, kind, mode);
    if (a) console.log(`  → ${a.path}`);
  }
  if (summary.status === "failed") process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
