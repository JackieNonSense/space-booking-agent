import { DateTime } from "luxon";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDraft, createDraft, type BookingView } from "@/lib/bookings";
import { TIMEZONE } from "@/lib/config";
import { pgliteDb, type Db } from "@/lib/db";
import {
  buildIcs,
  isReservedAddress,
  renderConfirmationEmail,
  sendConfirmationEmail,
  unsentBookingIds,
} from "@/lib/email";

const NOW = DateTime.fromISO("2026-10-10T09:15", { zone: TIMEZONE });

let db: Db;
let booking: BookingView;

beforeAll(async () => {
  db = await pgliteDb();
});

beforeEach(async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  await db.query(`TRUNCATE email_log, pending_cancellations, bookings, booking_drafts`);
  const draft = await createDraft(
    db,
    {
      room: "B",
      date: "2026-10-16",
      start_time: "14:00",
      duration_hours: 5,
      customer_name: "Jane Citizen",
      customer_email: "jane@example.com",
    },
    { conversationId: "cv_mail", userTurn: 1, now: NOW },
  );
  booking = (await confirmDraft(db, draft.draftId, { conversationId: "cv_mail", userTurn: 2, now: NOW }))
    .booking;
});

describe("confirmation email", () => {
  it("contains every field the spec asks for", () => {
    const { subject, html, text } = renderConfirmationEmail(booking);
    for (const s of [text, html]) {
      expect(s).toContain("Jane Citizen");
      expect(s).toContain("Room B");
      expect(s).toContain("Friday 16 October 2026, 2:00 pm – 7:00 pm");
      expect(s).toContain("5 hours");
      expect(s).toContain("$425.00");
      expect(s).toContain(booking.refCode);
    }
    expect(subject).toContain(booking.refCode);
  });

  it("escapes customer-provided text in HTML", () => {
    const { html } = renderConfirmationEmail({ ...booking, customerName: "<script>x</script>" });
    expect(html).not.toContain("<script>");
  });

  it("builds a calendar invite in UTC", () => {
    const ics = buildIcs(booking, NOW);
    expect(ics).toContain("DTSTART:20261016T030000Z"); // 14:00 AEDT
    expect(ics).toContain("DTEND:20261016T080000Z");
    expect(ics).toContain("\r\n");
  });

  it("sends at most once per booking", async () => {
    expect(await unsentBookingIds(db, "cv_mail")).toEqual([booking.id]);
    const first = await sendConfirmationEmail(db, booking.id);
    expect(first.status).toBe("dry_run");
    expect(first.to).toBe("jane@example.com");
    const second = await sendConfirmationEmail(db, booking.id);
    expect(second.status).toBe("already_sent");
    expect(await unsentBookingIds(db, "cv_mail")).toEqual([]);
  });

  it("names the time zone in force on the booking's date", async () => {
    expect(renderConfirmationEmail(booking).text).toContain("Friday 16 October 2026, 2:00 pm – 7:00 pm (AEDT)");
    // Daylight saving has ended by 6 April 2027.
    const draft = await createDraft(
      db,
      { room: "A", date: "2027-04-06", start_time: "10:00", end_time: "12:00", customer_name: "Jane Citizen", customer_email: "jane@example.com" },
      { conversationId: "cv_mail", userTurn: 1, now: NOW },
    );
    const autumn = (await confirmDraft(db, draft.draftId, { conversationId: "cv_mail", userTurn: 2, now: NOW })).booking;
    expect(renderConfirmationEmail(autumn).text).toContain("10:00 am – 12:00 pm (AEST)");
  });

  it("says it is a demo built for the assessment", () => {
    const { html, text } = renderConfirmationEmail(booking);
    for (const s of [text, html]) expect(s).toContain("This is a demo built for the Eastern Essence Studio technical assessment.");
  });
});

describe("reserved test addresses", () => {
  it.each([
    ["jane@example.com", true],
    ["jane@mail.example.org", true],
    ["a@b.test", true],
    ["a@thing.invalid", true],
    ["a@localhost", true],
    ["jane@gmail.com", false],
    ["jane@example.com.au", false],
    ["jane@myexample.com", false],
  ])("%s is reserved: %s", (email, reserved) => {
    expect(isReservedAddress(email)).toBe(reserved);
  });

  it("skips the send for them even with a real API key, and stays previewable", async () => {
    // A key that would fail if used: the reserved check must return before any request.
    vi.stubEnv("RESEND_API_KEY", "re_not_a_real_key");
    const result = await sendConfirmationEmail(db, booking.id);
    expect(result.status).toBe("demo_address");
    expect((await sendConfirmationEmail(db, booking.id)).status).toBe("already_sent");
    const [log] = await db.query<{ status: string; sent_at: Date | null }>(
      `SELECT status, sent_at FROM email_log WHERE booking_id = $1`,
      [booking.id],
    );
    expect(log.status).toBe("demo_address");
    expect(log.sent_at).not.toBeNull();
  });
});
