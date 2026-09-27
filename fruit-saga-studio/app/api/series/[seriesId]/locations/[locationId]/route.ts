import { handle, body } from "@/lib/api";
import { removeLocation, saveLocationInput } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string; locationId: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId, locationId } = await params;
    return saveLocationInput(seriesId, { ...((await body(req)) as object), id: locationId });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId, locationId } = await params;
    removeLocation(seriesId, locationId);
    return { ok: true };
  });
}
