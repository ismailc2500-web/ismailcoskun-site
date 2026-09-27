import Link from "next/link";
import { activeSeriesId } from "@/lib/active";
import { seriesOverview } from "@/lib/views";
import { seriesPerformance } from "@/lib/db/repos/settings";
import { mockModeState } from "@/lib/ai/registry";
import { epCode, money, secs } from "@/lib/format";
import { Badge, Card, Empty, Notice, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const seriesId = await activeSeriesId();
  if (!seriesId) {
    return (
      <Empty title="No series yet">
        <Link className="text-gold-300 underline" href="/series">
          Create your first series
        </Link>
      </Empty>
    );
  }
  const { series, episodes, characters, state } = seriesOverview(seriesId);
  const performance = seriesPerformance(seriesId);
  const rendered = episodes.filter((e) => e.renderVertical).length;
  const spend = episodes.reduce((s, e) => s + e.spend, 0);
  const mock = mockModeState();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-gold-400">Series dashboard</div>
          <h1 className="mt-1 text-3xl font-bold text-stone-50">{series.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-stone-400">{series.logline}</p>
        </div>
        <Link href="/episodes/new" className="rounded-lg bg-gold-400 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-300">
          ✚ New Episode
        </Link>
      </header>

      {mock.active && (
        <Notice>
          <b>Mock mode is on.</b> Scripts, prompts, placeholder art, animatic video, a placeholder voice, procedural music/SFX and full
          renders all work offline — no API credits are used. Configure providers in{" "}
          <Link href="/settings" className="underline">
            Providers &amp; Costs
          </Link>{" "}
          when you are ready.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Episodes" value={episodes.length} hint={`${rendered} rendered`} />
        <Stat label="Characters" value={characters.length} hint={`${characters.filter((c) => c.locked).length} locked`} />
        <Stat label="Continuity" value={`after EP ${state.as_of_episode}`} hint={`${state.unresolved_plot_points.length} open threads`} />
        <Stat label="API spend" value={money(spend)} hint="actual, all episodes" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Episodes" subtitle="Generation status, render status and exports">
          {episodes.length === 0 ? (
            <Empty title="No episodes yet">
              <Link href="/episodes/new" className="text-gold-300 underline">
                Write the first one from a one-line synopsis
              </Link>
            </Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {episodes.map((e) => (
                <article key={e.id} className="group flex gap-3 rounded-xl border border-ink-700 bg-ink-850 p-3 hover:border-ink-600">
                  <Link href={`/episodes/${e.id}`} className="relative block h-36 w-20 shrink-0 overflow-hidden rounded-lg bg-ink-800">
                    {e.thumbnail ? (
                      <img src={e.thumbnail.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-2xl text-stone-600">🎬</div>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gold-400">{epCode(e.episode_number)}</span>
                      <Badge status={e.status}>{e.status.replace("_", " ")}</Badge>
                      {e.running && <Badge tone="sky">running</Badge>}
                    </div>
                    <Link href={`/episodes/${e.id}`} className="mt-1 block truncate font-semibold text-stone-100 hover:text-gold-300">
                      {e.title || "Untitled episode"}
                    </Link>
                    <p className="mt-0.5 line-clamp-2 text-xs text-stone-400">{e.synopsis}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                      <span>⏱ {e.duration ? secs(e.duration) : `~${e.target_duration}s`}</span>
                      <span>{e.mode}</span>
                      <span>{money(e.spend)}</span>
                      {e.failedJobs > 0 && <span className="text-red-400">{e.failedJobs} failed</span>}
                      {!e.continuity_committed && e.status !== "draft" && <span className="text-amber-400/80">continuity pending</span>}
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
                      <Link className="rounded-md bg-ink-700 px-2 py-1 hover:bg-ink-600" href={`/episodes/${e.id}/scenes`}>
                        Scenes
                      </Link>
                      <Link className="rounded-md bg-ink-700 px-2 py-1 hover:bg-ink-600" href={`/episodes/${e.id}/render`}>
                        Render
                      </Link>
                      <Link className="rounded-md bg-ink-700 px-2 py-1 hover:bg-ink-600" href={`/episodes/${e.id}/export`}>
                        Export
                      </Link>
                      {e.renderVertical && (
                        <a className="rounded-md bg-emerald-900/60 px-2 py-1 text-emerald-200 hover:bg-emerald-800/60" href={`${e.renderVertical.url}&download=1`}>
                          ⬇ 9:16
                        </a>
                      )}
                      {e.renderLandscape && (
                        <a className="rounded-md bg-emerald-900/60 px-2 py-1 text-emerald-200 hover:bg-emerald-800/60" href={`${e.renderLandscape.url}&download=1`}>
                          ⬇ 16:9
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Story so far" subtitle={`Continuity after episode ${state.as_of_episode}`} actions={<Link href="/world" className="text-xs text-gold-300 hover:underline">Open →</Link>}>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-stone-500">Current objective</dt>
                <dd className="text-stone-200">{state.current_objective || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-stone-500">Villain</dt>
                <dd className="text-stone-300">{state.villain_state || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-stone-500">Open threads</dt>
                <dd>
                  <ul className="list-disc space-y-1 pl-4 text-stone-300">
                    {state.unresolved_plot_points.slice(-4).map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Performance" subtitle="Log views & retention on each episode's Export page">
            {performance.length === 0 ? (
              <p className="text-sm text-stone-500">No analytics logged yet. Once you publish, record views, completion rate and CTR to see which hooks and characters work best.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-stone-500">
                  <tr>
                    <th className="py-1">EP</th>
                    <th>Views</th>
                    <th>Completion</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {[...performance]
                    .sort((a, b) => b.completion_rate - a.completion_rate)
                    .map((p) => (
                      <tr key={p.episode_id} className="border-t border-ink-700" title={p.hook}>
                        <td className="py-1.5 font-mono text-gold-400">{epCode(p.episode_number)}</td>
                        <td>{p.views.toLocaleString()}</td>
                        <td>{p.completion_rate.toFixed(1)}%</td>
                        <td>{p.ctr.toFixed(1)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
