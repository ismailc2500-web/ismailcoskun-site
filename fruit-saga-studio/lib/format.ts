/** Formatting helpers shared by server and client components. */

export function money(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function secs(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const m = Math.floor(n / 60);
  const s = n - m * 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}s`;
}

export function epCode(n: number): string {
  return `EP.${String(n).padStart(2, "0")}`;
}

export const STATUS_TONE: Record<string, string> = {
  draft: "zinc",
  scripted: "sky",
  shotlisted: "indigo",
  prompted: "violet",
  voiced: "fuchsia",
  assets_ready: "amber",
  rendered: "emerald",
  published: "green",
  queued: "zinc",
  running: "sky",
  succeeded: "emerald",
  cached: "teal",
  failed: "red",
  skipped: "zinc",
};

export function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
