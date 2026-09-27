import { notFound } from "next/navigation";
import { ensureBootstrapped } from "@/lib/bootstrap";
import { episodeView } from "@/lib/views";
import { EpisodeShell } from "@/components/episode/EpisodeShell";
import { SceneEditor } from "@/components/episode/SceneEditor";

export const dynamic = "force-dynamic";

export default async function ScenesPage({ params }: { params: Promise<{ id: string }> }) {
  ensureBootstrapped();
  let view;
  try {
    view = episodeView(Number((await params).id));
  } catch {
    notFound();
  }
  return (
    <EpisodeShell initial={view} tab="/scenes">
      <SceneEditor />
    </EpisodeShell>
  );
}
