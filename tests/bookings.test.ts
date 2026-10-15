import { DateTime } from "luxon";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkAvailability,
  confirmDraft,
  createDraft,
  freeWindows,
  scheduleBetween,
} from "@/lib/bookings";
import { TIMEZONE } from "@/lib/config";
import { pgliteDb, type Db } from "@/lib/db";
import { BookingError } from "@/lib/errors";
import { seedDemoBookings } from "@/lib/seed";

// Saturday 10 Oct 2026, 09:15 Sydney. Friday 16 Oct has seeded bookings:
// Room A 14:00–16:00, Room B 09:00–13:00 and 18:00–22:00.
const NOW = DateTime.fromISO("2026-10-10T09:15", { zone: TIMEZONE });
const FRIDAY = "2026-10-16";
const TUESDAY = "2026-10-13"; // Room A 14:00–18:00 only

let db: Db;
beforeAll(async () => {
  db = await pgliteDb();
});
beforeEach(async () => {
  await db.query(`TRUNCATE email_log, bookings, booking_drafts, conversations, request_log`);
  await seedDemoBookings(db, NOW);
});

const ctx = (userTurn: number, conversationId = "cv_test", now = NOW) => ({
  conversationId,
  userTurn,
  now,
});

const customer = { customer_name: "Jane Citizen", customer_email: "jane@example.com" };

async function errorOf(promise: Promise<unknown>): Promise<BookingError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof BookingError) return err;
    throw err;
  }
  throw new Error("expected a BookingError");
}

describe("freeWindows", () => {
  it("returns gaps between busy intervals", () => {
    expect(
      freeWindows(
        [
          { startMinute: 600, endMinute: 720 },
          { startMinute: 840, endMinute: 900 },
        ],
        480,
        1320,
      ),
    ).toEqual([
      { startMinute: 480, endMinute: 600 },
      { startMinute: 720, endMinute: 840 },
      { startMinute: 900, endMinute: 1320 },
    ]);
  });

  it("merges overlapping busy intervals", () => {
    expect(
      freeWindows(
        [
          { startMinute: 600, endMinute: 720 },
          { startMinute: 660, endMinute: 780 },
        ],
        480,
        1320,
      ),
    ).toEqual([
      { startMinute: 480, endMinute: 600 },
      { startMinute: 780, endMinute: 1320 },
    ]);
  });
});

describe("checkAvailability", () => {
  it("reports each room for a requested slot", async () => {
    const result = await checkAvailability(
      db,
      { date: FRIDAY, start_time: "14:00", end_time: "18:00" },
      NOW,
    );
    expect(result.requested?.rooms).toEqual([
      { room: "A", roomName: "Room A", available: false },
      { room: "B", roomName: "Room B", available: true },
    ]);
  });

  it("lists free windows for the day", async () => {
    const result = await checkAvailability(db, { date: FRIDAY }, NOW);
    expect(result.freeWindows["Room A"].map((w) => `${w.start}-${w.end}`)).toEqual([
      "08:00-14:00",
      "16:00-22:00",
    ]);
    expect(result.freeWindows["Room B"].map((w) => `${w.start}-${w.end}`)).toEqual([
      "08:00-09:00",
      "13:00-18:00",
    ]);
  });

  it("treats back-to-back bookings as available", async () => {
    const result = await checkAvailability(
      db,
      { date: FRIDAY, start_time: "16:00", end_time: "18:00", room: "A" },
      NOW,
    );
    expect(result.requested?.rooms[0].available).toBe(true);
  });

  it("suggests alternatives when no room is free", async () => {
    // Saturday 17 Oct: both rooms 10:00–14:00.
    const result = await checkAvailability(
      db,
      { date: "2026-10-17", start_time: "11:00", end_time: "13:00" },
      NOW,
    );
    expect(result.requested?.rooms.every((r) => !r.available)).toBe(true);
    expect(result.alternatives?.length).toBeGreaterThan(0);
    expect(result.alternatives?.[0].start).toBe("14:00");
  });

  it("offers distinct alternatives rather than near-duplicates", async () => {
    const result = await checkAvailability(
      db,
      { date: FRIDAY, start_time: "14:00", end_time: "18:00", room: "A" },
      NOW,
    );
    // Same time elsewhere, then the nearest later and earlier options.
    expect(result.alternatives.map((a) => a.label)).toEqual([
      "Room B, 2:00 pm – 6:00 pm",
      "Room A, 4:00 pm – 8:00 pm",
      "Room A, 10:00 am – 2:00 pm",
    ]);
    // Each option carries its price so the customer can compare.
    expect(result.alternatives.every((a) => a.duration === "4 hours" && a.total === "$340.00")).toBe(true);
  });

  it("only offers future times today", async () => {
    const tuesdayMorning = DateTime.fromISO(`${TUESDAY}T09:15`, { zone: TIMEZONE });
    const result = await checkAvailability(db, { date: TUESDAY }, tuesdayMorning);
    expect(result.freeWindows["Room A"].map((w) => `${w.start}-${w.end}`)).toEqual([
      "09:30-14:00",
      "18:00-22:00",
    ]);
  });

  it("hides gaps shorter than the minimum booking", async () => {
    // Today (Saturday) both rooms are busy 10:00–14:00; 09:30–10:00 is too short.
    const result = await checkAvailability(db, { date: "2026-10-10" }, NOW);
    expect(result.freeWindows["Room A"][0].start).toBe("14:00");
  });
});

describe("drafts and confirmation", () => {
  it("quotes with the discount at exactly 4 hours", async () => {
    const draft = await createDraft(
      db,
      { room: "B", date: FRIDAY, start_time: "14:00", end_time: "18:00", ...customer },
      ctx(1),
    );
    expect(draft.total).toBe("$340.00");
    expect(draft.discountApplied).toBe(true);
    expect(draft.duration).toBe("4 hours");
    expect(draft.cheaperAlternative).toBeNull();
  });

  it("points out that 4 hours is cheaper than 3.5", async () => {
    const draft = await createDraft(
      db,
      { room: "B", date: FRIDAY, start_time: "13:30", end_time: "17:00", ...customer },
      ctx(1),
    );
    expect(draft.total).toBe("$350.00");
    expect(draft.cheaperAlternative).toContain("$340.00");
  });

  it("refuses a taken room and offers alternatives", async () => {
    const err = await errorOf(
      createDraft(
        db,
        { room: "A", date: FRIDAY, start_time: "14:00", end_time: "18:00", ...customer },
        ctx(1),
      ),
    );
    expect(err.code).toBe("ROOM_UNAVAILABLE");
    const alternatives = err.details?.alternatives as Array<{ label: string }>;
    expect(alternatives[0].label).toBe("Room B, 2:00 pm – 6:00 pm");
  });

  it.each([
    [{ customer_email: "not-an-email" }, "INVALID_EMAIL"],
    [{ customer_name: " " }, "INVALID_NAME"],
  ])("validates customer details %j", async (override, code) => {
    const err = await errorOf(
      createDraft(
        db,
        { room: "B", date: FRIDAY, start_time: "14:00", end_time: "16:00", ...customer, ...override },
        ctx(1),
      ),
    );
    expect(err.code).toBe(code);
  });

  it("requires the customer to reply before confirming", async () => {
    const draft = await createDraft(
      db,
      { room: "A", date: TUESDAY, start_time: "09:00", end_time: "12:00", ...customer },
      ctx(3),
    );
    expect((await errorOf(confirmDraft(db, draft.draftId, ctx(3)))).code).toBe(
      "NEEDS_USER_CONFIRMATION",
    );

    const { booking, alreadyConfirmed } = await confirmDraft(db, draft.draftId, ctx(4));
    expect(alreadyConfirmed).toBe(false);
    expect(booking.refCode).toMatch(/^EE-[A-Z2-9]{6}$/);
    expect(booking.total).toBe("$300.00");
    expect(booking.when).toBe("Tuesday 13 October 2026, 9:00 am – 12:00 pm");
  });

  it("is idempotent when confirmed twice", async () => {
    const draft = await createDraft(
      db,
      { room: "A", date: TUESDAY, start_time: "09:00", end_time: "12:00", ...customer },
      ctx(1),
    );
    const first = await confirmDraft(db, draft.draftId, ctx(2));
    const second = await confirmDraft(db, draft.draftId, ctx(3));
    expect(second.alreadyConfirmed).toBe(true);
    expect(second.booking.id).toBe(first.booking.id);
    const schedule = await scheduleBetween(db, NOW, 7);
    expect(schedule.filter((b) => b.date === TUESDAY && b.room === "A")).toHaveLength(2);
  });

  it("lets only one of two competing drafts win", async () => {
    const slot = { room: "B" as const, date: TUESDAY, start_time: "10:00", end_time: "12:00" };
    const a = await createDraft(db, { ...slot, ...customer }, ctx(1, "cv_a"));
    const b = await createDraft(
      db,
      { ...slot, customer_name: "Sam Other", customer_email: "sam@example.com" },
      ctx(1, "cv_b"),
    );
    const results = await Promise.allSettled([
      confirmDraft(db, a.draftId, ctx(2, "cv_a")),
      confirmDraft(db, b.draftId, ctx(2, "cv_b")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as BookingError).code).toBe("ROOM_UNAVAILABLE");
  });

  it("does not confirm another conversation's draft", async () => {
    const draft = await createDraft(
      db,
      { room: "A", date: TUESDAY, start_time: "09:00", end_time: "12:00", ...customer },
      ctx(1, "cv_owner"),
    );
    expect((await errorOf(confirmDraft(db, draft.draftId, ctx(2, "cv_intruder")))).code).toBe(
      "DRAFT_NOT_FOUND",
    );
  });

  it("expires stale quotes", async () => {
    const draft = await createDraft(
      db,
      { room: "A", date: TUESDAY, start_time: "09:00", end_time: "12:00", ...customer },
      ctx(1),
    );
    const later = NOW.plus({ minutes: 30 });
    expect((await errorOf(confirmDraft(db, draft.draftId, ctx(2, "cv_test", later)))).code).toBe(
      "DRAFT_EXPIRED",
    );
  });
});

describe("seed", () => {
  it("is safe to run repeatedly", async () => {
    const before = await scheduleBetween(db, NOW, 7);
    await seedDemoBookings(db, NOW);
    expect(await scheduleBetween(db, NOW, 7)).toHaveLength(before.length);
  });
});
