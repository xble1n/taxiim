import { useEffect, useRef, useState, type FormEvent } from "react";
import { del, get, post } from "../api";
import { useAction, useQuery } from "../hooks";
import { useShell } from "../App";
import { Badge, Button, cx, Empty, ErrorText, PageHeader, StatusBadge, Textarea } from "../ui";

interface Line { role: string; kind: string; text: string; status?: string }

export function Operator() {
  const { me, openRed } = useShell();
  const convs = useQuery<any[]>("/api/conversations", { refreshOnMutation: false });
  const [active, setActive] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [msg, setMsg] = useState("");
  const a = useAction();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) { setLines([]); return; }
    get<any[]>(`/api/conversations/${active}`).then((t) => setLines(t.map((x) => ({ role: x.role, kind: x.kind, text: x.text }))));
  }, [active]);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [lines]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = msg.trim();
    if (!text) return;
    setMsg("");
    setLines((l) => [...l, { role: "user", kind: "text", text }]);
    const r = await a.run(() => post<any>("/api/chat", { conversationId: active, message: text }));
    if (!r) return;
    if (r.type === "red_challenge") {
      setLines((l) => [...l, { role: "system", kind: "text", text: r.message }]);
      openRed();
      return;
    }
    setLines((l) => [
      ...l,
      ...r.toolEvents.map((t: any) => ({ role: "assistant", kind: "tool", text: `${t.tool}`, status: t.result.status })),
      { role: "assistant", kind: "text", text: r.text || "(no text)" },
    ]);
    if (!active) { setActive(r.conversationId); void convs.reload(); }
  };

  return (
    <div>
      <PageHeader title="Operator" subtitle="Direct line to JARVIS. Tools are permission-gated by the backend; typing RED opens the step-up challenge." />
      {!me.llm.available && <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink">◐ <strong className="text-warn">Language model not configured.</strong> {me.llm.reason} Typing <code>RED</code> still works.</div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-xl border border-line bg-panel p-2 lg:h-[calc(100vh-210px)] lg:overflow-y-auto">
          <Button size="sm" variant="primary" className="mb-2 w-full" onClick={() => setActive(null)}>New conversation</Button>
          {(convs.data ?? []).map((c) => (
            <div key={c.id} className={cx("group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm", active === c.id ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-panel-2")}>
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => setActive(c.id)}>{c.title}</button>
              <button aria-label="Delete conversation" className="text-muted opacity-0 group-hover:opacity-100 hover:text-critical" onClick={async () => { await del(`/api/conversations/${c.id}`); if (active === c.id) setActive(null); void convs.reload(); }}>✕</button>
            </div>
          ))}
        </aside>
        <section className="flex min-h-[60vh] flex-col rounded-xl border border-line bg-panel lg:h-[calc(100vh-210px)]">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {lines.length === 0 && <Empty>Ask for a status briefing, a market analysis, a proposal draft, or lead qualification.</Empty>}
            {lines.map((l, i) =>
              l.kind === "tool" || l.kind === "tool_use" ? (
                <div key={i} className="flex items-center gap-2 pl-1 font-mono text-[11px] text-muted"><span>⚙ {l.text.slice(0, 160)}</span>{l.status && <StatusBadge status={l.status} />}</div>
              ) : l.kind === "tool_result" || l.kind === "web_search" ? (
                <div key={i} className="truncate pl-1 font-mono text-[11px] text-muted">{l.kind === "web_search" ? "⌕ " : "↳ "}{l.text}</div>
              ) : (
                <div key={i} className={cx("max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap", l.role === "user" ? "ml-auto bg-accent-strong/90 text-white" : l.role === "system" ? "mx-auto border border-red/50 bg-red/10 text-ink" : "border border-line bg-panel-2 text-ink")}>
                  {l.role === "assistant" && <Badge tone="blue" className="mb-1.5">JARVIS</Badge>}
                  <div>{l.text}</div>
                </div>
              ),
            )}
            {a.busy && <div className="text-xs text-muted">JARVIS is working…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="border-t border-line p-3">
            <ErrorText>{a.error}</ErrorText>
            <div className="mt-1 flex gap-2">
              <Textarea aria-label="Message" value={msg} onChange={(e) => setMsg(e.target.value)} className="min-h-11 flex-1" rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="Message JARVIS…  (Enter to send, Shift+Enter for newline)" />
              <Button variant="primary" disabled={a.busy || !msg.trim()} className="self-end">Send</Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
