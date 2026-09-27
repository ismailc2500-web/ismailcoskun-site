import { handle, intParam } from "@/lib/api";
import { PIPELINE_ACTIONS, type PipelineAction } from "@/lib/types";
import { estimateEpisode } from "@/lib/pipeline/estimate";
import { requireEpisode } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string }> };

/** GET ?mode=preview|final&action=render — cost estimate per scene and per episode. */
export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    const episode = requireEpisode(episodeId);
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "final" ? "final" : url.searchParams.get("mode") === "preview" ? "preview" : episode.mode;
    const action = (url.searchParams.get("action") ?? "render") as PipelineAction;
    return estimateEpisode(episodeId, mode, PIPELINE_ACTIONS[action] ?? PIPELINE_ACTIONS.render);
  });
}
