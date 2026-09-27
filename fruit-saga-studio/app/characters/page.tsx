import { activeSeriesId } from "@/lib/active";
import { getSeries, listCharacters } from "@/lib/db/repos/series";
import { characterBlock } from "@/lib/prompts/engine";
import { config } from "@/lib/config";
import { CharacterBible } from "@/components/CharacterBible";
import { Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CharactersPage() {
  const seriesId = await activeSeriesId();
  const series = seriesId ? getSeries(seriesId) : null;
  if (!series) return <Empty title="Create a series first" />;
  const characters = listCharacters(series.id).map((c) => ({ ...c, prompt_block: characterBlock(c) }));
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-400">{series.title}</div>
        <h1 className="mt-1 text-3xl font-bold text-stone-50">Character bible</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-400">
          The single source of truth for how every fruit-headed character looks and sounds. Saved to{" "}
          <code className="text-stone-300">data/series/{series.id}/characters.json</code>.
        </p>
      </header>
      <CharacterBible seriesId={series.id} initial={characters} mode={config.defaultMode} />
    </div>
  );
}
