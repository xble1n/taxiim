import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getChat, postChat } from "@/lib/taxi/api";
import { isFail, when } from "@/lib/taxi/format";
import { Banner, Btn, Empty } from "./ui";

export function ChatBox({ meId, compact = false }: { meId?: string; compact?: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const chat = useQuery({
    queryKey: ["chat"],
    queryFn: () => getChat(),
    refetchInterval: 2500,
  });
  const messages = chat.data && !isFail(chat.data) && chat.data.success ? chat.data.messages : [];
  const online = chat.data && !isFail(chat.data) && chat.data.success ? chat.data.online : [];

  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!meId || messages.length === 0) return;
    const key = `taxiim-chat:${meId}`;
    if (!compact) {
      const last = messages[messages.length - 1]?.createdAt;
      if (last) {
        try {
          localStorage.setItem(key, last);
        } catch {
          /* Safari private mode can refuse storage. */
        }
        window.dispatchEvent(new Event("taxiim-chat-seen"));
      }
      setUnread(0);
      return;
    }
    let seen = "";
    try {
      seen = localStorage.getItem(key) ?? "";
    } catch {
      seen = "";
    }
    setUnread(messages.filter((m) => m.senderId !== meId && m.createdAt > seen).length);
  }, [messages, meId, compact]);

  async function send() {
    setError(null);
    setBusy(true);
    const res = await postChat({ data: { body } });
    setBusy(false);
    if (isFail(res) || !res.success) {
      setError(isFail(res) ? res.message : "Message was not sent.");
      return;
    }
    setBody("");
    void qc.invalidateQueries({ queryKey: ["chat"] });
  }

  return (
    <div className="flex h-full min-h-64 flex-col">
      <p className="border-b border-line px-3 py-2 text-xs text-muted">
        {online.length ? `${online.length} on duty` : "No one on duty"}
        {online.length ? ` · ${online.map((p) => p.name.split(" ")[0]).join(", ")}` : ""}
        {unread > 0 ? ` · ${unread} new` : ""}
      </p>
      <div ref={scroller} className={`flex-1 space-y-3 overflow-auto px-3 py-3 ${compact ? "max-h-64" : "min-h-0"}`}>
        {chat.isError ? <Banner>{chat.error instanceof Error ? chat.error.message : "Chat unavailable."}</Banner> : null}
        {!chat.isLoading && messages.length === 0 ? <Empty title="No messages yet" body="The group channel is open to administrators and drivers." /> : null}
        {messages.map((m) => {
          const mine = m.senderId === meId;
          return (
            <article key={m.id} className="w-full min-w-0">
              <p className={`text-xs text-muted ${mine ? "text-right" : ""}`}>
                <span className={m.senderRole === "ADMIN" ? "text-accent" : "text-fg"}>{m.senderName}</span>
                <span> · {m.senderRole === "ADMIN" ? "Control" : "Driver"} · {when(m.createdAt)}</span>
              </p>
              <p className={`mt-1 w-fit max-w-full border border-line bg-bg px-3 py-2 text-left text-sm break-words text-pretty ${mine ? "ml-auto" : ""}`}>{m.body}</p>
            </article>
          );
        })}
      </div>
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && body.trim()) void send();
        }}
      >
        <input
          value={body}
          maxLength={500}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message the fleet"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 text-base outline-none focus:border-accent md:text-sm"
        />
        <Btn type="submit" disabled={busy || !body.trim()}>
          Send
        </Btn>
      </form>
      {error ? <p className="px-3 pb-3 text-xs text-danger">{error}</p> : null}
      <p className="px-3 pb-2 text-right font-mono text-xs text-muted tabular-nums">{body.length}/500</p>
    </div>
  );
}
