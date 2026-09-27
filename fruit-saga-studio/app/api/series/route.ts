import { handle, body } from "@/lib/api";
import { listSeries } from "@/lib/db/repos/series";
import { listEpisodes } from "@/lib/db/repos/episodes";
import { listCharacters } from "@/lib/db/repos/series";
import { createSeries } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() =>
    listSeries().map((s) => ({ ...s, episodes: listEpisodes(s.id).length, characters: listCharacters(s.id).length })),
  );
}

export async function POST(req: Request) {
  return handle(async () => createSeries(await body(req)));
}
