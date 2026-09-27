import { cookies } from "next/headers";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { listSeries } from "@/lib/db/repos/series";

/** The series selected in the sidebar (cookie), falling back to the first one. */
export async function activeSeriesId(): Promise<string | null> {
  ensureBootstrapped();
  const all = listSeries();
  const chosen = (await cookies()).get("fss_series")?.value;
  return all.find((s) => s.id === chosen)?.id ?? all[0]?.id ?? null;
}
