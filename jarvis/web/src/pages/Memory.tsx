import { useState, type FormEvent } from "react";
import { del, dt, patch, post } from "../api";
import { useAction, useQuery } from "../hooks";
import { useRedGate } from "../App";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Modal, PageHeader, Select, Textarea } from "../ui";

const KINDS = ["preference", "decision", "project", "config", "lesson", "fact", "business"];

export function Memory() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const { data } = useQuery<any[]>(`/api/memories${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const [edit, setEdit] = useState<any>(null);
  const gate = useRedGate();
  const a = useAction();
  const rows = (data ?? []).filter((m) => !kind || m.kind === kind);
  return (
    <div>
      <PageHeader title="Memory" subtitle="Everything JARVIS remembers about you and your business. Inspect, correct, export or delete any of it."
        actions={<>
          <a href="/api/memories/export"><Button>Export JSON</Button></a>
          <Button variant="danger" onClick={() => gate(() => { if (confirm("Delete ALL memories permanently?")) void a.run(() => del("/api/memories")); })}>Delete all</Button>
          <Button variant="primary" onClick={() => setEdit({ kind: "preference", content: "", tags: "", pinned: false })}>Add memory</Button>
        </>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search memories" placeholder="Search memories…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-40"><option value="">All kinds</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</Select>
      </div>
      <ErrorText>{a.error}</ErrorText>
      {rows.length === 0 ? <Empty>No memories{q ? " match" : " yet"}.</Empty> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((m) => (
            <Card key={m.id} className={m.pinned ? "border-accent/40" : ""}>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="blue">{m.kind}</Badge>
                {m.pinned && <Badge>pinned</Badge>}
                <Badge tone={m.source === "owner" ? "neutral" : "warn"}>by {m.source}</Badge>
                {(m.tags ?? []).map((t: string) => <Badge key={t}>#{t}</Badge>)}
              </div>
              <p className="text-sm whitespace-pre-wrap text-ink">{m.content}</p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                <span>{dt(m.updated_at)}</span>
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => patch(`/api/memories/${m.id}`, { pinned: !m.pinned })}>{m.pinned ? "Unpin" : "Pin"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit({ ...m, tags: (m.tags ?? []).join(", ") })}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => del(`/api/memories/${m.id}`)}>Delete</Button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <MemoryForm initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function MemoryForm({ initial, onClose }: { initial: any; onClose: () => void }) {
  const [f, setF] = useState(initial);
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { kind: f.kind, content: f.content, pinned: !!f.pinned, tags: String(f.tags).split(",").map((t: string) => t.trim()).filter(Boolean) };
    if (await a.run(() => (f.id ? patch(`/api/memories/${f.id}`, body) : post("/api/memories", body)))) onClose();
  };
  return (
    <Modal open onClose={onClose} title={f.id ? `Edit memory #${f.id}` : "Add memory"}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Kind"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <Field label="Content" hint="Never store passwords, keys or seed phrases — they are refused."><Textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} required minLength={3} /></Field>
        <Field label="Tags (comma separated)"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={!!f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Pin (always included in JARVIS's context)</label>
        <ErrorText>{a.error}</ErrorText>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={a.busy}>Save</Button></div>
      </form>
    </Modal>
  );
}
