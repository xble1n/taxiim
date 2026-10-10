/**
 * Provider-independent LLM boundary. The orchestrator talks only to this
 * interface; swapping vendors means adding another implementation, not
 * rewriting the agent. Tools are executed by JARVIS, never by the provider
 * (except provider-hosted read-only web search, which is LEVEL 1).
 */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ContentBlock = Record<string, unknown> & { type: string };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface LlmRequest {
  purpose: string;
  system: string;
  messages: LlmMessage[];
  tools?: ToolSpec[];
  webSearch?: { maxUses: number } | null;
  maxTokens?: number;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmResponse {
  /** Provider-native assistant content, stored verbatim and replayed unchanged. */
  content: ContentBlock[];
  text: string;
  toolCalls: LlmToolCall[];
  stopReason: "end_turn" | "tool_use" | "pause_turn" | "max_tokens" | "refusal" | "other";
  sources: { url: string; title: string; page_age?: string | null }[];
  usage: { input_tokens: number; output_tokens: number; web_searches: number };
  model: string;
}

export interface LlmProvider {
  name: string;
  model: string;
  available(): boolean;
  unavailableReason(): string | null;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class UnavailableProvider implements LlmProvider {
  name = "none";
  model = "none";
  private reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
  available() {
    return false;
  }
  unavailableReason() {
    return this.reason;
  }
  async complete(): Promise<LlmResponse> {
    throw new Error(this.reason);
  }
}
