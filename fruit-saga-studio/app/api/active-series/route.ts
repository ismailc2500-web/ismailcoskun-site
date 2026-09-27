import { cookies } from "next/headers";
import { handle, body } from "@/lib/api";
import { requireSeries } from "@/lib/services";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const { seriesId } = z.object({ seriesId: z.string() }).parse(await body(req));
    requireSeries(seriesId);
    (await cookies()).set("fss_series", seriesId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return { ok: true, seriesId };
  });
}
