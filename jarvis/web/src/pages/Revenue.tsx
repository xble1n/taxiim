import { useState, type FormEvent } from "react";
import { d, eur, patch, post, toCents } from "../api";
import { useAction, useQuery } from "../hooks";
import { useRedGate } from "../App";
import { Badge, Button, Card, DataTable, Empty, ErrorText, Field, Input, Modal, PageHeader, Select, Stat, StatusBadge, Tabs, Textarea } from "../ui";

const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);

export function Revenue() {
  const [tab, setTab] = useState<"ledger" | "invoices" | "cycles">("ledger");
  const [month, setMonth] = useState(thisMonth());
  const kpis = useQuery<any>(`/api/kpis?month=${month}`);
  const k = kpis.data;
  return (
    <div>
      <PageHeader title="Revenue" subtitle="Only owner-verified cash counts. Invoices, projections, unverified receipts and internal transfers never do."
        actions={<Input type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />} />
      {k && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Verified revenue" value={eur(k.verified_revenue_cents)} sub={`target ${eur(k.target_cents)}`} />
          <Stat label="Invoiced" value={eur(k.invoiced_cents)} sub={`received ${eur(k.received_verified_cents)}`} />
          <Stat label="Expenses" value={eur(k.expenses_cents)} sub={`refunds ${eur(k.refunds_cents)}`} />
          <Stat label="Net operating profit" value={eur(k.net_operating_profit_cents)} tone={k.net_operating_profit_cents < 0 ? "critical" : undefined} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} items={[{ value: "ledger", label: "Ledger" }, { value: "invoices", label: "Invoices" }, { value: "cycles", label: "Monthly cycles" }]} />
      {tab === "ledger" && <Ledger month={month} />}
      {tab === "invoices" && <Invoices />}
      {tab === "cycles" && <Cycles />}
    </div>
  );
}

function Ledger({ month }: { month: string }) {
  const { data } = useQuery<any[]>(`/api/transactions?month=${month}`);
  const [adding, setAdding] = useState(false);
  const [verifying, setVerifying] = useState<any>(null);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const gate = useRedGate();
  const rows = (data ?? []).filter((r) => (type === "all" || r.type === type) && (status === "all" || r.verification_status === status));
  return (
    <Card title="Ledger" actions={<Button size="sm" variant="primary" onClick={() => setAdding(true)}>Record transaction</Button>}>
      <DataTable rows={rows}
        filters={<>
          <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="w-44"><option value="all">All types</option>{["payment_received", "expense", "refund", "chargeback", "internal_transfer", "adjustment"].map((t) => <option key={t}>{t}</option>)}</Select>
          <Select aria-label="Verification" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40"><option value="all">All statuses</option><option>unverified</option><option>verified</option><option>rejected</option></Select>
        </>}
        columns={[
          { key: "occurred_on", label: "Date", render: (r) => d(r.occurred_on) },
          { key: "type", label: "Type", render: (r) => <span className="font-mono text-xs">{r.type}</span> },
          { key: "counterparty", label: "Counterparty" },
          { key: "description", label: "Description", className: "max-w-xs truncate" },
          { key: "eur_cents", label: "EUR", align: "right", render: (r) => <>{eur(r.eur_cents, 2)}{r.currency !== "EUR" && <div className="text-[11px] text-muted">{(r.amount_cents / 100).toFixed(2)} {r.currency}</div>}</> },
          { key: "payment_method", label: "Method", render: (r) => <>{r.payment_method}{r.tx_hash && <div className="max-w-[140px] truncate font-mono text-[10px] text-muted" title={r.tx_hash}>{r.tx_hash}</div>}</> },
          { key: "verification_status", label: "Status", render: (r) => <StatusBadge status={r.verification_status} /> },
          { key: "actions", label: "", render: (r) => r.verification_status === "unverified" && (
            <div className="flex gap-1">
              <Button size="sm" onClick={() => gate(() => setVerifying({ ...r, mode: "verify" }))}>Verify</Button>
              <Button size="sm" variant="ghost" onClick={() => gate(() => setVerifying({ ...r, mode: "reject" }))}>Reject</Button>
            </div>
          ) },
        ]} />
      <TxForm open={adding} onClose={() => setAdding(false)} />
      <VerifyForm tx={verifying} onClose={() => setVerifying(null)} />
    </Card>
  );
}

function TxForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState<any>({ occurred_on: today(), type: "payment_received", amount: "", currency: "EUR", fx: "", counterparty: "", description: "", payment_method: "bank", recurring: false, tx_hash: "", network: "", confirmations: "" });
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: any = { occurred_on: f.occurred_on, type: f.type, amount_cents: toCents(f.amount), currency: f.currency, counterparty: f.counterparty, description: f.description, payment_method: f.payment_method, recurring: f.recurring };
    if (f.currency !== "EUR") body.fx_rate_to_eur = parseFloat(f.fx);
    if (f.payment_method === "crypto") Object.assign(body, { tx_hash: f.tx_hash, network: f.network, confirmations: f.confirmations ? Number(f.confirmations) : 0 });
    if (await a.run(() => post("/api/transactions", body))) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Record transaction" wide>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date"><Input type="date" value={f.occurred_on} onChange={set("occurred_on")} required /></Field>
        <Field label="Type"><Select value={f.type} onChange={set("type")}>{["payment_received", "expense", "refund", "chargeback", "internal_transfer", "adjustment"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Amount"><Input inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="1500.00" required /></Field>
        <Field label="Currency"><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={5} /></Field>
        {f.currency !== "EUR" && <Field label="FX rate to EUR" hint="From your bank statement. JARVIS never converts silently."><Input inputMode="decimal" value={f.fx} onChange={set("fx")} required /></Field>}
        <Field label="Method"><Select value={f.payment_method} onChange={set("payment_method")}>{["bank", "card", "crypto", "cash", "other"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
        {f.payment_method === "crypto" && <>
          <Field label="Transaction hash"><Input value={f.tx_hash} onChange={set("tx_hash")} required /></Field>
          <Field label="Network"><Input value={f.network} onChange={set("network")} placeholder="ethereum / bsc / …" required /></Field>
          <Field label="Confirmations"><Input inputMode="numeric" value={f.confirmations} onChange={set("confirmations")} /></Field>
        </>}
        <Field label="Counterparty"><Input value={f.counterparty} onChange={set("counterparty")} /></Field>
        <Field label="Description" className="sm:col-span-2"><Input value={f.description} onChange={set("description")} /></Field>
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={f.recurring} onChange={set("recurring")} /> Recurring revenue</label>
        <div className="sm:col-span-2"><p className="text-xs text-muted">Recorded as <strong>unverified</strong>. It counts only after you verify it against evidence under RED.</p><ErrorText>{a.error}</ErrorText></div>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={a.busy}>Record</Button></div>
      </form>
    </Modal>
  );
}

function VerifyForm({ tx, onClose }: { tx: any; onClose: () => void }) {
  const [method, setMethod] = useState("bank_statement");
  const [evidence, setEvidence] = useState("");
  const a = useAction();
  if (!tx) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = tx.mode === "verify"
      ? await a.run(() => post(`/api/transactions/${tx.id}/verify`, { method, evidence }))
      : await a.run(() => post(`/api/transactions/${tx.id}/reject`, { reason: evidence }));
    if (ok) { setEvidence(""); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title={`${tx.mode === "verify" ? "Verify" : "Reject"} transaction #${tx.id} · ${eur(tx.eur_cents, 2)}`} tone="red">
      <form onSubmit={submit} className="space-y-3">
        {tx.mode === "verify" && <Field label="Verification method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{["bank_statement", "processor_dashboard", "onchain_explorer", "receipt", "other"].map((m) => <option key={m}>{m}</option>)}</Select></Field>}
        <Field label={tx.mode === "verify" ? "Evidence reference" : "Reason"} hint={tx.mode === "verify" ? "e.g. statement line, processor payout ID, explorer URL" : undefined}><Input value={evidence} onChange={(e) => setEvidence(e.target.value)} required minLength={3} /></Field>
        <ErrorText>{a.error}</ErrorText>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button variant={tx.mode === "verify" ? "primary" : "danger"} disabled={a.busy}>{tx.mode === "verify" ? "Mark verified" : "Reject"}</Button></div>
      </form>
    </Modal>
  );
}

function Invoices() {
  const { data } = useQuery<any[]>("/api/invoices");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ number: "", client_name: "", issue_date: today(), due_date: today(), amount: "", notes: "" });
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await a.run(() => post("/api/invoices", { ...f, amount_cents: toCents(f.amount) }))) setOpen(false);
  };
  return (
    <Card title="Invoices" actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>New invoice</Button>}>
      <DataTable rows={data ?? []} columns={[
        { key: "number", label: "Number", render: (r) => <span className="font-mono">{r.number}</span> },
        { key: "client_name", label: "Client" },
        { key: "issue_date", label: "Issued", render: (r) => d(r.issue_date) },
        { key: "due_date", label: "Due", render: (r) => <span className={r.status === "sent" && new Date(r.due_date) < new Date() ? "text-serious" : ""}>{d(r.due_date)}</span> },
        { key: "amount_cents", label: "Amount", align: "right", render: (r) => `${eur(r.amount_cents, 2)} ${r.currency !== "EUR" ? r.currency : ""}` },
        { key: "paid_cents", label: "Verified paid", align: "right", render: (r) => eur(r.paid_cents, 2) },
        { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
        { key: "act", label: "", render: (r) => (
          <Select aria-label="Set status" value={r.status} onChange={(e) => patch(`/api/invoices/${r.id}/status`, { status: e.target.value })} className="h-7 w-24 text-xs">
            {["draft", "sent", "paid", "void"].map((s) => <option key={s}>{s}</option>)}
          </Select>
        ) },
      ]} />
      <Modal open={open} onClose={() => setOpen(false)} title="New invoice (draft)">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Number"><Input value={f.number} onChange={set("number")} required /></Field>
            <Field label="Amount (EUR)"><Input inputMode="decimal" value={f.amount} onChange={set("amount")} required /></Field>
          </div>
          <Field label="Client"><Input value={f.client_name} onChange={set("client_name")} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Issue date"><Input type="date" value={f.issue_date} onChange={set("issue_date")} /></Field>
            <Field label="Due date"><Input type="date" value={f.due_date} onChange={set("due_date")} /></Field>
          </div>
          <Field label="Notes"><Textarea value={f.notes} onChange={set("notes")} /></Field>
          <ErrorText>{a.error}</ErrorText>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={a.busy}>Create</Button></div>
        </form>
      </Modal>
    </Card>
  );
}

function Cycles() {
  const { data } = useQuery<any[]>("/api/cycles");
  const [plan, setPlan] = useState<Record<string, string>>({});
  const a = useAction();
  if (!data?.length) return <Empty>No cycles yet. The scheduler opens one each month.</Empty>;
  return (
    <div className="space-y-4">
      {data.map((c) => (
        <Card key={c.month} title={<span className="flex items-center gap-2">{c.month} <StatusBadge status={c.status} /></span>} actions={<span className="text-xs text-muted num">target {eur(c.target_cents)}</span>}>
          {c.review ? (
            <div className="space-y-3">
              <div className="text-sm text-ink">Shortfall <strong className="text-serious num">{eur(c.review.shortfall_cents)}</strong> · verified {eur(c.review.kpis?.verified_revenue_cents)}</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">{c.review.findings.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
              <p className="text-xs text-muted">{c.review.note}</p>
              {c.review.recovery_plan && <div className="rounded-lg border border-line bg-bg p-3 text-sm whitespace-pre-wrap text-ink-2"><Badge tone="blue" className="mb-1">Recovery plan</Badge><div>{c.review.recovery_plan}</div></div>}
              {c.status === "review" && (
                <div className="space-y-2">
                  <Textarea aria-label="Recovery plan" placeholder="Recovery plan: revised strategy, targets, deadlines, owners…" value={plan[c.month] ?? ""} onChange={(e) => setPlan({ ...plan, [c.month]: e.target.value })} />
                  <ErrorText>{a.error}</ErrorText>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={a.busy} onClick={() => a.run(() => post(`/api/cycles/${c.month}/recovery-plan`, { plan: plan[c.month] ?? "", acknowledge: false }))}>Save plan</Button>
                    <Button size="sm" variant="primary" disabled={a.busy} onClick={() => a.run(() => post(`/api/cycles/${c.month}/recovery-plan`, { plan: plan[c.month] || c.review.recovery_plan || "", acknowledge: true }))}>Approve plan & close review</Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {(c.plan?.actions ?? []).map((x: any, i: number) => <li key={i} className="flex gap-2"><Badge tone={x.priority === 1 ? "blue" : "neutral"}>P{x.priority}</Badge><span className="text-ink-2">{x.action}</span></li>)}
              {!c.plan?.actions?.length && <li className="text-muted">No plan actions.</li>}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
