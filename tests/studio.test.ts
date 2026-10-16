import { DateTime } from "luxon";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createConversation, saveConversation } from "@/lib/agent/conversations";
import { confirmDraft, createDraft } from "@/lib/bookings";
import { TIMEZONE } from "@/lib/config";
import { pgliteDb, type Db } from "@/lib/db";
import { seedDemoBookings } from "@/lib/seed";
import { conversationTranscript, maskDeep, maskEmail, maskName, studioOverview } from "@/lib/studio";

const NOW = DateTime.fromISO("2026-10-10T09:15", { zone: TIMEZONE });

describe("masking", () => {
  it("hides most of an email and the surname", () => {
    expect(maskEmail("jane.citizen@example.com")).toBe("j***@example.com");
    expect(maskEmail("Write to jane@example.com or bob@test.org")).toBe("Write to j***@example.com or b***@test.org");
    expect(maskName("Jane Citizen")).toBe("Jane C.");
    expect(maskName("Prince")).toBe("Prince");
  });

  it("masks nested values but keeps room names", () => {
    expect(
      maskDeep({ customerName: "Jane Citizen", roomName: "Room B", notes: ["mail jane@example.com"] }),
    ).toEqual({ customerName: "Jane C.", roomName: "Room B", notes: ["mail j***@example.com"] });
  });
});

describe("studio data", () => {
  let db: Db;
  beforeAll(async () => {
    db = await pgliteDb();
  });
  beforeEach(async () => {
    await db.query(`TRUNCATE email_log, pending_cancellations, bookings, booking_drafts, conversations, request_log`);
    await seedDemoBookings(db, NOW);
  });

  async function bookedConversation() {
    const conversation = await createConversation(db, NOW, null);
    conversation.messages = [
      { role: "user", content: "Room B Tuesday 2-6pm, Jane Citizen, jane@example.com" },
      { role: "system", content: "Current time at the studio: ..." },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "check_availability", input: { date: "2026-10-13" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ date: "2026-10-13", ok: true }) }],
      },
      { role: "assistant", content: [{ type: "text", text: "Room B is free. Shall I book it for jane@example.com?" }] },
    ];
    conversation.userTurns = 1;
    await saveConversation(db, conversation, 0);
    const ctx = (userTurn: number) => ({ conversationId: conversation.id, userTurn, now: NOW });
    const draft = await createDraft(
      db,
      {
        room: "B",
        date: "2026-10-13",
        start_time: "14:00",
        end_time: "18:00",
        customer_name: "Jane Citizen",
        customer_email: "jane@example.com",
      },
      ctx(1),
    );
    await confirmDraft(db, draft.draftId, ctx(2));
    return conversation.id;
  }

  it("summarises bookings, conversion and utilisation", async () => {
    await bookedConversation();
    const overview = await studioOverview(db, NOW);
    expect(overview.kpis.liveBookings).toBe(1);
    expect(overview.kpis.revenue).toBe("$340.00");
    expect(overview.funnel.map((f) => f.value)).toEqual([1, 1, 1, 1]);
    expect(overview.kpis.conversion).toBe(100);
    expect(overview.bookings[0]).toMatchObject({ customer: "Jane C.", email: "j***@example.com", status: "confirmed" });
    expect(overview.conversations[0].firstMessage).toContain("j***@example.com");
    expect(overview.heatmap).toHaveLength(7);
    expect(overview.kpis.utilisation).toBeGreaterThan(0);
  });

  it("rebuilds a readable, masked transcript", async () => {
    const id = await bookedConversation();
    const transcript = await conversationTranscript(db, id);
    expect(transcript?.items.map((i) => i.kind)).toEqual(["user", "tool", "assistant"]);
    const tool = transcript!.items[1] as { ok: boolean; data: Record<string, unknown> };
    expect(tool.ok).toBe(true);
    expect(JSON.stringify(transcript)).not.toContain("jane@example.com");
  });
});
