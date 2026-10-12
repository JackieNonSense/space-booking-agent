import type Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createConversation, loadConversation, saveConversation } from "@/lib/agent/conversations";
import type { AgentEvent } from "@/lib/agent/events";
import { runAgentTurn } from "@/lib/agent/run";
import { TIMEZONE } from "@/lib/config";
import { pgliteDb, type Db } from "@/lib/db";
import { seedDemoBookings } from "@/lib/seed";

// The agent loop against a scripted stand-in for the Claude API. The script
// deliberately misbehaves (confirms too early, forgets the email) to show the
// server-side guards hold regardless of what the model does.

const NOW = DateTime.fromISO("2026-10-10T09:15", { zone: TIMEZONE });

type Params = Anthropic.Beta.MessageCreateParams;
type Block = Record<string, unknown>;
type Step = (params: Params) => { content: Block[]; stop_reason: string };

function fakeClient(steps: Step[]) {
  const requests: Params[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Params) {
          // Snapshot: the loop keeps appending to the same array.
          requests.push(structuredClone(params));
          const step = steps.shift();
          if (!step) throw new Error("fake model ran out of scripted steps");
          const { content, stop_reason } = step(params);
          const message = {
            id: `msg_${requests.length}`,
            type: "message",
            role: "assistant",
            model: params.model,
            content,
            stop_reason,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 },
          };
          return {
            async *[Symbol.asyncIterator]() {
              for (const block of content) {
                if (block.type === "text") {
                  yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: block.text } };
                }
              }
            },
            finalMessage: async () => message,
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

const thinking = (n: number): Block => ({ type: "thinking", thinking: "", signature: `sig_${n}` });
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
const text = (t: string): Block => ({ type: "text", text: t });

function toolResult(params: Params, toolUseId: string): Record<string, unknown> {
  for (const m of params.messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_result" && b.tool_use_id === toolUseId) {
        return JSON.parse(String(b.content));
      }
    }
  }
  throw new Error(`no result for ${toolUseId}`);
}

let db: Db;
beforeAll(async () => {
  db = await pgliteDb();
});
beforeEach(async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  await db.query(`TRUNCATE email_log, bookings, booking_drafts, conversations, request_log`);
  await seedDemoBookings(db, NOW);
});

describe("agent loop", () => {
  it("quotes, waits for the customer, books, and always sends the email", async () => {
    const conversation = await createConversation(db, NOW, "127.0.0.1");
    const events: AgentEvent[] = [];
    const emit = (e: AgentEvent) => events.push(e);

    // Turn 1: availability, draft, then an over-eager confirm in the same turn.
    const turn1 = fakeClient([
      () => ({
        content: [thinking(1), toolUse("t1", "check_availability", { date: "2026-10-16", start_time: "14:00", end_time: "18:00", duration_hours: null, room: "B" })],
        stop_reason: "tool_use",
      }),
      () => ({
        content: [
          thinking(2),
          toolUse("t2", "create_booking_draft", {
            room: "B", date: "2026-10-16", start_time: "14:00", end_time: "18:00", duration_hours: null,
            customer_name: "Jane Citizen", customer_email: "jane@example.com",
          }),
        ],
        stop_reason: "tool_use",
      }),
      (p) => ({
        content: [thinking(3), toolUse("t3", "confirm_booking", { draft_id: toolResult(p, "t2").draft_id })],
        stop_reason: "tool_use",
      }),
      () => ({ content: [thinking(4), text("Room B is free. The total is $340.00. Shall I confirm?")], stop_reason: "end_turn" }),
    ]);
    await runAgentTurn({ db, conversation, userText: "Room B Friday 2-6pm please. Jane Citizen, jane@example.com", now: NOW, emit, client: turn1.client });
    await saveConversation(db, conversation, 0);

    const early = events.find((e) => e.type === "tool_result" && e.name === "confirm_booking");
    expect(early).toMatchObject({ ok: false, data: { error_code: "NEEDS_USER_CONFIRMATION" } });
    const draft = events.find((e) => e.type === "tool_result" && e.name === "create_booking_draft");
    expect(draft).toMatchObject({ ok: true, data: { total: "$340.00", discountApplied: true } });
    expect(await db.query(`SELECT 1 FROM bookings WHERE source = 'agent'`)).toHaveLength(0);

    // Every model call sees the time note right after the customer's message.
    const firstRequest = turn1.requests[0];
    expect(firstRequest.messages.map((m) => m.role)).toEqual(["user", "system"]);
    expect(String(firstRequest.messages[1].content)).toContain("Current time at the studio");
    expect(firstRequest.tool_choice).toBeUndefined();
    expect(firstRequest.fallbacks).toBe("default");

    // Turn 2: customer accepts; the model confirms but forgets the email tool.
    events.length = 0;
    const reloaded = (await loadConversation(db, conversation.id))!;
    const turn2 = fakeClient([
      (p) => ({
        content: [thinking(5), toolUse("t4", "confirm_booking", { draft_id: toolResult(p, "t2").draft_id })],
        stop_reason: "tool_use",
      }),
      () => ({ content: [thinking(6), text("You're booked!")], stop_reason: "end_turn" }),
    ]);
    await runAgentTurn({ db, conversation: reloaded, userText: "Yes, confirm", now: NOW, emit, client: turn2.client });

    const confirmed = events.find((e) => e.type === "tool_result" && e.name === "confirm_booking");
    expect(confirmed).toMatchObject({ ok: true, data: { total: "$340.00", roomName: "Room B" } });
    const email = events.find((e) => e.type === "tool_result" && e.name === "send_confirmation_email");
    expect(email).toMatchObject({ automatic: true, ok: true, data: { status: "dry_run", to: "jane@example.com" } });

    // Turn 1's assistant content, thinking blocks included, is replayed verbatim.
    const replayed = turn2.requests[0].messages;
    const firstAssistant = replayed.find((m) => m.role === "assistant");
    expect(firstAssistant?.content).toEqual(turn1.requests[1].messages[2].content);
    expect(JSON.stringify(replayed)).toContain("sig_1");
    expect(reloaded.userTurns).toBe(2);
  });

  it("rolls the turn back when the API fails before answering", async () => {
    const conversation = await createConversation(db, NOW, null);
    const failing = {
      beta: { messages: { stream: () => { throw new Error("overloaded"); } } },
    } as unknown as Anthropic;
    await expect(
      runAgentTurn({ db, conversation, userText: "hello", now: NOW, emit: () => {}, client: failing }),
    ).rejects.toThrow("overloaded");
    expect(conversation.messages).toHaveLength(0);
    expect(conversation.userTurns).toBe(0);
  });

  it("returns tool errors to the model instead of crashing", async () => {
    const conversation = await createConversation(db, NOW, null);
    const events: AgentEvent[] = [];
    const { client, requests } = fakeClient([
      () => ({
        content: [toolUse("t1", "create_booking_draft", {
          room: "A", date: "2026-10-16", start_time: "21:00", end_time: "23:00", duration_hours: null,
          customer_name: "Jane", customer_email: "jane@example.com",
        })],
        stop_reason: "tool_use",
      }),
      () => ({ content: [text("We close at 10pm.")], stop_reason: "end_turn" }),
    ]);
    await runAgentTurn({ db, conversation, userText: "9 to 11pm", now: NOW, emit: (e) => events.push(e), client });
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: false, data: { error_code: "OUTSIDE_HOURS" } });
    const resultBlock = (requests[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(resultBlock.is_error).toBe(true);
  });
});
