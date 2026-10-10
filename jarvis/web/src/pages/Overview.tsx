import { eur, dt, post } from "../api";
import { useQuery } from "../hooks";
import { useShell } from "../App";
import { CumulativeChart, HistoryChart, PipelineChart } from "../charts";
import { Badge, Button, Card, Empty, ErrorText, Loading, PageHeader, Progress, Stat, StatusBadge } from "../ui";

export function Overview() {
  const { me } = useShell();
  const { data, error, loading } = useQuery<any>("/api/dashboard", { intervalMs: 60_000 });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorText>{error}</ErrorText>;
  const k = data.kpis;
  const plan = data.cycle?.plan ?? {};
  return (
    <div className="space-y-5">
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${me.displayName}`}
        subtitle={<>Cycle {data.month} · status <StatusBadge status={data.cycle?.status ?? "active"} /> · figures are owner-verified cash only</>}
      />
      {me.performanceReview.length > 0 && (
        <div className="rounded-xl border border-serious/50 bg-serious/10 px-4 py-3 text-sm text-ink">
          <strong className="text-serious">■ Performance Review Mode</strong> — {me.performanceReview.join(", ")} missed target. Review findings and record a recovery plan on the Revenue page.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Verified revenue" value={eur(k.verified_revenue_cents)} sub={`${(k.progress * 100).toFixed(1)}% of ${eur(k.target_cents)} target`}>
          <Progress value={k.progress} label="Progress to monthly target" />
        </Stat>
        <Stat label="Remaining to target" value={eur(k.remaining_cents)} sub={plan.required_daily_cents ? `${eur(plan.required_daily_cents)}/day · ${plan.days_left} days left` : undefined} />
        <Stat label="Received vs invoiced" value={<>{eur(k.received_verified_cents)} <span className="text-base text-muted">/ {eur(k.invoiced_cents)}</span></>} sub={k.received_unverified_cents ? `${eur(k.received_unverified_cents)} awaiting verification` : "No unverified receipts"} />
        <Stat label="Net operating profit" value={eur(k.net_operating_profit_cents)} tone={k.net_operating_profit_cents < 0 ? "critical" : undefined} sub={`Expenses ${eur(k.expenses_cents)} · refunds ${eur(k.refunds_cents)}`} />
        <Stat label="Outstanding receivables" value={eur(k.outstanding_receivables_cents)} sub="Issued, unpaid invoices" />
        <Stat label="Recurring revenue" value={eur(k.recurring_revenue_cents)} sub="Verified recurring this month" />
        <Stat label="Cash available (ledger)" value={eur(k.cash_available_cents)} sub="Derived from verified ledger" />
        <a href="#/approvals" className="block"><Stat label="Pending approvals" value={data.pendingApprovals} sub="LEVEL 3–4 actions awaiting you" /></a>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Verified revenue this month">
          <CumulativeChart daily={data.daily} month={data.month} target={k.target_cents} />
        </Card>
        <Card title="Revenue vs expenses — 6 months">
          <HistoryChart history={data.history} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Monthly plan" className="xl:col-span-2" actions={<Button size="sm" variant="ghost" onClick={() => post(`/api/cycles/${data.month}/refresh`)}>Refresh plan</Button>}>
          {plan.actions?.length ? (
            <ol className="space-y-2.5">
              {plan.actions.map((a: any, i: number) => (
                <li key={i} className="flex gap-3">
                  <Badge tone={a.priority === 1 ? "blue" : "neutral"}>P{a.priority}</Badge>
                  <div>
                    <div className="text-sm text-ink">{a.action}</div>
                    <div className="text-xs text-muted">{a.rationale}</div>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty>No actions — the plan is generated from recorded data.</Empty>}
          {plan.disclaimer && <p className="mt-3 text-[11px] text-muted">{plan.disclaimer} Generated {dt(plan.generated_at)}.</p>}
        </Card>
        <Card title="Weighted pipeline by stage" actions={<span className="text-xs text-muted num">{data.pipeline.open_count} open · {eur(data.pipeline.open_weighted_cents)}</span>}>
          <PipelineChart stages={data.pipeline.stages} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Top opportunities" actions={<a className="text-xs text-accent" href="#/opportunities">All →</a>}>
          {data.opportunities.length ? (
            <ul className="divide-y divide-line">
              {data.opportunities.map((o: any) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="truncate text-ink">{o.title}</span>
                  <span className="shrink-0 text-xs text-muted num">score {o.model.score} · EV {eur(o.model.expected_value_cents)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No opportunities recorded.</Empty>}
        </Card>
        <Card title="Active projects" actions={<a className="text-xs text-accent" href="#/projects">All →</a>}>
          {data.projects.length ? (
            <ul className="divide-y divide-line">
              {data.projects.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm"><span className="text-ink">{p.name}</span><span className="text-xs text-muted num">P{p.priority} · {p.open_tasks} open</span></li>
              ))}
            </ul>
          ) : <Empty>No active projects.</Empty>}
        </Card>
        <Card title="Recent research" actions={<a className="text-xs text-accent" href="#/research">All →</a>}>
          {data.research.length ? (
            <ul className="divide-y divide-line">
              {data.research.map((r: any) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="truncate text-ink">{r.question}</span><StatusBadge status={r.status} /></li>
              ))}
            </ul>
          ) : <Empty>No research yet.</Empty>}
        </Card>
        <Card title="Integrations">
          <ul className="space-y-2">
            {data.integrations.map((i: any) => (
              <li key={i.name} className="flex items-start justify-between gap-3 text-sm">
                <div><div className="text-ink">{i.name}</div><div className="text-xs text-muted">{i.detail}</div></div>
                <StatusBadge status={i.status} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Alerts & notifications">
          {data.notifications.length || data.events.length ? (
            <ul className="space-y-2 text-sm">
              {data.notifications.map((n: any) => (
                <li key={`n${n.id}`} className="flex items-start gap-2"><StatusBadge status={n.severity === "critical" ? "error" : n.severity === "warning" ? "pending" : "active"} /><div><div className="text-ink">{n.title}</div><div className="text-xs text-muted">{n.body}</div></div></li>
              ))}
              {data.events.map((e: any) => (
                <li key={`e${e.id}`} className="flex items-start gap-2"><StatusBadge status={e.severity === "error" ? "error" : "degraded"} /><div><div className="text-ink">{e.source}</div><div className="text-xs text-muted">{e.message}</div></div></li>
              ))}
            </ul>
          ) : <Empty>All quiet.</Empty>}
        </Card>
        <Card title="Security events" actions={<a className="text-xs text-accent" href="#/security">Audit →</a>}>
          {data.security.length ? (
            <ul className="space-y-1.5 text-xs">
              {data.security.map((s: any) => (
                <li key={s.id} className="flex items-center justify-between gap-2"><span className="font-mono text-ink-2">{s.action}</span><span className="flex items-center gap-2 text-muted">{dt(s.ts)} <StatusBadge status={s.outcome} /></span></li>
              ))}
            </ul>
          ) : <Empty>No security events.</Empty>}
        </Card>
      </div>

      <Card title="Scheduled tasks" actions={<a className="text-xs text-accent" href="#/operations">Manage →</a>}>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {data.jobs.map((j: any) => (
            <div key={j.name} className="rounded-lg border border-line px-3 py-2 text-sm">
              <div className="flex items-center justify-between"><span className="font-mono text-xs text-ink">{j.name}</span>{j.last_status ? <StatusBadge status={j.last_status} /> : <Badge>not run</Badge>}</div>
              <div className="mt-1 text-xs text-muted">{j.last_error ?? j.description}</div>
              <div className="mt-1 text-[11px] text-muted">next {dt(j.next_run_at)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
