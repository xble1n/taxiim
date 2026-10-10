import { useState, type FormEvent } from "react";
import { eur, patch, post, toCents } from "../api";
import { useAction, useQuery } from "../hooks";
import { Badge, Button, Card, DataTable, ErrorText, Field, Input, Modal, PageHeader, Select, Textarea } from "../ui";

const STATUSES = ["idea", "validating", "active", "paused", "dropped"];

export function Opportunities() {
  const { data } = useQuery<any[]>("/api/opportunities");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Opportunities" subtitle="Ranked by evidence-weighted expected value: first-year revenue × probability × margin × speed to cash. Undocumented demand is penalised." actions={<Button variant="primary" onClick={() => setOpen(true)}>Add opportunity</Button>} />
      <Card title="Ranked opportunities" pad>
        <DataTable rows={data ?? []} onRowClick={setView} columns={[
          { key: "title", label: "Opportunity", render: (r) => <><div className="text-ink">{r.title}</div><div className="text-[11px] text-muted">{r.segment}</div></> },
          { key: "score", label: "Score", align: "right", sortValue: (r) => r.model.score, render: (r) => <span className="font-semibold text-ink">{r.model.score}</span> },
          { key: "ev", label: "Expected value", align: "right", sortValue: (r) => r.model.expected_value_cents, render: (r) => eur(r.model.expected_value_cents) },
          { key: "rev", label: "1st-yr revenue", align: "right", sortValue: (r) => r.model.first_year_revenue_cents, render: (r) => eur(r.model.first_year_revenue_cents) },
          { key: "gm", label: "Gross margin", align: "right", sortValue: (r) => r.model.gross_margin, render: (r) => `${Math.round(r.model.gross_margin * 100)}%` },
          { key: "probability", label: "Prob.", align: "right", render: (r) => `${Math.round(r.probability * 100)}%` },
          { key: "time_to_revenue_days", label: "Days to cash", align: "right" },
          { key: "evidence", label: "Evidence", render: (r) => <Badge tone={r.model.evidence_strength === "documented" ? "good" : r.model.evidence_strength === "weak" ? "warn" : "critical"}>{r.model.evidence_strength}</Badge> },
          { key: "status", label: "Status", render: (r) => (
            <Select aria-label="Status" value={r.status} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(`/api/opportunities/${r.id}`, { status: e.target.value })} className="h-7 w-28 text-xs">{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
          ) },
        ]} />
      </Card>
      <OppForm open={open} onClose={() => setOpen(false)} />
      {view && (
        <Modal open onClose={() => setView(null)} title={view.title} wide>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {[
              ["Price", eur(view.price_cents)], ["Recurring / month", eur(view.recurring_monthly_cents)], ["Acquisition cost", eur(view.acquisition_cost_cents)],
              ["Delivery cost", eur(view.delivery_cost_cents)], ["Gross margin", `${Math.round(view.model.gross_margin * 100)}%`], ["Expected value", eur(view.model.expected_value_cents)],
            ].map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="num text-ink">{v}</dd></div>)}
          </dl>
          {[["Description", view.description], ["Conversion assumptions", view.conversion_assumptions], ["Evidence of demand", view.evidence], ["Major risks", view.risks]].map(([k, v]) => (
            <div key={k} className="mt-3"><div className="text-xs font-semibold uppercase tracking-wide text-muted">{k}</div><p className="mt-1 text-sm whitespace-pre-wrap text-ink-2">{v || "—"}</p></div>
          ))}
          <p className="mt-3 text-[11px] text-muted">Created by {view.created_by}. Model figures are estimates from these inputs, not forecasts.</p>
        </Modal>
      )}
    </div>
  );
}

function OppForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const blank = { title: "", segment: "", description: "", price: "", recurring: "", acq: "", delivery: "", probability: "20", days: "30", conversion_assumptions: "", evidence: "", risks: "", status: "idea" };
  const [f, setF] = useState(blank);
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const c = (v: string) => (v ? toCents(v) : 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await a.run(() => post("/api/opportunities", {
      title: f.title, segment: f.segment, description: f.description, price_cents: c(f.price), recurring_monthly_cents: c(f.recurring),
      acquisition_cost_cents: c(f.acq), delivery_cost_cents: c(f.delivery), probability: Number(f.probability) / 100, time_to_revenue_days: Number(f.days),
      conversion_assumptions: f.conversion_assumptions, evidence: f.evidence, risks: f.risks, status: f.status,
    }));
    if (ok) { setF(blank); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add opportunity" wide>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Title" className="col-span-2"><Input value={f.title} onChange={set("title")} required minLength={3} /></Field>
        <Field label="Segment" className="col-span-2"><Input value={f.segment} onChange={set("segment")} required /></Field>
        <Field label="Price (EUR)"><Input inputMode="decimal" value={f.price} onChange={set("price")} /></Field>
        <Field label="Recurring / mo"><Input inputMode="decimal" value={f.recurring} onChange={set("recurring")} /></Field>
        <Field label="Acquisition cost"><Input inputMode="decimal" value={f.acq} onChange={set("acq")} /></Field>
        <Field label="Delivery cost"><Input inputMode="decimal" value={f.delivery} onChange={set("delivery")} /></Field>
        <Field label="Probability %"><Input type="number" min={0} max={100} value={f.probability} onChange={set("probability")} /></Field>
        <Field label="Days to first cash"><Input type="number" min={1} value={f.days} onChange={set("days")} /></Field>
        <Field label="Status" className="col-span-2"><Select value={f.status} onChange={set("status")}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Description" className="col-span-2 sm:col-span-4"><Textarea value={f.description} onChange={set("description")} /></Field>
        <Field label="Conversion assumptions" className="col-span-2"><Textarea value={f.conversion_assumptions} onChange={set("conversion_assumptions")} /></Field>
        <Field label="Evidence of demand" hint="Interviews, inbound requests, competitor pricing — with sources." className="col-span-2"><Textarea value={f.evidence} onChange={set("evidence")} /></Field>
        <Field label="Major risks" className="col-span-2 sm:col-span-4"><Textarea value={f.risks} onChange={set("risks")} /></Field>
        <div className="col-span-2 sm:col-span-4"><ErrorText>{a.error}</ErrorText></div>
        <div className="col-span-2 flex justify-end gap-2 sm:col-span-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={a.busy}>Save</Button></div>
      </form>
    </Modal>
  );
}
