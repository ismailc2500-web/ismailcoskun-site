import { handle, body } from "@/lib/api";
import { getCharacter } from "@/lib/db/repos/series";
import { HttpError, removeCharacter, saveCharacterInput } from "@/lib/services";
import { characterBlock } from "@/lib/prompts/engine";
import type { CharacterInput } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string; characterId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId, characterId } = await params;
    const c = getCharacter(seriesId, characterId);
    if (!c) throw new HttpError(404, "Character not found");
    return { ...c, prompt_block: characterBlock(c) };
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId, characterId } = await params;
    const input = (await body(req)) as CharacterInput;
    const saved = saveCharacterInput(seriesId, { ...input, id: characterId });
    return { ...saved, prompt_block: characterBlock(saved) };
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId, characterId } = await params;
    removeCharacter(seriesId, characterId);
    return { ok: true };
  });
}
