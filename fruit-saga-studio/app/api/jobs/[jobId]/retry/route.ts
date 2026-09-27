import { z } from "zod";
import { handle, body, intParam } from "@/lib/api";
import { retryJob } from "@/lib/pipeline/runner";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ jobId: string }> };

/** Re-runs exactly the unit this job represented (one keyframe, one clip, one voice scene…). */
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { confirmBudget } = z.object({ confirmBudget: z.boolean().optional() }).parse(await body(req));
    return retryJob(intParam((await params).jobId), { confirmBudget });
  });
}
