import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, LlmProvider, LlmRequest, LlmResponse } from "./provider.ts";

/** Approximate list prices (USD per 1M tokens) for cost monitoring only. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-1": [10, 50],
};

export function estimateCostUsd(model: string, input: number, output: number, searches: number) {
  const [i, o] = PRICES[model] ?? [4, 20];
  return (input / 1e6) * i + (output / 1e6) * o + searches * 0.01;
}

export class AnthropicProvider implements LlmProvider {
  name = "anthropic";
  model: string;
  private client: Anthropic;
  private effort: "low" | "medium" | "high" | "xhigh" | "max";

  constructor(opts: { apiKey: string; model: string; effort: AnthropicProvider["effort"] }) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 10 * 60_000 });
    this.model = opts.model;
    this.effort = opts.effort;
  }
  available() {
    return true;
  }
  unavailableReason() {
    return null;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const tools: unknown[] = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
    if (req.webSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: req.webSearch.maxUses });

    // Server-side refusal fallback ("default" routes by refusal category) is enabled by default.
    const params = {
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: req.messages,
      tools,
      output_config: { effort: this.effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    // SDK typings may lag the newest beta fields; the request shape follows the API docs.
    const msg = (await this.client.beta.messages.create(params as never)) as unknown as {
      content: ContentBlock[]; stop_reason: string; model: string;
      usage: { input_tokens: number; output_tokens: number; server_tool_use?: { web_search_requests?: number } };
    };

    const content = msg.content;
    const text = content.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n").trim();
    const toolCalls = content.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), name: String(b.name), input: b.input }));
    const sources: LlmResponse["sources"] = [];
    for (const b of content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content as Record<string, unknown>[]) {
          if (r.type === "web_search_result") sources.push({ url: String(r.url), title: String(r.title ?? r.url), page_age: (r.page_age as string) ?? null });
        }
      }
    }
    const stop = ["end_turn", "tool_use", "pause_turn", "max_tokens", "refusal"].includes(msg.stop_reason)
      ? (msg.stop_reason as LlmResponse["stopReason"]) : "other";
    return {
      content, text, toolCalls, stopReason: stop, sources, model: msg.model,
      usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, web_searches: msg.usage.server_tool_use?.web_search_requests ?? 0 },
    };
  }
}
