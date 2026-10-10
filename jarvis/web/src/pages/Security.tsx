import { useState, type FormEvent } from "react";
import { del, dt, post } from "../api";
import { useAction, useQuery } from "../hooks";
import { useShell } from "../App";
import { Badge, Button, Card, DataTable, ErrorText, Field, Input, Json, PageHeader, StatusBadge, Tabs } from "../ui";

export function Security() {
  const [tab, setTab] = useState<"audit" | "sessions" | "account">("audit");
  return (
    <div>
      <PageHeader title="Security" subtitle="Tamper-evident audit history, active sessions, and owner credentials." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "audit", label: "Audit log" }, { value: "sessions", label: "Sessions & RED" }, { value: "account", label: "Credentials" }]} />
      {tab === "audit" && <Audit />}
      {tab === "sessions" && <Sessions />}
      {tab === "account" && <Account />}
    </div>
  );
}

function Audit() {
  const [cat, setCat] = useState("");
  const { data } = useQuery<any[]>(`/api/audit?limit=500${cat ? `&category=${cat}` : ""}`);
  const chain = useQuery<any>("/api/audit/verify");
  return (
    <Card title="Audit log" actions={chain.data && (chain.data.ok
      ? <Badge tone="good">● hash chain intact · {chain.data.entries} entries</Badge>
      : <Badge tone="critical">▲ chain broken at #{chain.data.brokenAt}</Badge>)}>
      <DataTable rows={data ?? []} filters={
        <div className="flex flex-wrap gap-1">{["", "security", "permission", "finance", "agent", "data", "general"].map((c) => <Button key={c} size="sm" variant={cat === c ? "primary" : "ghost"} onClick={() => setCat(c)}>{c || "all"}</Button>)}</div>
      } columns={[
        { key: "id", label: "#", align: "right" },
        { key: "ts", label: "Time", render: (r) => dt(r.ts) },
        { key: "actor", label: "Actor", render: (r) => <Badge tone={r.actor === "jarvis" ? "blue" : r.actor === "anonymous" ? "warn" : "neutral"}>{r.actor}</Badge> },
        { key: "action", label: "Action", render: (r) => <span className="font-mono text-xs text-ink">{r.action}</span> },
        { key: "level", label: "Lvl", render: (r) => (r.level ? `L${r.level}` : "—") },
        { key: "target", label: "Target", render: (r) => <span className="font-mono text-xs">{r.target ?? "—"}</span> },
        { key: "outcome", label: "Outcome", render: (r) => <StatusBadge status={r.outcome} /> },
        { key: "detail", label: "Detail", render: (r) => Object.keys(r.detail ?? {}).length ? <details><summary className="cursor-pointer text-xs text-accent">view</summary><Json value={r.detail} /></details> : "—" },
      ]} />
    </Card>
  );
}

function Sessions() {
  const { data } = useQuery<any>("/api/sessions");
  const { me } = useShell();
  const a = useAction();
  return (
    <div className="space-y-4">
      <Card title="Emergency controls">
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" onClick={() => a.run(() => post("/api/red/revoke-all"))}>Revoke RED on all sessions</Button>
          <Button variant="danger" onClick={() => a.run(() => post("/api/sessions/revoke-others"))}>Sign out all other sessions</Button>
          {!me.killSwitch && <Button variant="red" onClick={() => a.run(() => post("/api/kill-switch", { engaged: true }))}>Engage kill switch</Button>}
        </div>
        <p className="mt-2 text-xs text-muted">Revoking access never requires RED. Re-enabling execution (disengaging the kill switch) does.</p>
        <ErrorText>{a.error}</ErrorText>
      </Card>
      <Card title="Active sessions">
        <DataTable rows={data?.sessions ?? []} searchable={false} columns={[
          { key: "id", label: "Session", render: (r) => <>#{r.id} {r.id === data.current && <Badge tone="blue">this device</Badge>}</> },
          { key: "ip", label: "IP" },
          { key: "user_agent", label: "Device", className: "max-w-xs truncate" },
          { key: "last_seen_at", label: "Last seen", render: (r) => dt(r.last_seen_at) },
          { key: "expires_at", label: "Expires", render: (r) => dt(r.expires_at) },
          { key: "red_until", label: "RED", render: (r) => r.red_until && new Date(r.red_until) > new Date() ? <Badge tone="critical">until {dt(r.red_until)}</Badge> : "—" },
          { key: "x", label: "", render: (r) => r.id !== data.current && <Button size="sm" variant="ghost" onClick={() => del(`/api/sessions/${r.id}`)}>Revoke</Button> },
        ]} />
      </Card>
    </div>
  );
}

function Account() {
  const [f, setF] = useState({ current: "", next: "", confirm: "", code: "" });
  const a = useAction();
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) return a.setError("New passwords do not match.");
    if (await a.run(() => post("/api/auth/password", { current: f.current, next: f.next, code: f.code }))) { setDone(true); setF({ current: "", next: "", confirm: "", code: "" }); }
  };
  return (
    <Card title="Change password" className="max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
        <Field label="New password" hint="At least 12 characters."><Input type="password" autoComplete="new-password" minLength={12} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /></Field>
        <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
        <Field label="Fresh authenticator code"><Input inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} required /></Field>
        <ErrorText>{a.error}</ErrorText>
        {done && <p className="text-sm text-[#5fd35f]">● Password changed.</p>}
        <Button variant="primary" disabled={a.busy}>Change password</Button>
      </form>
      <p className="mt-4 text-xs text-muted">Passkeys (WebAuthn) are on the roadmap as an additional factor; TOTP is the current second factor.</p>
    </Card>
  );
}
