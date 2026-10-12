// Events streamed from /api/chat to the browser as newline-delimited JSON.

export type AgentEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      id: string;
      name: string;
      ok: boolean;
      data: Record<string, unknown>;
      ms: number;
      automatic?: boolean;
    }
  | { type: "error"; message: string }
  | {
      type: "done";
      usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; steps: number };
    };

export type Emit = (event: AgentEvent) => void;
