import { z } from "zod";
import { handle, body, intParam } from "@/lib/api";
import { requireEpisode, reseedScene } from "@/lib/services";
import { startPipeline } from "@/lib/pipeline/runner";
import type { Stage } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string; sceneId: string }> };

const Schema = z.object({
  what: z.enum(["keyframe", "clip", "voice"]),
  mode: z.enum(["preview", "final"]).optional(),
  /** true = new variation (new seed); false = re-run the identical request (e.g. after a failure). */
  newVariation: z.boolean().default(true),
  confirmBudget: z.boolean().optional(),
});

/**
 * Regenerates one scene's asset without touching the rest of the episode.
 *   keyframe → new keyframe + its clip   clip → only the clip   voice → that scene's lines (+ timeline)
 */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { episodeId: raw, sceneId } = await params;
    const episodeId = intParam(raw);
    const episode = requireEpisode(episodeId);
    const input = Schema.parse(await body(req));
    const stages: Stage[] =
      input.what === "keyframe" ? ["keyframes", "clips"] : input.what === "clip" ? ["clips"] : ["narration", "sound", "subtitles"];
    if (input.what === "keyframe" && input.newVariation) reseedScene(episodeId, sceneId);
    return startPipeline(episodeId, stages, {
      mode: input.mode ?? episode.mode,
      sceneIds: [sceneId],
      force: input.what !== "keyframe" && input.newVariation,
      confirmBudget: input.confirmBudget,
    });
  });
}
