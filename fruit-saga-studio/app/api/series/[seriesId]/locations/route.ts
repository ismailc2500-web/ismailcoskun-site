import { handle, body } from "@/lib/api";
import { listLocations } from "@/lib/db/repos/series";
import { requireSeries, saveLocationInput } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId } = await params;
    requireSeries(seriesId);
    return listLocations(seriesId);
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => saveLocationInput((await params).seriesId, await body(req), { create: true }));
}
