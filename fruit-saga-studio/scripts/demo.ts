import { ensureBootstrapped } from "@/lib/bootstrap";
import { config } from "@/lib/config";
import { createEpisode, getEpisode, getEpisodeByNumber, nextEpisodeNumber } from "@/lib/db/repos/episodes";
import { listSeries } from "@/lib/db/repos/series";
import { getCurrentAsset } from "@/lib/db/repos/assets";
import { exportEpisode } from "@/lib/data-sync";
import { PIPELINE_ACTIONS } from "@/lib/types";
import { runPipeline } from "@/lib/pipeline/runner";
import { estimateEpisode } from "@/lib/pipeline/estimate";
import { mockModeState } from "@/lib/ai/registry";
import { checkFfmpeg } from "@/lib/video/ffmpeg";
import { arg, modeArg, printRun } from "./cli";

/**
 * End-to-end demo (no API credits needed in mock mode):
 *   1. renders the pre-written demo Episode 1
 *   2. commits it to the series continuity
 *   3. writes Episode 2 from a one-line synopsis and renders it
 *
 *   npm run demo                 # preview quality (540x960), fast
 *   npm run demo -- --mode final # 1080x1920 + 1920x1080, two-pass loudness
 *   npm run demo -- --skip-new   # only episode 1
 */
async function main() {
  const ff = await checkFfmpeg();
  if (!ff.ok) {
    console.error(`FFmpeg check failed: ${ff.error ?? `missing filters: ${ff.missingFilters.join(", ")}`}. See README → FFmpeg.`);
    process.exit(1);
  }
  ensureBootstrapped();
  const mode = modeArg("preview");
  const mock = mockModeState();
  console.log(`Fruit Saga Studio demo — mode: ${mode}, mock mode: ${mock.active ? "ON" : "OFF"}, ${ff.version}`);
  if (!mock.active) console.log("⚠ Mock mode is OFF: real providers will be called and may cost money.");

  const series = listSeries()[0];
  if (!series) throw new Error("No series found — run npm run db:reset");
  const ep1 = getEpisodeByNumber(series.id, 1);
  if (!ep1) throw new Error("Demo episode 1 not found — run npm run db:reset -- --demo");

  const est = estimateEpisode(ep1.id, mode, PIPELINE_ACTIONS.render);
  console.log(`Estimated cost for rendering EP1: $${est.total.toFixed(4)} (budget $${config.cost.maxEpisodeBudgetUsd})`);

  let t = Date.now();
  const r1 = await runPipeline(ep1.id, [...PIPELINE_ACTIONS.prompts, ...PIPELINE_ACTIONS.render], { mode, confirmBudget: mock.active });
  printRun(`EP${ep1.episode_number} "${ep1.title}"`, ep1.id, r1, t);
  report(ep1.id, mode);
  if (r1.status === "failed") process.exit(1);

  if (arg("skip-new")) return;

  t = Date.now();
  const rc = await runPipeline(ep1.id, ["continuity"], { mode, confirmBudget: mock.active });
  printRun("Continuity after EP1", ep1.id, rc, t);

  const n = nextEpisodeNumber(series.id);
  const synopsis =
    arg("synopsis") ??
    `Episode ${n}: The travellers slip into the Whisperwood to hide from the watchers on the road, but something in the fog has already caught the scent of the Everseed.`;
  const ep2 = createEpisode(series.id, {
    episode_number: n,
    synopsis,
    tone: "epic-comedic",
    target_duration: 60,
    platform: "youtube_shorts",
    mode,
  });
  exportEpisode(ep2.id);
  console.log(`\nCreated EP${n} from synopsis:\n  "${synopsis}"`);
  t = Date.now();
  const r2 = await runPipeline(ep2.id, PIPELINE_ACTIONS.all, { mode, confirmBudget: mock.active });
  const fresh = getEpisode(ep2.id)!;
  printRun(`EP${n} "${fresh.title}"`, ep2.id, r2, t);
  console.log(`\n  Hook: ${fresh.hook}\n  Cliffhanger: ${fresh.cliffhanger}\n  Next: ${fresh.next_episode_tease}`);
  report(ep2.id, mode);
  if (r2.status === "failed") process.exit(1);
}

function report(episodeId: number, mode: "preview" | "final") {
  const v = getCurrentAsset(episodeId, "render_vertical", mode);
  const l = getCurrentAsset(episodeId, "render_landscape", mode);
  const mix = getCurrentAsset(episodeId, "mix", mode);
  if (v) console.log(`  → ${v.path}  (${v.duration?.toFixed(2)}s)`);
  if (l) console.log(`  → ${l.path}`);
  if (mix) console.log(`  loudness: ${mix.meta.integratedLufs} LUFS integrated, true peak ${mix.meta.truePeakDb} dBTP`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
