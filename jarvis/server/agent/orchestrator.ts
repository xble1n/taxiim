import { audit } from "../audit.ts";
import { HttpError, type AppContext } from "../context.ts";
import { num } from "../db.ts";
import { logEvent } from "../events.ts";
import { computeMonthKpis, monthOf } from "../business/ledger.ts";
import { estimateCostUsd } from "../llm/anthropic.ts";
import type { ContentBlock, LlmMessage, LlmResponse } from "../llm/provider.ts";
import { contextMemories } from "../memory.ts";
import { invokeTool, type InvokeResult, type ToolRegistry } from "../policy/engine.ts";
import { redact } from "../security/redact.ts";
import { getSettings } from "../settings.ts";
import { RED_CODEWORD } from "../auth/red.ts";
import { PERSONA } from "./persona.ts";

export interface ToolEvent { tool: string; input: unknown; result: InvokeResult }
export type ChatResult =
  | { type: "red_challenge"; conversationId: number | null; message: string }
  | { type: "reply"; conversationId: number; text: string; toolEvents: ToolEvent[]; stopReason: string };

export async function recordUsage(ctx: AppContext, purpose: string, r: LlmResponse | null, latency: number, ok: boolean) {
  const model = r?.model ?? ctx.llm.model;
  const u = r?.usage ?? { input_tokens: 0, output_tokens: 0, web_searches: 0 };
  await ctx.db.query(
    `INSERT INTO llm_usage (provider, model, purpose, input_tokens, output_tokens, web_searches, est_cost_usd, latency_ms, ok)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.llm.name, model, purpose, u.input_tokens, u.output_tokens, u.web_searches, estimateCostUsd(model, u.input_tokens, u.output_tokens, u.web_searches), latency, ok]);
}

export async function monthLlmSpend(ctx: AppContext) {
  const [r] = await ctx.db.query<{ s: unknown }>("SELECT COALESCE(SUM(est_cost_usd),0) AS s FROM llm_usage WHERE to_char(ts,'YYYY-MM') = $1", [monthOf(ctx.now())]);
  return num(r.s);
}

export async function assertLlmReady(ctx: AppContext) {
  if (!ctx.llm.available()) throw new HttpError(503, "llm_unavailable", ctx.llm.unavailableReason() ?? "No LLM provider configured.");
  const { llm_monthly_budget_usd } = await getSettings(ctx.db);
  const spent = await monthLlmSpend(ctx);
  if (spent >= llm_monthly_budget_usd) {
    throw new HttpError(402, "llm_budget", `Monthly LLM budget of $${llm_monthly_budget_usd} reached ($${spent.toFixed(2)} spent). Raise it in Settings.`);
  }
}

async function systemPrompt(ctx: AppContext) {
  const mems = await contextMemories(ctx);
  const k = await computeMonthKpis(ctx, monthOf(ctx.now()));
  const memText = mems.length ? mems.map((m) => `- [${m.kind} #${m.id}] ${m.content}`).join("\n") : "- (none yet)";
  return `${PERSONA}

Current date (UTC): ${ctx.now().toISOString().slice(0, 10)}
Month ${k.month}: verified revenue €${(k.verified_revenue_cents / 100).toFixed(2)} of €${(k.target_cents / 100).toFixed(0)} target; remaining €${(k.remaining_cents / 100).toFixed(2)}.

Owner memories (owner-approved context; may be edited by the owner):
${memText}`;
}

async function loadHistory(ctx: AppContext, conversationId: number): Promise<LlmMessage[]> {
  const rows = await ctx.db.query<{ role: "user" | "assistant"; content: ContentBlock[] | string }>(
    "SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY id", [conversationId]);
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

async function append(ctx: AppContext, conversationId: number, role: "user" | "assistant", content: string | ContentBlock[]) {
  await ctx.db.query("INSERT INTO chat_messages (conversation_id, role, content) VALUES ($1,$2,$3::jsonb)", [conversationId, role, JSON.stringify(content)]);
}

/**
 * Operator chat. The literal codeword RED typed by the authenticated owner
 * opens a step-up challenge; it never reaches the model and the model has
 * no tool that can activate RED.
 */
export async function chat(ctx: AppContext, registry: ToolRegistry, input: { conversationId?: number | null; message: string }): Promise<ChatResult> {
  const message = input.message.trim();
  if (!message) throw new HttpError(400, "empty", "Message is empty.");
  if (message === RED_CODEWORD) {
    await audit(ctx.db, { actor: "owner", action: "red.invoked", category: "security", outcome: "pending" });
    return { type: "red_challenge", conversationId: input.conversationId ?? null, message: "RED PROTOCOL requested. Confirm with a fresh authenticator code." };
  }
  await assertLlmReady(ctx);

  let conversationId = input.conversationId ?? null;
  if (!conversationId) {
    const [c] = await ctx.db.query<{ id: number }>("INSERT INTO conversations (title) VALUES ($1) RETURNING id", [message.slice(0, 80)]);
    conversationId = c.id;
  } else {
    const c = await ctx.db.query("SELECT id FROM conversations WHERE id = $1", [conversationId]);
    if (!c.length) throw new HttpError(404, "not_found", "Conversation not found.");
  }
  await append(ctx, conversationId, "user", [{ type: "text", text: message }]);

  const { agent_max_tool_calls } = await getSettings(ctx.db);
  const system = await systemPrompt(ctx);
  const tools = registry.specs();
  const toolEvents: ToolEvent[] = [];
  let finalText = "";
  let stop = "other";

  for (let iteration = 0; iteration < agent_max_tool_calls + 4; iteration++) {
    const messages = await loadHistory(ctx, conversationId);
    const t0 = Date.now();
    let resp: LlmResponse;
    try {
      resp = await ctx.llm.complete({ purpose: "chat", system, messages, tools, webSearch: { maxUses: 5 } });
      await recordUsage(ctx, "chat", resp, Date.now() - t0, true);
    } catch (e) {
      await recordUsage(ctx, "chat", null, Date.now() - t0, false);
      await logEvent(ctx.db, "error", "llm", e instanceof Error ? e.message : String(e));
      throw new HttpError(502, "llm_error", "The language model request failed. See system events for details.");
    }
    await append(ctx, conversationId, "assistant", resp.content);
    stop = resp.stopReason;
    if (resp.text) finalText = resp.text;
    if (resp.stopReason === "pause_turn") continue;
    if (resp.stopReason !== "tool_use" || !resp.toolCalls.length) break;

    if (toolEvents.length + resp.toolCalls.length > agent_max_tool_calls) {
      const results = resp.toolCalls.map((c) => ({ type: "tool_result", tool_use_id: c.id, is_error: true, content: "Tool-call budget for this turn exhausted. Summarise progress for the owner." }));
      await append(ctx, conversationId, "user", results);
      continue;
    }
    const results: ContentBlock[] = [];
    for (const call of resp.toolCalls) {
      const result = await invokeTool(ctx, registry, call.name, call.input, "jarvis");
      toolEvents.push({ tool: call.name, input: redact(call.input), result });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        is_error: result.status === "denied" || result.status === "failed",
        content: JSON.stringify(redact(result)).slice(0, 60_000),
      });
    }
    await append(ctx, conversationId, "user", results);
  }
  if (stop === "refusal") finalText ||= "The model declined this request.";
  return { type: "reply", conversationId, text: finalText, toolEvents, stopReason: stop };
}

export async function listConversations(ctx: AppContext) {
  return ctx.db.query("SELECT c.id, c.title, c.created_at, COUNT(m.id) AS messages FROM conversations c LEFT JOIN chat_messages m ON m.conversation_id = c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 100");
}

/** Owner-readable transcript (text + tool calls; raw provider blocks are kept in the DB). */
export async function conversationTranscript(ctx: AppContext, id: number) {
  const rows = await ctx.db.query<{ id: number; role: string; content: ContentBlock[]; created_at: Date }>(
    "SELECT id, role, content, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY id", [id]);
  const out: { id: number; role: string; kind: string; text: string; created_at: Date }[] = [];
  for (const r of rows) {
    for (const b of Array.isArray(r.content) ? r.content : []) {
      if (b.type === "text" && String(b.text).trim()) out.push({ id: r.id, role: r.role, kind: "text", text: String(b.text), created_at: r.created_at });
      else if (b.type === "tool_use") out.push({ id: r.id, role: r.role, kind: "tool_use", text: `${b.name}(${JSON.stringify(redact(b.input)).slice(0, 400)})`, created_at: r.created_at });
      else if (b.type === "tool_result") out.push({ id: r.id, role: r.role, kind: "tool_result", text: String(b.content).slice(0, 600), created_at: r.created_at });
      else if (b.type === "server_tool_use") out.push({ id: r.id, role: r.role, kind: "web_search", text: JSON.stringify(b.input), created_at: r.created_at });
    }
  }
  return out;
}

export async function deleteConversation(ctx: AppContext, id: number) {
  await ctx.db.query("DELETE FROM conversations WHERE id = $1", [id]);
  await audit(ctx.db, { actor: "owner", action: "conversation.delete", category: "data", target: `conv:${id}`, outcome: "success" });
}
