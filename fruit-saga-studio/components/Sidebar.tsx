import Link from "next/link";
import { listSeries } from "@/lib/db/repos/series";
import { listEpisodes } from "@/lib/db/repos/episodes";
import { mockModeState } from "@/lib/ai/registry";
import { epCode } from "@/lib/format";
import { SeriesSwitcher } from "@/components/SeriesSwitcher";
import { Badge } from "@/components/ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/episodes/new", label: "New Episode", icon: "✚" },
  { href: "/characters", label: "Characters", icon: "☺" },
  { href: "/world", label: "World & Continuity", icon: "◎" },
  { href: "/series", label: "Series", icon: "❖" },
  { href: "/settings", label: "Providers & Costs", icon: "⚙" },
];

export function Sidebar({ activeSeries }: { activeSeries: string | null }) {
  const series = listSeries();
  const episodes = activeSeries ? listEpisodes(activeSeries) : [];
  const mock = mockModeState();
  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-b border-ink-700 bg-ink-900/60 p-4 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
      <Link href="/" className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-red-500 via-gold-400 to-lime-400 text-lg shadow-lg">🍎</span>
        <span>
          <span className="block text-sm font-bold tracking-wide text-stone-100">Fruit Saga Studio</span>
          <span className="block text-[11px] text-stone-500">serialized shorts pipeline</span>
        </span>
      </Link>
      <div>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-500">Series</div>
        <SeriesSwitcher series={series.map((s) => ({ id: s.id, title: s.title }))} active={activeSeries} />
      </div>
      <nav className="flex flex-wrap gap-1 lg:flex-col">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-stone-300 hover:bg-ink-800 hover:text-white">
            <span className="w-4 text-center text-stone-500">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      {episodes.length > 0 && (
        <div className="hidden min-h-0 flex-1 flex-col lg:flex">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-stone-500">Episodes</div>
          <div className="min-h-0 space-y-0.5 overflow-y-auto">
            {episodes.map((e) => (
              <Link key={e.id} href={`/episodes/${e.id}`} className="block truncate rounded-md px-2.5 py-1 text-sm text-stone-400 hover:bg-ink-800 hover:text-white">
                <span className="mr-1.5 font-mono text-xs text-gold-400">{epCode(e.episode_number)}</span>
                {e.title || "Untitled"}
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="mt-auto hidden space-y-2 lg:block">
        {mock.active ? (
          <Link href="/settings" className="block">
            <Badge tone="gold">Mock mode · no paid APIs</Badge>
          </Link>
        ) : (
          <Link href="/settings" className="block">
            <Badge tone="red">Live providers · costs apply</Badge>
          </Link>
        )}
      </div>
    </aside>
  );
}
