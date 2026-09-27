import { handle } from "@/lib/api";
import { addReferenceImage, HttpError, removeReferenceImage } from "@/lib/services";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ seriesId: string; characterId: string }> };

/** Upload a reference image (multipart field "file"). */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId, characterId } = await params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, 'Send the image as multipart form field "file"');
    return addReferenceImage(seriesId, characterId, file);
  });
}

/** DELETE ?path=data/series/<id>/references/<char>/<file> */
export async function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { seriesId, characterId } = await params;
    const rel = new URL(req.url).searchParams.get("path");
    if (!rel) throw new HttpError(400, "Missing ?path=");
    return removeReferenceImage(seriesId, characterId, rel);
  });
}
