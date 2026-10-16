import { DateTime } from "luxon";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAvailability,
  confirmCancellation,
  confirmDraft,
  createDraft,
  findBooking,
  requestCancellation,
} from "@/lib/bookings";
import { runTool } from "@/lib/agent/tools";
import { TIMEZONE } from "@/lib/config";
import { pgliteDb, type Db } from "@/lib/db";
import { BookingError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { seedDemoBookings } from "@/lib/seed";

// Saturday 10 Oct 2026, 09:15 Sydney. Tuesday 13 Oct: Room A busy 14:00–18:00, Room B free.
const NOW = DateTime.fromISO("2026-10-10T09:15", { zone: TIMEZONE });
const TUESDAY = "2026-10-13";
const JANE = { customer_name: "Jane Citizen", customer_email: "jane@example.com" };

let db: Db;
beforeAll(async () => {
  db = await pgliteDb();
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("RESEND_API_KEY", "");
  await db.query(`TRUNCATE email_log, pending_cancellations, bookings, booking_drafts, conversations, request_log`);
  await seedDemoBookings(db, NOW);
});

const ctx = (userTurn: number, now = NOW, conversationId = "cv_edge") => ({ conversationId, userTurn, now });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof BookingError) return err.code;
    throw err;
  }
  return "ok";
}

const draft = (overrides: Record<string, unknown>, turn = 1, now = NOW) =>
  createDraft(db, { room: "B", date: TUESDAY, start_time: "10:00", end_time: "12:00", ...JANE, ...overrides } as never, ctx(turn, now));

describe("opening hours and limits", () => {
  it.each([
    [{ start_time: "08:00", end_time: "09:00" }, "ok"],
    [{ start_time: "07:30", end_time: "09:00" }, "OUTSIDE_HOURS"],
    [{ start_time: "21:00", end_time: "22:00" }, "ok"],
    [{ start_time: "21:30", end_time: "22:30" }, "OUTSIDE_HOURS"],
    [{ start_time: "08:00", end_time: "22:00" }, "ok"],
    [{ start_time: "10:00", end_time: "10:30" }, "TOO_SHORT"],
    [{ start_time: "10:15", end_time: "12:00" }, "NOT_ON_GRID"],
    [{ start_time: "10:00", end_time: undefined, duration_hours: 2.25 }, "NOT_ON_GRID"],
    [{ start_time: "10:00", end_time: undefined, duration_hours: 0 }, "INVALID_DURATION"],
    [{ start_time: "10:00", end_time: undefined, duration_hours: 2.5 }, "ok"],
    [{ start_time: "10:00", end_time: "12:00", duration_hours: 3 }, "CONFLICTING_END"],
    [{ start_time: "22:00", end_time: "02:00" }, "CROSSES_MIDNIGHT"],
    [{ start_time: "10:00", end_time: "10:00" }, "END_BEFORE_START"],
    [{ start_time: "25:00", end_time: "26:00" }, "INVALID_TIME"],
    [{ start_time: "13pm", end_time: "2pm" }, "INVALID_TIME"],
    [{ date: "2026-02-30" }, "INVALID_DATE"],
    [{ date: "next tuesday" }, "INVALID_DATE"],
    [{ room: "C" }, "ROOM_UNAVAILABLE"],
    [{ start_time: "2pm", end_time: "6pm" }, "ok"],
  ])("%j → %s", async (overrides, expected) => {
    expect(await codeOf(draft(overrides))).toBe(expected);
  });

  it("prices a full 14-hour day", async () => {
    const d = await draft({ start_time: "08:00", end_time: "22:00" });
    expect(d.total).toBe("$1190.00");
    expect(d.discount).toBe("$210.00");
  });

  it("allows later today but not earlier today", async () => {
    expect(await codeOf(draft({ date: "2026-10-10", start_time: "09:00", end_time: "10:00", room: "B" }))).toBe("IN_PAST");
    // Today (Saturday) both rooms are busy 10:00–14:00, so try the afternoon.
    expect(await codeOf(draft({ date: "2026-10-10", start_time: "15:00", end_time: "17:00", room: "B" }))).toBe("ok");
  });

  it("opens every slot on the last bookable day, and nothing after it", async () => {
    const last = NOW.plus({ days: 180 }).toISODate()!;
    const beyond = NOW.plus({ days: 181 }).toISODate()!;
    // Later in the day than the current time, which a "now + 180 days" cut-off would refuse.
    expect(await codeOf(draft({ date: last, start_time: "20:00", end_time: "22:00" }))).toBe("ok");
    expect(await codeOf(draft({ date: beyond, start_time: "08:00", end_time: "09:00" }))).toBe("TOO_FAR_AHEAD");
    expect(await codeOf(checkAvailability(db, { date: last }, NOW))).toBe("ok");
    expect(await codeOf(checkAvailability(db, { date: beyond }, NOW))).toBe("TOO_FAR_AHEAD");
  });

  it("rejects a past date for availability", async () => {
    expect(await codeOf(checkAvailability(db, { date: "2026-10-09" }, NOW))).toBe("IN_PAST");
  });

  it("shows no free time today once the studio has closed", async () => {
    const late = DateTime.fromISO("2026-10-10T21:40", { zone: TIMEZONE });
    const today = await checkAvailability(db, { date: "2026-10-10" }, late);
    expect(Object.values(today.freeWindows).flat()).toEqual([]);
    expect(await codeOf(draft({ date: "2026-10-10", start_time: "21:00", end_time: "22:00" }, 1, late))).toBe("IN_PAST");
  });

  it("offers alternatives that are still in the future", async () => {
    const at = DateTime.fromISO("2026-10-10T11:05", { zone: TIMEZONE });
    // Saturday: both rooms busy 10:00–14:00.
    const result = await checkAvailability(db, { date: "2026-10-10", start_time: "12:00", end_time: "14:00", room: "A" }, at);
    expect(result.alternatives.length).toBeGreaterThan(0);
    for (const alt of result.alternatives) expect(alt.start >= "14:00").toBe(true);
  });
});

describe("customer details", () => {
  it("normalises the email and tidies the name", async () => {
    const d = await draft({ customer_name: "  Ana   María  Núñez ", customer_email: " Ana.Nunez@Example.COM " });
    expect(d.customerName).toBe("Ana María Núñez");
    expect(d.customerEmail).toBe("ana.nunez@example.com");
  });

  it.each(["jane@", "@example.com", "jane example.com", "jane@example", "a".repeat(200) + "@x.com"])(
    "rejects the email %s",
    async (email) => {
      expect(await codeOf(draft({ customer_email: email }))).toBe("INVALID_EMAIL");
    },
  );

  it("refuses a slot the same customer already booked", async () => {
    const d = await draft({});
    await confirmDraft(db, d.draftId, ctx(2));
    expect(await codeOf(draft({}, 3))).toBe("ROOM_UNAVAILABLE");
  });
});

describe("changing and cancelling edge cases", () => {
  async function booked(overrides: Record<string, unknown> = {}) {
    const d = await draft(overrides);
    return (await confirmDraft(db, d.draftId, ctx(2))).booking;
  }

  it("won't move a cancelled booking", async () => {
    const b = await booked();
    const request = await requestCancellation(db, b.refCode, JANE.customer_email, ctx(3));
    await confirmCancellation(db, request.cancellationId, ctx(4));
    expect(await codeOf(draft({ start_time: "13:00", end_time: "15:00", reschedule_reference: b.refCode }, 5))).toBe(
      "ALREADY_CANCELLED",
    );
  });

  it("won't change a booking that has already started", async () => {
    const b = await booked();
    const later = DateTime.fromISO(`${TUESDAY}T10:30`, { zone: TIMEZONE });
    expect(await codeOf(requestCancellation(db, b.refCode, JANE.customer_email, ctx(3, later)))).toBe("IN_PAST");
  });

  it("can move a booking to exactly the same slot without clashing with itself", async () => {
    const b = await booked();
    const d = await draft({ reschedule_reference: b.refCode }, 3);
    expect(d.priceDifference).toBe("Same price");
    const { booking } = await confirmDraft(db, d.draftId, ctx(4));
    expect(booking.refCode).not.toBe(b.refCode);
    expect((await findBooking(db, booking.refCode, JANE.customer_email)).status).toBe("confirmed");
  });

  it("expires a cancellation request after 15 minutes", async () => {
    const b = await booked();
    const request = await requestCancellation(db, b.refCode, JANE.customer_email, ctx(3));
    const later = NOW.plus({ minutes: 20 });
    expect(await codeOf(confirmCancellation(db, request.cancellationId, ctx(4, later)))).toBe("REQUEST_EXPIRED");
  });

  it("returns the same answer for a wrong reference and a wrong email", async () => {
    const b = await booked();
    const wrongRef = await findBooking(db, "EE-AAAAAA", JANE.customer_email).catch((e: BookingError) => e.message);
    const wrongEmail = await findBooking(db, b.refCode, "x@example.com").catch((e: BookingError) => e.message);
    expect(wrongRef).toBe(wrongEmail);
  });
});

describe("tool inputs", () => {
  const toolCtx = (userTurn: number, conversationId = "cv_edge") => ({ db, conversationId, userTurn, now: NOW });
  const call = async (name: string, input: unknown, userTurn = 1, conversationId = "cv_edge") =>
    (await runTool(name, input, toolCtx(userTurn, conversationId))).data as Record<string, unknown>;

  it("rejects malformed input and unknown tools with a structured error", async () => {
    expect((await call("check_availability", { date: "2026-10-13", room: "C" })).error_code).toBe("INVALID_INPUT");
    expect((await call("create_booking_draft", { room: "A" })).error_code).toBe("INVALID_INPUT");
    expect((await call("delete_everything", {})).error_code).toBe("UNKNOWN_TOOL");
    expect((await call("confirm_booking", { draft_id: "dr_doesnotexist0000" })).error_code).toBe("DRAFT_NOT_FOUND");
  });

  it("prices odd requests sensibly", async () => {
    expect((await call("calculate_price", { duration_hours: 8, start_time: null, end_time: null })).total).toBe("$680.00");
    expect((await call("calculate_price", { duration_hours: 3.5, start_time: null, end_time: null })).cheaper_alternative).toMatch(
      /4 hours would cost \$340\.00/,
    );
    expect((await call("calculate_price", { duration_hours: null, start_time: "2pm", end_time: "6pm" })).total).toBe("$340.00");
    expect((await call("calculate_price", { duration_hours: -2, start_time: null, end_time: null })).error_code).toBe(
      "END_BEFORE_START",
    );
    expect((await call("calculate_price", { duration_hours: null, start_time: null, end_time: null })).error_code).toBe(
      "MISSING_END",
    );
  });

  it("only emails bookings this conversation made or cancelled", async () => {
    const [seed] = await db.query<{ id: string }>(`SELECT id FROM bookings WHERE source = 'seed' LIMIT 1`);
    expect((await call("send_confirmation_email", { booking_id: seed.id })).error_code).toBe("BOOKING_NOT_FOUND");

    const d = await draft({}, 1);
    const { booking } = await confirmDraft(db, d.draftId, ctx(2));
    expect((await call("send_confirmation_email", { booking_id: booking.id }, 3, "cv_someone_else")).error_code).toBe(
      "BOOKING_NOT_FOUND",
    );
    expect((await call("send_confirmation_email", { booking_id: booking.id }, 3)).status).toBe("dry_run");
    expect((await call("send_confirmation_email", { booking_id: booking.refCode }, 3)).status).toBe("already_sent");

    // Cancelled from a later conversation: that conversation may send the notice.
    const request = await call("request_cancellation", { reference: booking.refCode, email: JANE.customer_email }, 1, "cv_later");
    const cancelled = await call("confirm_cancellation", { cancellation_id: request.cancellation_id }, 2, "cv_later");
    expect(cancelled.status).toBe("cancelled");
    expect((await call("send_confirmation_email", { booking_id: booking.id }, 3, "cv_later")).status).toBe("already_sent");
  });
});

describe("rate limits", () => {
  it("limits one address per hour without blocking others", async () => {
    vi.stubEnv("RATE_LIMIT_PER_HOUR", "3");
    // The limits are read at import time, so load a fresh copy of the module.
    vi.resetModules();
    const { checkRateLimit: limited } = await import("@/lib/rate-limit");
    for (let i = 0; i < 3; i++) expect((await limited(db, "1.1.1.1")).ok).toBe(true);
    expect((await limited(db, "1.1.1.1")).ok).toBe(false);
    expect((await limited(db, "2.2.2.2")).ok).toBe(true);
  });

  it("allows normal traffic with the default limits", async () => {
    expect((await checkRateLimit(db, "3.3.3.3")).ok).toBe(true);
  });
});
