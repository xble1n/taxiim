import { useState } from "react";
import { dt, patch, post } from "../api";
import { useAction, useQuery } from "../hooks";
import { Badge, Button, Card, DataTable, ErrorText, Json, PageHeader, StatusBadge, Tabs } from "../ui";

export function Operations() {
  const [tab, setTab] = useState<"jobs" | "events" | "usage" | "integrations">("jobs");
  return (
    <div>
      <PageHeader title="Operations" subtitle="Scheduled jobs, system events and error logs, model usage and cost, integration health." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "jobs", label: "Scheduler" }, { value: "events", label: "System events" }, { value: "usage", label: "LLM usage & cost" }, { value: "integrations", label: "Integrations" }]} />
      {tab === "jobs" && <Jobs />}
      {tab === "events" && <Events />}
      {tab === "usage" && <Usage />}
      {tab === "integrations" && <Integrations />}
    </div>
  );
}

function Jobs() {
  const { data } = useQuery<any[]>("/api/jobs", { intervalMs: 15_000 });
  const a = useAction();
  return (
    <Card title="Scheduled jobs">
      <ErrorText>{a.error}</ErrorText>
      <DataTable rows={data ?? []} searchable={false} columns={[
        { key: "name", label: "Job", render: (r) => <><div className="font-mono text-ink">{r.name}</div><div className="text-[11px] text-muted">{r.description}</div></> },
        { key: "interval_seconds", label: "Every", align: "right", render: (r) => r.interval_seconds >= 3600 ? `${r.interval_seconds / 3600}h` : `${r.interval_seconds / 60}m` },
        { key: "last_run_at", label: "Last run", render: (r) => dt(r.last_run_at) },
        { key: "last_status", label: "Result", render: (r) => r.last_status ? <><StatusBadge status={r.last_status} /><div className="mt-1 text-[11px] text-muted">{r.last_error}</div></> : <Badge>never</Badge> },
        { key: "next_run_at", label: "Next", render: (r) => r.enabled ? dt(r.next_run_at) : <Badge>disabled</Badge> },
        { key: "act", label: "", render: (r) => <div className="flex gap-1">
          <Button size="sm" disabled={a.busy} onClick={() => a.run(() => post(`/api/jobs/${r.name}/run`))}>Run now</Button>
          <Button size="sm" variant="ghost" onClick={() => patch(`/api/jobs/${r.name}`, { enabled: !r.enabled })}>{r.enabled ? "Disable" : "Enable"}</Button>
        </div> },
      ]} />
    </Card>
  );
}

function Events() {
  const { data } = useQuery<any[]>("/api/events");
  const [sev, setSev] = useState("");
  return (
    <Card title="System events">
      <DataTable rows={(data ?? []).filter((e) => !sev || e.severity === sev)} filters={
        <div className="flex gap-1">{["", "error", "warning", "info"].map((s) => <Button key={s} size="sm" variant={sev === s ? "primary" : "ghost"} onClick={() => setSev(s)}>{s || "all"}</Button>)}</div>
      } columns={[
        { key: "ts", label: "Time", render: (r) => dt(r.ts) },
        { key: "severity", label: "Severity", render: (r) => <StatusBadge status={r.severity === "error" ? "error" : r.severity === "warning" ? "degraded" : "active"} /> },
        { key: "source", label: "Source", render: (r) => <span className="font-mono text-xs">{r.source}</span> },
        { key: "message", label: "Message", className: "max-w-md" },
        { key: "detail", label: "Detail", render: (r) => Object.keys(r.detail ?? {}).length ? <details><summary className="cursor-pointer text-xs text-accent">view</summary><Json value={r.detail} /></details> : "—" },
      ]} />
    </Card>
  );
}

function Usage() {
  const { data } = useQuery<any[]>("/api/llm-usage");
  const total = (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  return (
    <Card title="Model usage" actions={<span className="text-xs text-muted num">≈ ${total.toFixed(2)} in window · estimates from list prices</span>}>
      <DataTable rows={data ?? []} columns={[
        { key: "day", label: "Day" }, { key: "purpose", label: "Purpose" },
        { key: "calls", label: "Calls", align: "right" }, { key: "failures", label: "Failures", align: "right" },
        { key: "input_tokens", label: "Input tok", align: "right", render: (r) => Number(r.input_tokens).toLocaleString() },
        { key: "output_tokens", label: "Output tok", align: "right", render: (r) => Number(r.output_tokens).toLocaleString() },
        { key: "cost_usd", label: "Est. cost", align: "right", render: (r) => `$${Number(r.cost_usd).toFixed(3)}` },
      ]} empty="No model calls recorded." />
    </Card>
  );
}

function Integrations() {
  const { data } = useQuery<any[]>("/api/integrations");
  return (
    <Card title="Integration health">
      <DataTable rows={(data ?? []).map((r, i) => ({ id: i, ...r }))} searchable={false} columns={[
        { key: "name", label: "Integration", render: (r) => <span className="text-ink">{r.name}</span> },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        { key: "detail", label: "Detail" },
        { key: "required_for", label: "Needed for" },
      ]} />
    </Card>
  );
}
