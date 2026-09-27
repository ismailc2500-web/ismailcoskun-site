import { handle, body } from "@/lib/api";
import { getLatestState, listSnapshots } from "@/lib/db/repos/series";
import { requireSeries, saveSeriesState } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string }> };

/** Latest continuity state + the per-episode history of snapshots. */
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId } = await params;
    requireSeries(seriesId);
    return { latest: getLatestState(seriesId), snapshots: listSnapshots(seriesId) };
  });
}

/** Manually edit the latest snapshot. */
export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => saveSeriesState((await params).seriesId, await body(req)));
}
