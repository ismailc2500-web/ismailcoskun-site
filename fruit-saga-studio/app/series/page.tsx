import { activeSeriesId } from "@/lib/active";
import { listCharacters, listSeries } from "@/lib/db/repos/series";
import { listEpisodes } from "@/lib/db/repos/episodes";
import { SeriesManager } from "@/components/SeriesManager";

export const dynamic = "force-dynamic";

export default async function SeriesPage() {
  const active = await activeSeriesId();
  const series = listSeries().map((s) => ({ ...s, episodes: listEpisodes(s.id).length, characters: listCharacters(s.id).length }));
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-stone-50">Series</h1>
        <p className="mt-1 text-sm text-stone-400">Each series has its own character bible, world, continuity and episodes (mirrored to data/series/&lt;id&gt;/).</p>
      </header>
      <SeriesManager series={series} active={active} />
    </div>
  );
}
