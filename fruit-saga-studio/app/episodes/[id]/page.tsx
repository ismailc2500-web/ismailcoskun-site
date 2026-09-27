import { notFound } from "next/navigation";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { episodeView } from "@/lib/views";
import { EpisodeShell } from "@/components/episode/EpisodeShell";
import { Overview } from "@/components/episode/Overview";

export const dynamic = "force-dynamic";

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  ensureBootstrapped();
  const id = Number((await params).id);
  let view;
  try {
    view = episodeView(id);
  } catch {
    notFound();
  }
  return (
    <EpisodeShell initial={view} tab="">
      <Overview />
    </EpisodeShell>
  );
}
