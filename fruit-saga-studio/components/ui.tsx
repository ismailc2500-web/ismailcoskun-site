import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { STATUS_TONE } from "@/lib/format";

/** Small, dependency-free UI kit (Tailwind). Usable from server and client components. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-gold-400 text-ink-950 hover:bg-gold-300 font-semibold shadow-[0_0_0_1px_rgba(245,182,66,0.4)]",
  secondary: "bg-ink-800 text-stone-100 hover:bg-ink-700 border border-ink-600",
  ghost: "text-stone-300 hover:bg-ink-800 hover:text-white",
  danger: "bg-red-950/60 text-red-200 hover:bg-red-900/70 border border-red-900",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; busy?: boolean }) {
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5 text-base" };
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        sizes[size],
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function Card({ children, className, title, actions, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-ink-700 bg-ink-900/80 p-5", className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-stone-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-stone-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  zinc: "bg-zinc-800 text-zinc-300 border-zinc-700",
  sky: "bg-sky-950 text-sky-300 border-sky-900",
  indigo: "bg-indigo-950 text-indigo-300 border-indigo-900",
  violet: "bg-violet-950 text-violet-300 border-violet-900",
  fuchsia: "bg-fuchsia-950 text-fuchsia-300 border-fuchsia-900",
  amber: "bg-amber-950 text-amber-300 border-amber-900",
  emerald: "bg-emerald-950 text-emerald-300 border-emerald-900",
  green: "bg-green-950 text-green-300 border-green-800",
  teal: "bg-teal-950 text-teal-300 border-teal-900",
  red: "bg-red-950 text-red-300 border-red-900",
  gold: "bg-gold-400/10 text-gold-300 border-gold-400/30",
};

export function Badge({ children, tone, status, className }: { children: ReactNode; tone?: string; status?: string; className?: string }) {
  const t = tone ?? (status ? STATUS_TONE[status] : undefined) ?? "zinc";
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide", TONES[t], className)}>
      {children}
    </span>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const inputBase =
  "w-full rounded-lg border border-ink-600 bg-ink-950/70 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-gold-400/70 focus:outline-none focus:ring-2 focus:ring-gold-400/20 disabled:opacity-60";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputBase, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputBase, "min-h-[4.5rem] leading-relaxed", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputBase, "pr-8", props.className)} />;
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-stone-100">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-stone-500">{hint}</div>}
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-ink-700", className)}>
      <div className="h-full rounded-full bg-gold-400 transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-600 p-8 text-center">
      <div className="text-stone-200">{title}</div>
      {children && <div className="mt-2 text-sm text-stone-400">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "gold", children }: { tone?: "gold" | "red" | "sky" | "emerald"; children: ReactNode }) {
  const map = {
    gold: "border-gold-400/30 bg-gold-400/5 text-gold-300",
    red: "border-red-900 bg-red-950/40 text-red-200",
    sky: "border-sky-900 bg-sky-950/40 text-sky-200",
    emerald: "border-emerald-900 bg-emerald-950/40 text-emerald-200",
  };
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", map[tone])}>{children}</div>;
}
