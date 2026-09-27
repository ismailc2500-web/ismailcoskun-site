import { handle, body, intParam } from "@/lib/api";
import { removeEpisode, updateEpisodeInput } from "@/lib/services";
import { episodeView } from "@/lib/views";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ episodeId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => episodeView(intParam((await params).episodeId)));
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => updateEpisodeInput(intParam((await params).episodeId), await body(req)));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    removeEpisode(intParam((await params).episodeId));
    return { ok: true };
  });
}
