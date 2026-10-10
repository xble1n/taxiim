import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { eur } from "./api";

// Validated (dataviz validator, dark, surface #111722): blue/orange pass all CVD + contrast checks.
export const SERIES = { revenue: "#3987e5", expenses: "#d95926" };
const INK_MUTED = "#7d889b";
const GRID = "#232c3d";
const axis = { stroke: GRID, tick: { fill: INK_MUTED, fontSize: 11 }, tickLine: false } as const;
const k = (c: number) => (Math.abs(c) >= 100_000 ? `€${(c / 100_000).toFixed(c % 100_000 ? 1 : 0)}k` : eur(c));

function Tip({ active, payload, label, fmtLabel }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line-strong bg-panel-2 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-muted">{fmtLabel ? fmtLabel(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="ml-auto num font-medium">{eur(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Cumulative verified revenue for the month against the target line. */
export function CumulativeChart({ daily, month, target }: { daily: { day: string; revenue_cents: number }[]; month: string; target: number }) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Date();
  const lastDay = today.getUTCFullYear() === y && today.getUTCMonth() + 1 === m ? today.getUTCDate() : days;
  const byDay = new Map(daily.map((d) => [Number(d.day.slice(8, 10)), d.revenue_cents]));
  let run = 0;
  const data = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    if (day <= lastDay) run += byDay.get(day) ?? 0;
    return { day, cumulative: day <= lastDay ? run : null, pace: Math.round((target * day) / days) };
  });
  return (
    <div className="h-64" aria-label="Cumulative verified revenue versus target">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" {...axis} interval="preserveStartEnd" />
          <YAxis {...axis} width={56} tickFormatter={k} domain={[0, Math.max(target, run) * 1.05]} />
          <Tooltip content={<Tip fmtLabel={(d: number) => `${month}-${String(d).padStart(2, "0")}`} />} cursor={{ stroke: "#3b4760" }} />
          <ReferenceLine y={target} stroke="#aab4c5" strokeDasharray="4 4" label={{ value: `Target ${k(target)}`, fill: "#aab4c5", fontSize: 11, position: "insideTopRight" }} />
          <Line dataKey="pace" name="Linear pace to target" stroke="#4a5670" strokeWidth={1.5} strokeDasharray="2 4" dot={false} activeDot={false} isAnimationActive={false} />
          <Line dataKey="cumulative" name="Verified revenue" stroke={SERIES.revenue} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#111722", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HistoryChart({ history }: { history: { month: string; verified_revenue_cents: number; expenses_cents: number; target_cents: number }[] }) {
  const target = history.at(-1)?.target_cents ?? 0;
  return (
    <div className="h-64" aria-label="Verified revenue and expenses by month">
      <ResponsiveContainer>
        <BarChart data={history} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="month" {...axis} />
          <YAxis {...axis} width={56} tickFormatter={k} />
          <Tooltip content={<Tip />} cursor={{ fill: "#ffffff08" }} />
          <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12, color: "#aab4c5" }} />
          <ReferenceLine y={target} stroke="#aab4c5" strokeDasharray="4 4" />
          <Bar dataKey="verified_revenue_cents" name="Verified revenue" fill={SERIES.revenue} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="expenses_cents" name="Expenses" fill={SERIES.expenses} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PipelineChart({ stages }: { stages: Record<string, { count: number; value_cents: number; weighted_cents: number }> }) {
  const data = Object.entries(stages).map(([stage, v]) => ({ stage, ...v }));
  return (
    <div className="h-64" aria-label="Weighted pipeline value by stage">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" {...axis} tickFormatter={k} />
          <YAxis type="category" dataKey="stage" {...axis} width={84} />
          <Tooltip content={<Tip />} cursor={{ fill: "#ffffff08" }} />
          <Bar dataKey="weighted_cents" name="Weighted value" fill={SERIES.revenue} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
