import { handle } from "@/lib/api";
import { seriesPerformance } from "@/lib/db/repos/settings";
import { requireSeries } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string }> };

/** Performance per episode (latest capture per platform), joined with hooks, cast and duration. */
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId } = await params;
    requireSeries(seriesId);
    return seriesPerformance(seriesId);
  });
}
