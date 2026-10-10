import { useState, type FormEvent } from "react";
import { del, dt, post } from "../api";
import { useAction, useQuery } from "../hooks";
import { useShell } from "../App";
import { Button, Card, DataTable, Empty, ErrorText, Field, Input, Modal, PageHeader, StatusBadge, Tabs, Textarea } from "../ui";

export function Research() {
  const [tab, setTab] = useState<"reports" | "knowledge">("reports");
  return (
    <div>
      <PageHeader title="Research & knowledge" subtitle="Live web research with cited sources, plus a searchable knowledge base. Facts, assessments, assumptions and unknowns are kept separate." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "reports", label: "Research reports" }, { value: "knowledge", label: "Knowledge base" }]} />
      {tab === "reports" ? <Reports /> : <Knowledge />}
    </div>
  );
}

function Reports() {
  const { me } = useShell();
  const { data } = useQuery<any[]>("/api/research", { intervalMs: 8000 });
  const [q, setQ] = useState("");
  const [view, setView] = useState<any>(null);
  const a = useAction();
  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (await a.run(() => post("/api/research", { question: q }))) setQ("");
  };
  return (
    <div className="space-y-4">
      <Card title="New research">
        <form onSubmit={start} className="space-y-2">
          <Textarea aria-label="Research question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Which taxi and logistics companies in Kosovo lack dispatch software, and what do competitors charge?" />
          {!me.llm.available && <p className="text-xs text-warn">◐ Web research needs the language-model provider: {me.llm.reason}</p>}
          <ErrorText>{a.error}</ErrorText>
          <Button variant="primary" disabled={a.busy || q.trim().length < 5}>Start research</Button>
        </form>
      </Card>
      <Card title="Reports">
        <DataTable rows={data ?? []} onRowClick={setView} columns={[
          { key: "question", label: "Question", render: (r) => <span className="text-ink">{r.question}</span> },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          { key: "sources", label: "Sources", align: "right", render: (r) => (r.sources ?? []).length },
          { key: "created_at", label: "Started", render: (r) => dt(r.created_at) },
        ]} />
      </Card>
      {view && (
        <Modal open onClose={() => setView(null)} title={view.question} wide>
          {view.error && <ErrorText>{view.error}</ErrorText>}
          {view.report ? <article className="max-h-[55vh] overflow-y-auto rounded-lg bg-bg p-4 text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{view.report}</article> : <Empty>{view.status === "running" ? "Research in progress…" : "No report."}</Empty>}
          {(view.sources ?? []).length > 0 && (
            <div className="mt-3"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Sources retrieved</div>
              <ul className="space-y-1 text-xs">{view.sources.map((s: any) => <li key={s.url}><a className="text-accent underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> {s.page_age && <span className="text-muted">· {s.page_age}</span>}</li>)}</ul>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Knowledge() {
  const docs = useQuery<any[]>("/api/knowledge/documents");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState({ title: "", content: "", source_url: "" });
  const [noteOpen, setNoteOpen] = useState(false);
  const a = useAction();
  const search = async (e: FormEvent) => {
    e.preventDefault();
    const r = await a.run(() => fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}`).then((x) => x.json()));
    if (r) setHits(r);
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Search knowledge">
          <form onSubmit={search} className="flex gap-2"><Input aria-label="Search query" value={q} onChange={(e) => setQ(e.target.value)} placeholder="dispatch pricing" /><Button disabled={!q}>Search</Button></form>
          {hits && (
            <ul className="mt-3 space-y-3">
              {hits.length === 0 && <li className="text-sm text-muted">No matches.</li>}
              {hits.map((h, i) => (
                <li key={i} className="text-sm">
                  <div className="text-ink">{h.title}</div>
                  <div className="text-xs text-ink-2" dangerouslySetInnerHTML={{ __html: h.snippet.replace(/[<>&]/g, (c: string) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!).replace(/&lt;b&gt;/g, "<b class='text-ink'>").replace(/&lt;\/b&gt;/g, "</b>") }} />
                  <div className="text-[11px] text-muted">{h.source_url ?? "note"} · retrieved {dt(h.retrieved_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Ingest">
          <form onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => post("/api/knowledge/ingest", { url }))) setUrl(""); }} className="space-y-2">
            <Field label="Public URL" hint="Fetched once, stored with source URL and retrieval date. Private/internal addresses are blocked."><Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
            <div className="flex gap-2"><Button variant="primary" disabled={!url || a.busy}>Fetch & index</Button><Button type="button" onClick={() => setNoteOpen(true)}>Add note</Button></div>
          </form>
          <ErrorText>{a.error}</ErrorText>
        </Card>
      </div>
      <Card title="Documents">
        <DataTable rows={docs.data ?? []} columns={[
          { key: "title", label: "Title", render: (r) => <span className="text-ink">{r.title}</span> },
          { key: "source_type", label: "Type" },
          { key: "source_url", label: "Source", render: (r) => r.source_url ? <a className="text-accent underline" href={r.source_url} target="_blank" rel="noreferrer noopener">{new URL(r.source_url).hostname}</a> : "—" },
          { key: "content_chars", label: "Chars", align: "right" },
          { key: "retrieved_at", label: "Retrieved", render: (r) => dt(r.retrieved_at) },
          { key: "x", label: "", render: (r) => <Button size="sm" variant="ghost" onClick={() => del(`/api/knowledge/documents/${r.id}`)}>Delete</Button> },
        ]} />
      </Card>
      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="Add knowledge note" wide>
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await a.run(() => post("/api/knowledge/notes", { title: note.title, content: note.content, source_url: note.source_url || null }))) { setNote({ title: "", content: "", source_url: "" }); setNoteOpen(false); } }}>
          <Field label="Title"><Input value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} required /></Field>
          <Field label="Source URL (optional)"><Input type="url" value={note.source_url} onChange={(e) => setNote({ ...note, source_url: e.target.value })} /></Field>
          <Field label="Content"><Textarea className="min-h-48" value={note.content} onChange={(e) => setNote({ ...note, content: e.target.value })} required /></Field>
          <ErrorText>{a.error}</ErrorText>
          <div className="flex justify-end"><Button variant="primary" disabled={a.busy}>Index note</Button></div>
        </form>
      </Modal>
    </div>
  );
}
