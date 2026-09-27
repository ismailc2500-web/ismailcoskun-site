import { handle, body } from "@/lib/api";
import { listCharacters } from "@/lib/db/repos/series";
import { requireSeries, saveCharacterInput } from "@/lib/services";
import { characterBlock } from "@/lib/prompts/engine";
import type { CharacterInput } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string }> };

/** Characters plus the exact consistency block each one injects into prompts. */
export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId } = await params;
    requireSeries(seriesId);
    return listCharacters(seriesId).map((c) => ({ ...c, prompt_block: characterBlock(c) }));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => saveCharacterInput((await params).seriesId, (await body(req)) as CharacterInput, { create: true }));
}
