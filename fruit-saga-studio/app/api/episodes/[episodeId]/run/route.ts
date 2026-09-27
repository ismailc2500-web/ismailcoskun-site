import { z } from "zod";
import { handle, body, intParam } from "@/lib/api";
import { PIPELINE_ACTIONS, STAGES, type Stage } from "@/lib/types";
import { cancelRun, startPipeline } from "@/lib/pipeline/runner";
import { requireEpisode } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string }> };

const RunSchema = z.object({
  action: z.enum(Object.keys(PIPELINE_ACTIONS) as [keyof typeof PIPELINE_ACTIONS, ...(keyof typeof PIPELINE_ACTIONS)[]]).optional(),
  stages: z.array(z.enum(STAGES)).optional(),
  mode: z.enum(["preview", "final"]).optional(),
  force: z.boolean().optional(),
  sceneIds: z.array(z.string()).optional(),
  confirmBudget: z.boolean().optional(),
});

/** Starts a pipeline run in the background. 402 = estimate above budget (resend with confirmBudget). */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    requireEpisode(episodeId);
    const input = RunSchema.parse(await body(req));
    const stages: Stage[] = input.stages?.length ? input.stages : [...PIPELINE_ACTIONS[input.action ?? "generate"]];
    return startPipeline(episodeId, stages, input);
  });
}

/** Cancels the active run after the current step finishes. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => ({ cancelled: cancelRun(intParam((await params).episodeId)) }));
}
