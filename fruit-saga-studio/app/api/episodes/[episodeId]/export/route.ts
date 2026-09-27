import { z } from "zod";
import { handle, body, intParam } from "@/lib/api";
import { PLATFORMS } from "@/lib/types";
import { listScenes } from "@/lib/db/repos/episodes";
import { exportPlatforms, writeMetadataFiles } from "@/lib/pipeline/export";
import { episodePaths } from "@/lib/pipeline/paths";
import { getSeries } from "@/lib/db/repos/series";
import { toRelative } from "@/lib/db/repos/assets";
import { requireEpisode } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string }> };

/** Copies the rendered videos + captions + thumbnails into exports/<platform>/ for upload. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    const episode = requireEpisode(episodeId);
    const input = z
      .object({ platforms: z.array(z.enum(PLATFORMS)).min(1), mode: z.enum(["preview", "final"]).optional() })
      .parse(await body(req));
    const mode = input.mode ?? episode.mode;
    writeMetadataFiles(episode, getSeries(episode.series_id)!, episodePaths(episode.series_id, episode.episode_number, mode));
    const results = exportPlatforms(episode, listScenes(episodeId), input.platforms, mode);
    return results.map((r) => ({
      platform: r.platform,
      video: `/api/files/${toRelative(r.video)}`,
      caption: `/api/files/${toRelative(r.caption)}`,
      thumbnail: r.thumbnail ? `/api/files/${toRelative(r.thumbnail)}` : null,
      folder: toRelative(r.video).split("/").slice(0, -1).join("/"),
    }));
  });
}
