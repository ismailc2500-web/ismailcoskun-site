import { handle, body } from "@/lib/api";
import { deleteSeries } from "@/lib/db/repos/series";
import { updateSeries, requireSeries } from "@/lib/services";
import { seriesOverview } from "@/lib/views";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => seriesOverview((await params).seriesId));
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => updateSeries((await params).seriesId, await body(req)));
}

/** Removes the series from the database. Its JSON mirror and renders stay on disk. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId } = await params;
    requireSeries(seriesId);
    deleteSeries(seriesId);
    return { ok: true };
  });
}
