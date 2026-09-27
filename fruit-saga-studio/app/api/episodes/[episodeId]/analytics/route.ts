import { z } from "zod";
import { handle, body, intParam } from "@/lib/api";
import { addAnalytics, listAnalytics } from "@/lib/db/repos/settings";
import { requireEpisode } from "@/lib/services";
import { PLATFORMS } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string }> };

const num = z.coerce.number().min(0).default(0);
const AnalyticsSchema = z.object({
  platform: z.enum(PLATFORMS),
  views: num,
  likes: num,
  comments: num,
  shares: num,
  saves: num,
  avg_watch_seconds: num,
  completion_rate: z.coerce.number().min(0).max(100).default(0),
  ctr: z.coerce.number().min(0).max(100).default(0),
  followers_gained: num,
  retention: z.array(z.coerce.number()).default([]),
  notes: z.string().default(""),
});

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    requireEpisode(episodeId);
    return listAnalytics(episodeId);
  });
}

/** Log a performance snapshot (views, retention, CTR…) for later analysis. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const episodeId = intParam((await params).episodeId);
    requireEpisode(episodeId);
    const input = AnalyticsSchema.parse(await body(req));
    return addAnalytics({ ...input, episode_id: episodeId });
  });
}
