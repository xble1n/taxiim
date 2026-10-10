import { useState, type FormEvent } from "react";
import { d, del, dt, eur, patch, post, toCents } from "../api";
import { useAction, useQuery } from "../hooks";
import { Badge, Button, Card, DataTable, ErrorText, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea } from "../ui";

const STAGES = ["new", "qualified", "contacted", "meeting", "proposal", "negotiation", "won", "lost"];
const CONSENT = ["none", "inbound", "existing_relationship", "legitimate_interest_b2b", "explicit_consent"];

export function Pipeline() {
  const [tab, setTab] = useState<"leads" | "drafts">("leads");
  return (
    <div>
      <PageHeader title="Pipeline" subtitle="Leads, contact basis and follow-ups. Outreach is drafted here and released only with a lawful basis." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "leads", label: "Leads" }, { value: "drafts", label: "Drafts & proposals" }]} />
      {tab === "leads" ? <Leads /> : <Drafts />}
    </div>
  );
}

function Leads() {
  const [stage, setStage] = useState("");
  const { data } = useQuery<any[]>(`/api/leads${stage ? `?stage=${stage}` : ""}`);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  return (
    <Card title="Leads" actions={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add lead</Button>}>
      <DataTable rows={data ?? []} onRowClick={(r) => setOpen(r.id)}
        filters={<Select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} className="w-40"><option value="">All stages</option>{STAGES.map((s) => <option key={s}>{s}</option>)}</Select>}
        columns={[
          { key: "company", label: "Company", render: (r) => <span className="text-ink">{r.company}</span> },
          { key: "segment", label: "Segment" },
          { key: "stage", label: "Stage", render: (r) => <StatusBadge status={r.stage} /> },
          { key: "est_value_cents", label: "Value", align: "right", render: (r) => eur(r.est_value_cents) },
          { key: "probability", label: "Prob.", align: "right", render: (r) => `${Math.round(r.probability * 100)}%` },
          { key: "consent_basis", label: "Contact basis", render: (r) => <Badge tone={r.consent_basis === "none" ? "warn" : "neutral"}>{r.consent_basis}</Badge> },
          { key: "next_action_due", label: "Next action", render: (r) => r.next_action ? <><div className="text-ink-2">{r.next_action}</div><div className={r.next_action_due && r.next_action_due.slice(0, 10) < todayIso ? "text-[11px] text-serious" : "text-[11px] text-muted"}>{d(r.next_action_due)}</div></> : "—" },
          { key: "created_by", label: "By", render: (r) => <span className="text-xs">{r.created_by}</span> },
        ]} />
      <LeadForm open={adding} onClose={() => setAdding(false)} />
      {open && <LeadDrawer id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function LeadForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const blank = { company: "", contact_name: "", email: "", phone: "", website: "", segment: "", source: "", consent_basis: "none", stage: "new", value: "", probability: "10", next_action: "", next_action_due: "", notes: "" };
  const [f, setF] = useState(blank);
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = (v: string) => (v.trim() ? v.trim() : null);
    const ok = await a.run(() => post("/api/leads", {
      company: f.company, contact_name: n(f.contact_name), email: n(f.email), phone: n(f.phone), website: n(f.website), segment: n(f.segment), source: f.source,
      consent_basis: f.consent_basis, stage: f.stage, est_value_cents: f.value ? toCents(f.value) : 0, probability: Number(f.probability) / 100,
      next_action: n(f.next_action), next_action_due: n(f.next_action_due), notes: f.notes,
    }));
    if (ok) { setF(blank); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add lead" wide>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Company"><Input value={f.company} onChange={set("company")} required /></Field>
        <Field label="Segment"><Input value={f.segment} onChange={set("segment")} placeholder="taxi fleet, logistics, retail…" /></Field>
        <Field label="Contact name"><Input value={f.contact_name} onChange={set("contact_name")} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Website"><Input type="url" value={f.website} onChange={set("website")} placeholder="https://" /></Field>
        <Field label="Source" hint="Where this lead came from — required."><Input value={f.source} onChange={set("source")} required /></Field>
        <Field label="Lawful contact basis" hint="Outreach release is refused while this is 'none'."><Select value={f.consent_basis} onChange={set("consent_basis")}>{CONSENT.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Stage"><Select value={f.stage} onChange={set("stage")}>{STAGES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Est. value (EUR)"><Input inputMode="decimal" value={f.value} onChange={set("value")} /></Field>
          <Field label="Probability %"><Input type="number" min={0} max={100} value={f.probability} onChange={set("probability")} /></Field>
        </div>
        <Field label="Next action"><Input value={f.next_action} onChange={set("next_action")} /></Field>
        <Field label="Due"><Input type="date" value={f.next_action_due} onChange={set("next_action_due")} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={set("notes")} /></Field>
        <div className="sm:col-span-2"><ErrorText>{a.error}</ErrorText></div>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={a.busy}>Save lead</Button></div>
      </form>
    </Modal>
  );
}

function LeadDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useQuery<any>(`/api/leads/${id}`);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState("note");
  const a = useAction();
  if (!data) return null;
  const l = data.lead;
  return (
    <Modal open onClose={onClose} title={l.company} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Field label="Stage"><Select value={l.stage} onChange={(e) => patch(`/api/leads/${id}`, { stage: e.target.value })}>{STAGES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Contact basis"><Select value={l.consent_basis} onChange={(e) => patch(`/api/leads/${id}`, { consent_basis: e.target.value })}>{CONSENT.map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <div><div className="text-xs text-muted">Value</div><div className="num text-ink">{eur(l.est_value_cents)} · {Math.round(l.probability * 100)}%</div></div>
          <div><div className="text-xs text-muted">Source</div><div className="text-ink-2 break-words">{l.source}</div></div>
        </div>
        <div className="text-sm text-ink-2">{[l.contact_name, l.email, l.phone, l.website].filter(Boolean).join(" · ") || "No contact details"}</div>
        {l.notes && <p className="rounded-lg bg-bg p-3 text-sm whitespace-pre-wrap text-ink-2">{l.notes}</p>}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Log activity</h3>
          <div className="flex gap-2">
            <Select aria-label="Activity kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-28">{["note", "email", "call", "meeting"].map((k) => <option key={k}>{k}</option>)}</Select>
            <Input aria-label="Activity summary" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Summary" />
            <Button disabled={!note || a.busy} onClick={async () => { if (await a.run(() => post(`/api/leads/${id}/activities`, { kind, summary: note }))) setNote(""); }}>Add</Button>
          </div>
          <ErrorText>{a.error}</ErrorText>
        </div>
        <ul className="max-h-56 space-y-1.5 overflow-y-auto text-sm">
          {data.activities.map((x: any) => <li key={x.id} className="flex gap-2"><Badge>{x.kind}</Badge><span className="flex-1 text-ink-2">{x.summary}</span><span className="text-[11px] text-muted">{x.actor} · {dt(x.created_at)}</span></li>)}
        </ul>
        {data.drafts.length > 0 && <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Drafts</h3>{data.drafts.map((x: any) => <div key={x.id} className="text-sm text-ink-2">#{x.id} {x.title} <StatusBadge status={x.status} /></div>)}</div>}
        <div className="flex justify-end"><Button variant="danger" size="sm" onClick={async () => { if (confirm(`Delete ${l.company}?`)) { await del(`/api/leads/${id}`); onClose(); } }}>Delete lead</Button></div>
      </div>
    </Modal>
  );
}

function Drafts() {
  const { data } = useQuery<any[]>("/api/drafts");
  const [view, setView] = useState<any>(null);
  return (
    <Card title="Drafts">
      <DataTable rows={data ?? []} onRowClick={setView} columns={[
        { key: "kind", label: "Kind", render: (r) => <Badge>{r.kind}</Badge> },
        { key: "title", label: "Title", render: (r) => <span className="text-ink">{r.title}</span> },
        { key: "company", label: "Lead" },
        { key: "created_by", label: "Author" },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        { key: "created_at", label: "Created", render: (r) => dt(r.created_at) },
      ]} />
      {view && (
        <Modal open onClose={() => setView(null)} title={view.title} wide>
          <pre className="max-h-[50vh] overflow-y-auto rounded-lg bg-bg p-3 text-sm whitespace-pre-wrap text-ink-2">{view.body}</pre>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {["draft", "approved", "sent", "discarded"].map((s) => (
              <Button key={s} size="sm" variant={view.status === s ? "primary" : "outline"} onClick={async () => { await patch(`/api/drafts/${view.id}`, { status: s }); setView({ ...view, status: s }); }}>{s}</Button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">No outbound email integration is configured: send approved drafts yourself, then mark them sent.</p>
        </Modal>
      )}
    </Card>
  );
}
