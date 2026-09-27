import { z } from "zod";
import { handle, body, intParam } from "@/lib/api";
import { listScenes, reorderScenes } from "@/lib/db/repos/episodes";
import { exportEpisode } from "@/lib/data-sync";
import { addScene, requireEpisode } from "@/lib/services";
import type { SceneInput } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    requireEpisode(episodeId);
    return listScenes(episodeId);
  });
}

/** Adds a scene (optionally with initial fields). */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => addScene(intParam((await params).episodeId), (await body(req)) as SceneInput));
}

/** PUT { order: ["s02","s01",...] } — reorders scenes. */
export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    requireEpisode(episodeId);
    const { order } = z.object({ order: z.array(z.string()) }).parse(await body(req));
    reorderScenes(episodeId, order);
    exportEpisode(episodeId);
    return listScenes(episodeId);
  });
}
