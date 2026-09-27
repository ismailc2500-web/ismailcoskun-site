import { activeSeriesId } from "@/lib/active";
import { getSeries } from "@/lib/db/repos/series";
import { listEpisodes, nextEpisodeNumber } from "@/lib/db/repos/episodes";
import { NewEpisodeForm } from "@/components/NewEpisodeForm";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewEpisodePage() {
  const seriesId = await activeSeriesId();
  const series = seriesId ? getSeries(seriesId) : null;
  if (!series) return <Empty title="Create a series first" />;
  const previous = listEpisodes(series.id).pop();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-400">{series.title}</div>
        <h1 className="mt-1 text-3xl font-bold text-stone-50">New Episode</h1>
      </header>
      <NewEpisodeForm seriesId={series.id} nextNumber={nextEpisodeNumber(series.id)} previousTease={previous?.next_episode_tease || null} />
    </div>
  );
}
