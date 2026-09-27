import { activeSeriesId } from "@/lib/active";
import { getLatestState, getSeries, listCharacters, listLocations, listSnapshots } from "@/lib/db/repos/series";
import { WorldView } from "@/components/WorldView";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function WorldPage() {
  const seriesId = await activeSeriesId();
  const series = seriesId ? getSeries(seriesId) : null;
  if (!series) return <Empty title="Create a series first" />;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-400">{series.title}</div>
        <h1 className="mt-1 text-3xl font-bold text-stone-50">World & Continuity</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-400">
          Locations plus the series state (<code className="text-stone-300">series_state.json</code>): where everyone is, what they carry, injuries,
          relationships, the villain and open threads.
        </p>
      </header>
      <WorldView
        seriesId={series.id}
        locations={listLocations(series.id)}
        state={getLatestState(series.id)}
        snapshots={listSnapshots(series.id)}
        characters={listCharacters(series.id)}
      />
    </div>
  );
}
