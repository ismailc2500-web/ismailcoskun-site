import { notFound } from "next/navigation";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { episodeView } from "@/lib/views";
import { EpisodeShell } from "@/components/episode/EpisodeShell";
import { RenderView } from "@/components/episode/RenderView";

export const dynamic = "force-dynamic";

export default async function RenderPage({ params }: { params: Promise<{ id: string }> }) {
  ensureBootstrapped();
  let view;
  try {
    view = episodeView(Number((await params).id));
  } catch {
    notFound();
  }
  return (
    <EpisodeShell initial={view} tab="/render">
      <RenderView />
    </EpisodeShell>
  );
}
