import { useEffect, useMemo, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "outline" | "red";
export function Button({ variant = "outline", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  const v: Record<BtnVariant, string> = {
    primary: "bg-accent-strong text-white hover:bg-accent border border-transparent",
    outline: "border border-line-strong text-ink hover:bg-panel-2",
    ghost: "text-ink-2 hover:text-ink hover:bg-panel-2 border border-transparent",
    danger: "border border-critical/60 text-[#ff8a8a] hover:bg-critical/15",
    red: "bg-red text-white hover:brightness-110 border border-transparent",
  };
  return (
    <button
      {...p}
      className={cx("inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50", size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm", v[variant], className)}
    />
  );
}

const fieldCls = "rounded-lg border border-line-strong bg-bg px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none";
/** Full width unless the caller sets an explicit width (avoids conflicting w-* utilities). */
const width = (c?: string) => (c && /(^|\s)(w-|flex-1)/.test(c) ? "" : "w-full");
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(fieldCls, width(p.className), "h-9", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(fieldCls, width(p.className), "h-9", p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(fieldCls, width(p.className), "min-h-24 py-2", p.className)} />;

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
        {children}
      </label>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="mt-2 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-[#ff9b9b]">{children}</p>;
}

const tones = {
  neutral: "bg-panel-2 text-ink-2 border-line-strong",
  blue: "bg-accent-soft text-[#8dbcf5] border-accent/40",
  good: "bg-good/12 text-[#5fd35f] border-good/40",
  warn: "bg-warn/12 text-warn border-warn/40",
  serious: "bg-serious/12 text-serious border-serious/40",
  critical: "bg-critical/15 text-[#ff8a8a] border-critical/50",
} as const;
export type Tone = keyof typeof tones;
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  ok: "good", verified: "good", executed: "good", success: "good", complete: "good", won: "good", met: "good", paid: "good", done: "good", active: "blue", approved: "good",
  pending: "warn", unverified: "warn", running: "warn", review: "critical", degraded: "warn", in_progress: "blue", sent: "blue", draft: "neutral",
  failed: "critical", error: "critical", denied: "critical", rejected: "critical", lost: "neutral", blocked: "serious", expired: "neutral", not_configured: "neutral", failure: "critical",
};
const STATUS_ICON: Partial<Record<Tone, string>> = { good: "●", warn: "◐", critical: "▲", serious: "■" };
/** Status chips always pair color with an icon + text label. */
export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return <Badge tone={tone}>{STATUS_ICON[tone] && <span aria-hidden>{STATUS_ICON[tone]}</span>}{status.replace(/_/g, " ")}</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function Loading() {
  return <div className="py-10 text-center text-sm text-muted">Loading…</div>;
}

export interface Column<T> { key: string; label: string; render?: (row: T) => ReactNode; className?: string; sortValue?: (row: T) => string | number; align?: "right" }

/** Searchable, sortable table. Search runs across all rendered string fields. */
export function DataTable<T extends Record<string, any>>({ rows, columns, searchable = true, empty = "No records yet.", onRowClick, filters, pageSize = 25 }: {
  rows: T[]; columns: Column<T>[]; searchable?: boolean; empty?: ReactNode; onRowClick?: (r: T) => void; filters?: ReactNode; pageSize?: number;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? rows.filter((r) => Object.values(r).some((v) => v !== null && typeof v !== "object" && String(v).toLowerCase().includes(needle))) : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (r: T) => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
      out = [...out].sort((a, b) => {
        const x = val(a), y = val(b);
        const nx = Number(x), ny = Number(y);
        const cmp = !Number.isNaN(nx) && !Number.isNaN(ny) && x !== "" && y !== "" ? nx - ny : String(x ?? "").localeCompare(String(y ?? ""));
        return cmp * sort.dir;
      });
    }
    return out;
  }, [rows, q, sort, columns]);
  useEffect(() => setPage(0), [q, rows.length]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <div>
      {(searchable || filters) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {searchable && <Input aria-label="Search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />}
          {filters}
          <span className="ml-auto text-xs text-muted num">{filtered.length} of {rows.length}</span>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-panel-2 text-[11px] uppercase tracking-wide text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cx("px-3 py-2 font-medium", c.align === "right" && "text-right")}>
                  <button className="uppercase hover:text-ink" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))}>
                    {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-muted">{empty}</td></tr>
            )}
            {shown.map((r, i) => (
              <tr key={r.id ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx("border-t border-line align-top", onRowClick && "cursor-pointer hover:bg-panel-2")}>
                {columns.map((c) => (
                  <td key={c.key} className={cx("px-3 py-2 text-ink-2", c.align === "right" && "text-right num", c.className)}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="num">{page + 1} / {pages}</span>
          <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, tone }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; tone?: "red" }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx("w-full rounded-xl border bg-panel shadow-2xl", wide ? "max-w-3xl" : "max-w-md", tone === "red" ? "border-red/60 red-glow" : "border-line-strong")}>
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:text-ink">✕</button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, tone, children }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "critical"; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={cx("mt-1.5 text-2xl font-semibold tracking-tight num", tone === "good" ? "text-[#5fd35f]" : tone === "critical" ? "text-[#ff8a8a]" : "text-ink")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted num">{sub}</div>}
      {children}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="mt-3" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {items.map((i) => (
        <button key={i.value} onClick={() => onChange(i.value)} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", value === i.value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink-2")}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded-md bg-bg p-2 font-mono text-[11px] leading-relaxed text-ink-2 whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>;
}
