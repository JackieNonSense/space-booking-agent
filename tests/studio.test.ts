import { DateTime } from "luxon";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createConversation, saveConversation } from "@/lib/agent/conversations";
import { confirmDraft, createDraft } from "@/lib/bookings";
import { TIMEZONE } from "@/lib/config";
import { pgliteDb, type Db } from "@/lib/db";
import { seedDemoBookings } from "@/lib/seed";
import {
  conversationTranscript,
  maskDeep,
  maskEmail,
  maskName,
  maskRef,
  maskText,
  studioOverview,
} from "@/lib/studio";

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
    // The name the customer typed in their first message.
    expect(JSON.stringify(transcript)).not.toContain("Citizen");
    expect((transcript!.items[0] as { text: string }).text).toContain("Jane C.");
  });

  it("never exposes booking ids or full references", async () => {
    const id = await bookedConversation();
    const [booking] = await db.query<{ id: string; ref_code: string }>(
      `SELECT id, ref_code FROM bookings WHERE source = 'agent'`,
    );
    const overview = JSON.stringify(await studioOverview(db, NOW));
    expect(overview).not.toContain(booking.id);
    expect(overview).not.toContain(booking.ref_code);
    expect(overview).toContain(`${booking.ref_code.slice(0, 5)}••••`);
    expect(overview).not.toContain("Citizen");

    // A transcript where the tools returned the id and the reference.
    const conversation = await createConversation(db, NOW, null);
    conversation.messages = [
      { role: "user", content: "Yes, book it" },
      { role: "assistant", content: [{ type: "tool_use", id: "t9", name: "confirm_booking", input: { draft_id: "dr_secret" } }] },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t9",
            content: JSON.stringify({ booking_id: booking.id, id: booking.id, refCode: booking.ref_code, customerName: "Jane Citizen" }),
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: `Booked! Your reference is ${booking.ref_code}, Ms Citizen.` }] },
    ];
    conversation.userTurns = 1;
    await saveConversation(db, conversation, 0);
    const transcript = JSON.stringify(await conversationTranscript(db, conversation.id));
    for (const secret of [booking.id, booking.ref_code, "dr_secret", "Citizen"]) expect(transcript).not.toContain(secret);
    expect(transcript).toContain("Ms C.");
    expect(id).toBeTruthy();
  });

  it("masks references, emails and known names in free text", () => {
    expect(maskRef("Ref EE-7K3Q9M and EE-ABCDEF")).toBe("Ref EE-7K•••• and EE-AB••••");
    expect(maskText("I'm Ana María Núñez (ana@example.com)", ["Ana María Núñez"])).toBe("I'm Ana N. (a***@example.com)");
    expect(maskText("Thanks, Ms Núñez!", ["Ana María Núñez"])).toBe("Thanks, Ms N.!");
  });
});
