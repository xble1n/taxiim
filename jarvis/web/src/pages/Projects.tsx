import { useState, type FormEvent } from "react";
import { d, patch, post } from "../api";
import { useAction, useQuery } from "../hooks";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Modal, PageHeader, Select, Textarea } from "../ui";

const TASK_STATUS = ["todo", "in_progress", "blocked", "done"];

export function Projects() {
  const { data } = useQuery<{ projects: any[]; tasks: any[] }>("/api/projects");
  const [projOpen, setProjOpen] = useState(false);
  const [taskFor, setTaskFor] = useState<number | null | undefined>(undefined);
  const projects = data?.projects ?? [];
  const tasks = data?.tasks ?? [];
  const groups = [...projects.map((p) => ({ p, tasks: tasks.filter((t) => t.project_id === p.id) })), { p: null as any, tasks: tasks.filter((t) => !t.project_id) }];
  const counts = TASK_STATUS.map((s) => ({ s, n: tasks.filter((t) => t.status === s).length }));
  return (
    <div>
      <PageHeader title="Projects & tasks" subtitle={<span className="flex flex-wrap gap-2">{counts.map((c) => <Badge key={c.s}>{c.s.replace("_", " ")} {c.n}</Badge>)}</span>}
        actions={<><Button onClick={() => setTaskFor(null)}>New task</Button><Button variant="primary" onClick={() => setProjOpen(true)}>New project</Button></>} />
      <div className="space-y-4">
        {projects.length === 0 && tasks.length === 0 && <Empty>No projects yet.</Empty>}
        {groups.filter((g) => g.p || g.tasks.length).map((g) => (
          <Card key={g.p?.id ?? "none"} title={g.p ? <span className="flex items-center gap-2 normal-case tracking-normal text-ink">{g.p.name} <Badge>P{g.p.priority}</Badge></span> : "Unassigned tasks"}
            actions={g.p && <>
              <Select aria-label="Project status" value={g.p.status} onChange={(e) => patch(`/api/projects/${g.p.id}`, { status: e.target.value })} className="h-7 w-28 text-xs">{["active", "paused", "done", "dropped"].map((s) => <option key={s}>{s}</option>)}</Select>
              <Button size="sm" onClick={() => setTaskFor(g.p.id)}>Add task</Button>
            </>}>
            {g.p?.description && <p className="mb-3 text-sm text-ink-2">{g.p.description}</p>}
            {g.tasks.length === 0 ? <p className="text-sm text-muted">No tasks.</p> : (
              <ul className="divide-y divide-line">
                {g.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <input type="checkbox" aria-label="Done" checked={t.status === "done"} onChange={(e) => patch(`/api/tasks/${t.id}`, { status: e.target.checked ? "done" : "todo" })} />
                    <span className={t.status === "done" ? "text-muted line-through" : "text-ink"}>{t.title}</span>
                    <Badge>P{t.priority}</Badge>
                    {t.due_on && <span className="text-xs text-muted">due {d(t.due_on)}</span>}
                    {t.blocked_reason && <span className="text-xs text-serious">■ {t.blocked_reason}</span>}
                    <span className="ml-auto text-[11px] text-muted">{t.created_by}</span>
                    <Select aria-label="Task status" value={t.status} onChange={(e) => patch(`/api/tasks/${t.id}`, { status: e.target.value })} className="h-7 w-32 text-xs">{TASK_STATUS.map((s) => <option key={s}>{s}</option>)}</Select>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
      <ProjectForm open={projOpen} onClose={() => setProjOpen(false)} />
      {taskFor !== undefined && <TaskForm projectId={taskFor} projects={projects} onClose={() => setTaskFor(undefined)} />}
    </div>
  );
}

function ProjectForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ name: "", description: "", priority: "3" });
  const a = useAction();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await a.run(() => post("/api/projects", { ...f, priority: Number(f.priority) }))) { setF({ name: "", description: "", priority: "3" }); onClose(); } };
  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Priority (1 = highest)"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{[1, 2, 3, 4, 5].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <ErrorText>{a.error}</ErrorText>
        <div className="flex justify-end"><Button variant="primary" disabled={a.busy}>Create</Button></div>
      </form>
    </Modal>
  );
}

function TaskForm({ projectId, projects, onClose }: { projectId: number | null; projects: any[]; onClose: () => void }) {
  const [f, setF] = useState({ title: "", project_id: projectId ? String(projectId) : "", priority: "3", due_on: "" });
  const a = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await a.run(() => post("/api/tasks", { title: f.title, project_id: f.project_id ? Number(f.project_id) : null, priority: Number(f.priority), due_on: f.due_on || null }))) onClose();
  };
  return (
    <Modal open onClose={onClose} title="New task">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
        <Field label="Project"><Select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{[1, 2, 3, 4, 5].map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="Due"><Input type="date" value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} /></Field>
        </div>
        <ErrorText>{a.error}</ErrorText>
        <div className="flex justify-end"><Button variant="primary" disabled={a.busy}>Create</Button></div>
      </form>
    </Modal>
  );
}
