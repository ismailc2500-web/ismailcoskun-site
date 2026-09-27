import { handle, body, intParam } from "@/lib/api";
import { failedUnits, latestJobsPerUnit, listJobs } from "@/lib/db/repos/jobs";
import { activeRun, startPipeline } from "@/lib/pipeline/runner";
import { HttpError, requireEpisode } from "@/lib/services";
import { STAGES, type Stage } from "@/lib/types";
import { z } from "zod";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    requireEpisode(episodeId);
    const runId = new URL(req.url).searchParams.get("run") ?? undefined;
    return { run: activeRun(episodeId), units: latestJobsPerUnit(episodeId), jobs: listJobs(episodeId, { runId, limit: 300 }) };
  });
}

/** POST { retryFailed: true } — re-runs only the failed units (each scene asset individually). */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    const episode = requireEpisode(episodeId);
    const { mode, confirmBudget } = z
      .object({ retryFailed: z.literal(true), mode: z.enum(["preview", "final"]).optional(), confirmBudget: z.boolean().optional() })
      .parse(await body(req));
    const failed = failedUnits(episodeId);
    if (!failed.length) throw new HttpError(400, "Nothing to retry — no failed jobs.");
    const stages = STAGES.filter((s) => failed.some((f) => f.stage === s)) as Stage[];
    const sceneIds = failed.every((f) => f.scene_id) ? [...new Set(failed.map((f) => f.scene_id!))] : undefined;
    return { ...startPipeline(episodeId, stages, { mode: mode ?? episode.mode, sceneIds, confirmBudget }), stages, sceneIds };
  });
}
