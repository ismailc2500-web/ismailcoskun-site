"use client";

import { useRouter } from "next/navigation";
import { api } from "@/components/hooks";

export function SeriesSwitcher({ series, active }: { series: { id: string; title: string }[]; active: string | null }) {
  const router = useRouter();
  return (
    <select
      value={active ?? ""}
      onChange={async (e) => {
        if (e.target.value === "__new") {
          router.push("/series");
          return;
        }
        await api("/api/active-series", "POST", { seriesId: e.target.value });
        router.push("/");
        router.refresh();
      }}
      className="w-full rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-2 text-sm text-stone-100 focus:border-gold-400/60 focus:outline-none"
    >
      {series.map((s) => (
        <option key={s.id} value={s.id}>
          {s.title}
        </option>
      ))}
      <option value="__new">＋ New / manage series…</option>
    </select>
  );
}
