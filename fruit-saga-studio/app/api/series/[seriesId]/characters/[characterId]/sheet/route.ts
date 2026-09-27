import { handle, body } from "@/lib/api";
import { generateCharacterSheet } from "@/lib/services";
import { z } from "zod";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string; characterId: string }> };

/** Generates a character reference sheet (costs one image in non-mock mode) and attaches it. */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId, characterId } = await params;
    const { mode } = z.object({ mode: z.enum(["preview", "final"]).default("preview") }).parse(await body(req));
    return generateCharacterSheet(seriesId, characterId, mode);
  });
}
