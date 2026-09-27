import { handle, body } from "@/lib/api";
import { createEpisodeInput } from "@/lib/services";
import { seriesOverview } from "@/lib/views";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => seriesOverview((await params).seriesId).episodes);
}

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => createEpisodeInput((await params).seriesId, await body(req)));
}
