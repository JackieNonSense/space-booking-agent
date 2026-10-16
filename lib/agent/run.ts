import Anthropic from "@anthropic-ai/sdk";
import type { DateTime } from "luxon";
import type { Db } from "../db";
import { sendBookingEmail, unsentEmails } from "../email";
import type { Conversation } from "./conversations";
import type { Emit } from "./events";
import { timeNote } from "./prompt";
import { runTool, TOOLS } from "./tools";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Read lazily so scripts that load .env files after importing still apply them.
// Sonnet 5.5 is the model the conversation evals run against.
export const currentModel = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const currentEffort = () => (process.env.ANTHROPIC_EFFORT || "medium") as Effort;
const MAX_STEPS = 8;

const REFUSAL_REPLY =
  "Sorry, I can't help with that. I can check availability and book Room A or Room B for you.";
const FAILURE_REPLY = "Sorry, something went wrong on my side. Could you say that again?";

let defaultClient: Anthropic | undefined;
const getClient = () => (defaultClient ??= new Anthropic());

export interface TurnOptions {
  db: Db;
  conversation: Conversation;
  userText: string;
  now: DateTime;
  emit: Emit;
  client?: Anthropic;
}

/**
 * Runs one customer turn: the model may call tools several times before it
 * answers. Mutates `conversation` in place; the caller persists it.
 *
 * The transcript is append-only. Assistant turns go back to the API exactly as
 * they came out (thinking blocks included), and the per-turn time note is a
 * mid-conversation system message rather than an edit to the system prompt.
 */
export async function runAgentTurn({ db, conversation, userText, now, emit, client }: TurnOptions) {
  const api = client ?? getClient();
  const messages = conversation.messages;
  const startLength = messages.length;
  const userTurn = conversation.userTurns + 1;
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, steps: 0 };

  messages.push({ role: "user", content: userText });
  messages.push({ role: "system", content: timeNote(now) });

  // Tool calls whose results haven't been appended yet. If the turn breaks in
  // between, they still get results, or every later request would be rejected.
  let pending: { calls: Anthropic.Beta.BetaToolUseBlock[]; results: Anthropic.Beta.BetaToolResultBlockParam[] } | null =
    null;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = api.beta.messages.stream({
        model: currentModel(),
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
        // A safety-classifier false positive is retried on another model
        // instead of failing the customer's request.
        fallbacks: "default",
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        output_config: { effort: currentEffort() },
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: conversation.systemPrompt }],
        tools: TOOLS,
        messages,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          emit({ type: "text", delta: event.delta.text });
        }
      }
      const message = await stream.finalMessage();
      usage.steps++;
      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cachedTokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;

      if (message.stop_reason === "refusal") {
        emit({ type: "text", delta: REFUSAL_REPLY });
        messages.push({ role: "assistant", content: REFUSAL_REPLY });
        break;
      }

      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
        // A truncated tool input can still parse; never run it.
        emit({ type: "text", delta: FAILURE_REPLY });
        messages.push({ role: "assistant", content: FAILURE_REPLY });
        break;
      }

      messages.push({ role: "assistant", content: message.content as MessageParam["content"] });
      if (message.stop_reason === "pause_turn") continue;
      if (toolUses.length === 0) break;

      // Sequential on purpose: confirm_booking must finish before the email.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      pending = { calls: toolUses, results };
      for (const call of toolUses) {
        emit({ type: "tool_call", id: call.id, name: call.name, input: call.input });
        const started = Date.now();
        const outcome = await runTool(call.name, call.input, {
          db,
          conversationId: conversation.id,
          userTurn,
          now,
        });
        emit({
          type: "tool_result",
          id: call.id,
          name: call.name,
          ok: outcome.ok,
          data: outcome.data,
          ms: Date.now() - started,
        });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(outcome.data),
          ...(outcome.ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: "user", content: results });
      pending = null;
    }
  } catch (err) {
    if (messages.length === startLength + 2) {
      // Nothing came back this turn: drop it so the transcript stays valid.
      messages.length = startLength;
      throw err;
    }
    console.error("[agent] turn failed after partial progress", err);
    if (pending) {
      const answered = new Set(pending.results.map((r) => r.tool_use_id));
      for (const call of pending.calls.filter((c) => !answered.has(c.id))) {
        pending.results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify({
            error_code: "INTERRUPTED",
            message: "This step failed on the server and may not have run. Check the current state before retrying it.",
          }),
          is_error: true,
        });
      }
      messages.push({ role: "user", content: pending.results });
    }
    emit({ type: "error", message: "The assistant stopped unexpectedly. Please send your last message again." });
  }

  conversation.userTurns = userTurn;

  // Safety net: a confirmed booking always gets its email, even if the model
  // forgot to call the tool.
  for (const { bookingId, kind } of await unsentEmails(db, conversation.id)) {
    const started = Date.now();
    const result = await sendBookingEmail(db, bookingId, kind);
    emit({
      type: "tool_result",
      id: `auto_${kind}_${bookingId}`,
      name: "send_confirmation_email",
      ok: result.status !== "failed",
      data: { ...result },
      ms: Date.now() - started,
      automatic: true,
    });
  }

  console.info(
    `[agent] conversation=${conversation.id} turn=${userTurn} model=${currentModel()} effort=${currentEffort()} steps=${usage.steps} in=${usage.inputTokens} cached=${usage.cachedTokens} cacheWrite=${usage.cacheWriteTokens} out=${usage.outputTokens}`,
  );
  return usage;
}
