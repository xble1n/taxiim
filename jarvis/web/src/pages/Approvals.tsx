import { useState } from "react";
import { dt, post } from "../api";
import { useAction, useQuery } from "../hooks";
import { useShell } from "../App";
import { Badge, Button, Card, Empty, ErrorText, Json, PageHeader, Select, StatusBadge } from "../ui";

export function Approvals() {
  const [status, setStatus] = useState("pending");
  const { data } = useQuery<any[]>(`/api/approvals${status ? `?status=${status}` : ""}`);
  const { me, openRed } = useShell();
  const a = useAction();
  const decide = (row: any, approve: boolean) => {
    if (approve && row.requires_red && !me.redActive) return openRed();
    void a.run(() => post(`/api/approvals/${row.id}/decide`, { approve }));
  };
  return (
    <div>
      <PageHeader title="Approvals" subtitle="LEVEL 3 actions need your approval unless a bounded standing authorization covers them. LEVEL 4 always needs RED."
        actions={<Select aria-label="Filter" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="">All</option>{["pending", "executed", "failed", "rejected", "expired"].map((s) => <option key={s}>{s}</option>)}</Select>} />
      {me.killSwitch && <div className="mb-4 rounded-xl border border-critical/50 bg-critical/10 px-4 py-3 text-sm">▲ Kill switch engaged — approved actions cannot execute until it is disengaged under RED.</div>}
      <ErrorText>{a.error}</ErrorText>
      <div className="mt-3 space-y-3">
        {!data?.length && <Empty>Nothing {status || "here"}.</Empty>}
        {data?.map((r) => (
          <Card key={r.id} title={<span className="flex flex-wrap items-center gap-2 normal-case tracking-normal">
            <Badge tone={r.level === 4 ? "critical" : "warn"}>L{r.level} {r.level === 4 ? "PRIVILEGED" : "EXECUTE"}</Badge>
            <span className="font-mono text-ink">{r.tool}</span><StatusBadge status={r.status} />
          </span>} actions={<span className="text-xs text-muted">#{r.id} · {r.requested_by} · {dt(r.created_at)}</span>}>
            <p className="mb-2 text-sm text-ink">{r.summary}</p>
            <Json value={r.input} />
            {r.result && <div className="mt-2"><div className="mb-1 text-xs text-muted">Result</div><Json value={r.result} /></div>}
            {r.status === "pending" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant={r.requires_red ? "red" : "primary"} size="sm" disabled={a.busy} onClick={() => decide(r, true)}>{r.requires_red && !me.redActive ? "Authenticate RED to approve" : "Approve & execute"}</Button>
                <Button variant="ghost" size="sm" disabled={a.busy} onClick={() => decide(r, false)}>Reject</Button>
                <span className="text-xs text-muted">expires {dt(r.expires_at)}</span>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
