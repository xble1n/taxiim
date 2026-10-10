import { useEffect, useState, type FormEvent } from "react";
import { del, dt, eur, post, patch, toCents } from "../api";
import { useAction, useQuery } from "../hooks";
import { useRedGate, useShell } from "../App";
import { Badge, Button, Card, DataTable, ErrorText, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs } from "../ui";

export function Settings() {
  const [tab, setTab] = useState<"general" | "permissions" | "crypto" | "backup">("general");
  return (
    <div>
      <PageHeader title="Settings" subtitle="Configuration and permissions. Changes require an active RED PROTOCOL session." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "general", label: "General" }, { value: "permissions", label: "Permissions" }, { value: "crypto", label: "Crypto destinations" }, { value: "backup", label: "Backup" }]} />
      {tab === "general" && <General />}
      {tab === "permissions" && <Permissions />}
      {tab === "crypto" && <Crypto />}
      {tab === "backup" && <Backup />}
    </div>
  );
}

const LABELS: Record<string, [string, string]> = {
  monthly_target_cents: ["Monthly revenue target (EUR)", "Applies to cycles opened after the change."],
  red_ttl_minutes: ["RED session length (minutes)", ""],
  approval_ttl_hours: ["Approval request expiry (hours)", ""],
  agent_max_tool_calls: ["Max tool calls per chat turn", ""],
  agent_rate_limit_per_minute: ["Agent tool-call rate limit / minute", ""],
  llm_monthly_budget_usd: ["Monthly LLM budget (USD)", "Chat and research stop when reached."],
  owner_timezone: ["Owner timezone", ""],
};

function General() {
  const { data } = useQuery<any>("/api/settings");
  const { me } = useShell();
  const gate = useRedGate();
  const [f, setF] = useState<Record<string, string>>({});
  const a = useAction();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!data) return;
    const v: Record<string, string> = {};
    for (const k of Object.keys(LABELS)) v[k] = k === "monthly_target_cents" ? String(data.values[k] / 100) : String(data.values[k]);
    setF(v);
  }, [data]);
  if (!data) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    gate(async () => {
      const body: Record<string, unknown> = {};
      for (const k of Object.keys(LABELS)) {
        body[k] = k === "monthly_target_cents" ? toCents(f[k]) : typeof data.defaults[k] === "number" ? Number(f[k]) : f[k];
      }
      if (await a.run(() => patch("/api/settings", body))) setSaved(true);
    });
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Operating parameters">
        <form onSubmit={submit} className="space-y-3">
          {Object.entries(LABELS).map(([k, [label, hint]]) => (
            <Field key={k} label={label} hint={hint || undefined}><Input value={f[k] ?? ""} onChange={(e) => { setSaved(false); setF({ ...f, [k]: e.target.value }); }} /></Field>
          ))}
          <ErrorText>{a.error}</ErrorText>
          {saved && <p className="text-sm text-[#5fd35f]">● Saved.</p>}
          <Button variant={me.redActive ? "primary" : "red"} disabled={a.busy}>{me.redActive ? "Save settings" : "Authenticate RED to save"}</Button>
        </form>
      </Card>
      <Card title="Kill switch">
        <p className="text-sm text-ink-2">Halts every LEVEL 3 and LEVEL 4 action immediately — including already-approved ones and standing authorizations. Reading, drafting and research continue.</p>
        <div className="mt-4 flex items-center gap-3">
          {me.killSwitch ? <Badge tone="critical">▲ ENGAGED</Badge> : <Badge tone="good">● disengaged</Badge>}
          {me.killSwitch
            ? <Button variant="outline" onClick={() => gate(() => void a.run(() => post("/api/kill-switch", { engaged: false })))}>Disengage (RED)</Button>
            : <Button variant="red" onClick={() => a.run(() => post("/api/kill-switch", { engaged: true }))}>Engage kill switch</Button>}
        </div>
      </Card>
    </div>
  );
}

function Permissions() {
  const { data } = useQuery<any>("/api/permissions");
  const gate = useRedGate();
  const [grant, setGrant] = useState<any>(null);
  const a = useAction();
  if (!data) return null;
  const gated = data.tools.filter((t: any) => t.level >= 3);
  return (
    <div className="space-y-4">
      <Card title="Tool permission levels">
        <DataTable rows={data.tools.map((t: any, i: number) => ({ id: i, ...t }))} columns={[
          { key: "name", label: "Tool", render: (r) => <span className="font-mono text-ink">{r.name}</span> },
          { key: "level", label: "Level", render: (r) => <Badge tone={r.level === 4 ? "critical" : r.level === 3 ? "warn" : r.level === 2 ? "blue" : "neutral"}>L{r.level} {r.levelName}</Badge> },
          { key: "description", label: "Description", className: "max-w-xl" },
        ]} />
      </Card>
      <Card title="Standing authorizations" actions={<Button size="sm" variant="primary" onClick={() => gate(() => setGrant({ tool: gated[0]?.name, max_uses: "5", max_amount: "", hours: "24", note: "" }))}>Grant (RED)</Button>}>
        <p className="mb-3 text-xs text-muted">Bounded, expiring pre-approval for recurring LEVEL 3 actions. LEVEL 4 grants need an amount cap and expire within 7 days. Revoking never needs RED.</p>
        <DataTable rows={data.authorizations} searchable={false} empty="No standing authorizations — every LEVEL 3/4 action requires your approval." columns={[
          { key: "tool", label: "Tool", render: (r) => <span className="font-mono">{r.tool}</span> },
          { key: "uses", label: "Uses", align: "right", render: (r) => `${r.uses} / ${r.max_uses}` },
          { key: "max_amount_cents", label: "Cap / use", align: "right", render: (r) => (r.max_amount_cents ? eur(r.max_amount_cents) : "none") },
          { key: "expires_at", label: "Expires", render: (r) => dt(r.expires_at) },
          { key: "state", label: "State", render: (r) => <StatusBadge status={r.revoked_at ? "rejected" : new Date(r.expires_at) < new Date() || r.uses >= r.max_uses ? "expired" : "active"} /> },
          { key: "note", label: "Note" },
          { key: "x", label: "", render: (r) => !r.revoked_at && <Button size="sm" variant="ghost" onClick={() => del(`/api/permissions/authorizations/${r.id}`)}>Revoke</Button> },
        ]} />
      </Card>
      {grant && (
        <Modal open onClose={() => setGrant(null)} title="Grant standing authorization" tone="red">
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            const ok = await a.run(() => post("/api/permissions/authorizations", { tool: grant.tool, max_uses: Number(grant.max_uses), max_amount_cents: grant.max_amount ? toCents(grant.max_amount) : null, expires_in_hours: Number(grant.hours), note: grant.note || undefined }));
            if (ok) setGrant(null);
          }}>
            <Field label="Tool"><Select value={grant.tool} onChange={(e) => setGrant({ ...grant, tool: e.target.value })}>{gated.map((t: any) => <option key={t.name} value={t.name}>{t.name} (L{t.level})</option>)}</Select></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Max uses"><Input type="number" min={1} max={100} value={grant.max_uses} onChange={(e) => setGrant({ ...grant, max_uses: e.target.value })} /></Field>
              <Field label="Cap / use (EUR)"><Input inputMode="decimal" value={grant.max_amount} onChange={(e) => setGrant({ ...grant, max_amount: e.target.value })} /></Field>
              <Field label="Expires in (h)"><Input type="number" min={1} max={720} value={grant.hours} onChange={(e) => setGrant({ ...grant, hours: e.target.value })} /></Field>
            </div>
            <Field label="Note"><Input value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} /></Field>
            <ErrorText>{a.error}</ErrorText>
            <div className="flex justify-end"><Button variant="red" disabled={a.busy}>Grant</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

const NETWORKS = ["ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche-c"];

function Crypto() {
  const { data } = useQuery<any[]>("/api/crypto/destinations");
  const gate = useRedGate();
  const [verify, setVerify] = useState<any>(null);
  const [add, setAdd] = useState<any>(null);
  const a = useAction();
  return (
    <Card title="Owner crypto destinations" actions={<Button size="sm" onClick={() => gate(() => setAdd({ address: "", label: "" }))}>Add destination (RED)</Button>}>
      <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-ink-2">
        ◐ A configured address is not proof of ownership or a verified deposit endpoint. Confirm the exact network and asset from your exchange's deposit page before verifying. JARVIS never holds keys, never signs, and never sends funds — it prepares proposals you execute yourself.
      </div>
      <DataTable rows={data ?? []} searchable={false} columns={[
        { key: "address", label: "Address", render: (r) => <><div className="font-mono text-xs break-all text-ink">{r.address}</div><div className="text-[11px] text-muted">{r.label}</div></> },
        { key: "network", label: "Network", render: (r) => r.network ?? <span className="text-warn">unconfirmed</span> },
        { key: "asset", label: "Asset", render: (r) => r.asset ?? "—" },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        { key: "notes", label: "Notes", className: "max-w-xs text-xs" },
        { key: "x", label: "", render: (r) => <div className="flex gap-1">
          {r.status === "unverified" && <Button size="sm" onClick={() => gate(() => setVerify({ ...r, confirm_address: "", network: NETWORKS[0], asset: "USDT", ok: false }))}>Verify</Button>}
          {r.status !== "disabled" && <Button size="sm" variant="ghost" onClick={() => post(`/api/crypto/destinations/${r.id}/disable`)}>Disable</Button>}
        </div> },
      ]} />
      {verify && (
        <Modal open onClose={() => setVerify(null)} title="Verify crypto destination" tone="red">
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            const ok = await a.run(() => post(`/api/crypto/destinations/${verify.id}/verify`, { confirm_address: verify.confirm_address, network: verify.network, asset: verify.asset, deposit_instructions_confirmed: verify.ok }));
            if (ok) setVerify(null);
          }}>
            <p className="font-mono text-xs break-all text-ink-2">{verify.address}</p>
            <Field label="Re-type the address" hint="Must match exactly — protects against clipboard tampering."><Input value={verify.confirm_address} onChange={(e) => setVerify({ ...verify, confirm_address: e.target.value })} autoComplete="off" required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Network"><Select value={verify.network} onChange={(e) => setVerify({ ...verify, network: e.target.value })}>{NETWORKS.map((n) => <option key={n}>{n}</option>)}</Select></Field>
              <Field label="Asset"><Input value={verify.asset} onChange={(e) => setVerify({ ...verify, asset: e.target.value.toUpperCase() })} required /></Field>
            </div>
            <label className="flex items-start gap-2 text-sm text-ink-2"><input type="checkbox" className="mt-1" checked={verify.ok} onChange={(e) => setVerify({ ...verify, ok: e.target.checked })} /> I confirmed this network and asset on the receiving exchange's deposit page for this exact address.</label>
            <ErrorText>{a.error}</ErrorText>
            <div className="flex justify-end"><Button variant="red" disabled={a.busy || !verify.ok}>Verify destination</Button></div>
          </form>
        </Modal>
      )}
      {add && (
        <Modal open onClose={() => setAdd(null)} title="Add destination" tone="red">
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => post("/api/crypto/destinations", add))) setAdd(null); }}>
            <Field label="EVM address"><Input value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} required /></Field>
            <Field label="Label"><Input value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} /></Field>
            <ErrorText>{a.error}</ErrorText>
            <div className="flex justify-end"><Button variant="red" disabled={a.busy}>Add (unverified)</Button></div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

function Backup() {
  const { me } = useShell();
  const gate = useRedGate();
  return (
    <Card title="Backup & export" className="max-w-2xl">
      <p className="text-sm text-ink-2">Full logical export of business data, memory, knowledge, approvals and the audit log. Credentials (password hash, authenticator secret, session tokens) are never exported.</p>
      <p className="mt-2 text-xs text-muted">A daily JSON snapshot is also written to the server's data directory when running on embedded storage. For managed Postgres, use provider point-in-time recovery (see docs/DEPLOYMENT.md).</p>
      <div className="mt-4">
        {me.redActive ? <a href="/api/backup"><Button variant="primary">Download backup</Button></a> : <Button variant="red" onClick={() => gate(() => undefined)}>Authenticate RED to export</Button>}
      </div>
    </Card>
  );
}
