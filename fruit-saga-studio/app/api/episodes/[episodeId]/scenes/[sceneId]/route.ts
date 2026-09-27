import { handle, body, intParam } from "@/lib/api";
import { removeScene, updateSceneInput } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string; sceneId: string }> };

/** Edit any scene field. Hand-edited prompts become locked against regeneration. */
export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { episodeId, sceneId } = await params;
    return updateSceneInput(intParam(episodeId), sceneId, await body(req));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { episodeId, sceneId } = await params;
    removeScene(intParam(episodeId), sceneId);
    return { ok: true };
  });
}
