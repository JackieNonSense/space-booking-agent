import { DateTime } from "luxon";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmCancellation,
  confirmDraft,
  createDraft,
  findBooking,
  requestCancellation,
  scheduleBetween,
  type BookingView,
} from "@/lib/bookings";
import { TIMEZONE } from "@/lib/config";
import { pgliteDb, type Db } from "@/lib/db";
import { renderBookingEmail, sendBookingEmail } from "@/lib/email";
import { BookingError } from "@/lib/errors";
import { SCHEMA_SQL } from "@/lib/schema";
import { seedDemoBookings } from "@/lib/seed";

// Saturday 10 Oct 2026, 09:15. Tuesday 13 Oct has a sample booking in
// Room A from 14:00 to 18:00 and nothing in Room B.
const NOW = DateTime.fromISO("2026-10-10T09:15", { zone: TIMEZONE });
const TUESDAY = "2026-10-13";
const JANE = { customer_name: "Jane Citizen", customer_email: "jane@example.com" };

let db: Db;
beforeAll(async () => {
  db = await pgliteDb();
});
beforeEach(async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  await db.query(`TRUNCATE email_log, pending_cancellations, bookings, booking_drafts, conversations, request_log`);
  await seedDemoBookings(db, NOW);
});

const ctx = (userTurn: number, conversationId = "cv_manage") => ({ conversationId, userTurn, now: NOW });

async function book(room: "A" | "B", start: string, end: string, who = JANE, conversation = "cv_manage") {
  const draft = await createDraft(db, { room, date: TUESDAY, start_time: start, end_time: end, ...who }, ctx(1, conversation));
  return (await confirmDraft(db, draft.draftId, ctx(2, conversation))).booking;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof BookingError) return err.code;
    throw err;
  }
  return "no error";
}

const statusOf = async (id: string) =>
  (await db.query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [id]))[0]?.status;

describe("findBooking", () => {
  it("needs the reference and the email together", async () => {
    const b = await book("A", "09:00", "11:00");
    expect((await findBooking(db, b.refCode, "JANE@example.com")).id).toBe(b.id);
    expect((await findBooking(db, b.refCode.toLowerCase(), "jane@example.com")).id).toBe(b.id);
    expect(await codeOf(findBooking(db, b.refCode, "someone@example.com"))).toBe("BOOKING_NOT_FOUND");
    expect(await codeOf(findBooking(db, "EE-ZZZZZZ", "jane@example.com"))).toBe("BOOKING_NOT_FOUND");
  });

  it("never exposes sample bookings", async () => {
    const [seed] = await db.query<{ ref_code: string }>(`SELECT ref_code FROM bookings WHERE source = 'seed' LIMIT 1`);
    expect(await codeOf(findBooking(db, seed.ref_code, "demo@example.com"))).toBe("BOOKING_NOT_FOUND");
  });
});

describe("rescheduling", () => {
  it("moves a booking onto time that overlaps its own slot", async () => {
    const original = await book("A", "09:00", "12:00");
    const draft = await createDraft(
      db,
      { room: "A", date: TUESDAY, start_time: "10:00", end_time: "13:00", ...JANE, reschedule_reference: original.refCode },
      ctx(3),
    );
    expect(draft.replaces?.refCode).toBe(original.refCode);
    expect(draft.priceDifference).toBe("Same price");
    expect(await codeOf(confirmDraft(db, draft.draftId, ctx(3)))).toBe("NEEDS_USER_CONFIRMATION");

    const { booking, replaced } = await confirmDraft(db, draft.draftId, ctx(4));
    expect(booking.start).toBe("10:00");
    expect(booking.refCode).not.toBe(original.refCode);
    expect(replaced?.status).toBe("cancelled");
    expect(await statusOf(original.id)).toBe("cancelled");

    const tuesdayA = (await scheduleBetween(db, NOW, 7)).filter((b) => b.date === TUESDAY && b.room === "A");
    expect(tuesdayA.map((b) => `${b.start}-${b.end}`).sort()).toEqual(["10:00-13:00", "14:00-18:00"]);
  });

  it("shows the price difference", async () => {
    const original = await book("B", "09:00", "11:00"); // 2 h, $200
    const draft = await createDraft(
      db,
      { room: "B", date: TUESDAY, start_time: "13:00", end_time: "17:00", ...JANE, reschedule_reference: original.refCode },
      ctx(3),
    );
    expect(draft.total).toBe("$340.00");
    expect(draft.priceDifference).toBe("+$140.00");
  });

  it("leaves the original untouched if the new slot is taken before confirming", async () => {
    const original = await book("A", "09:00", "11:00");
    const draft = await createDraft(
      db,
      { room: "B", date: TUESDAY, start_time: "10:00", end_time: "12:00", ...JANE, reschedule_reference: original.refCode },
      ctx(3),
    );
    // Someone else takes Room B 10–12 in another conversation first.
    await book("B", "10:00", "12:00", { customer_name: "Sam Other", customer_email: "sam@example.com" }, "cv_other");

    expect(await codeOf(confirmDraft(db, draft.draftId, ctx(4)))).toBe("ROOM_UNAVAILABLE");
    expect(await statusOf(original.id)).toBe("confirmed");
  });

  it("needs the email the booking was made with", async () => {
    const original = await book("A", "09:00", "11:00");
    const attempt = createDraft(
      db,
      {
        room: "B",
        date: TUESDAY,
        start_time: "13:00",
        end_time: "15:00",
        customer_name: "Mallory",
        customer_email: "mallory@example.com",
        reschedule_reference: original.refCode,
      },
      ctx(3),
    );
    expect(await codeOf(attempt)).toBe("BOOKING_NOT_FOUND");
  });
});

describe("cancelling", () => {
  it("waits for the customer, then cancels once", async () => {
    const b = await book("B", "15:00", "17:00");
    const request = await requestCancellation(db, b.refCode, "jane@example.com", ctx(3));
    expect(request.booking.id).toBe(b.id);
    expect(await statusOf(b.id)).toBe("confirmed");
    expect(await codeOf(confirmCancellation(db, request.cancellationId, ctx(3)))).toBe("NEEDS_USER_CONFIRMATION");

    const first = await confirmCancellation(db, request.cancellationId, ctx(4));
    expect(first.alreadyCancelled).toBe(false);
    expect(first.booking.status).toBe("cancelled");
    const again = await confirmCancellation(db, request.cancellationId, ctx(5));
    expect(again.alreadyCancelled).toBe(true);

    expect(await codeOf(requestCancellation(db, b.refCode, "jane@example.com", ctx(6)))).toBe("ALREADY_CANCELLED");
    const schedule = await scheduleBetween(db, NOW, 7);
    expect(schedule.some((s) => s.id === b.id)).toBe(false);
  });

  it("refuses the wrong email", async () => {
    const b = await book("B", "15:00", "17:00");
    expect(await codeOf(requestCancellation(db, b.refCode, "intruder@example.com", ctx(3)))).toBe("BOOKING_NOT_FOUND");
    expect(await statusOf(b.id)).toBe("confirmed");
  });

  it("only confirms requests from the same conversation", async () => {
    const b = await book("B", "15:00", "17:00");
    const request = await requestCancellation(db, b.refCode, "jane@example.com", ctx(3));
    expect(await codeOf(confirmCancellation(db, request.cancellationId, ctx(9, "cv_elsewhere")))).toBe(
      "REQUEST_NOT_FOUND",
    );
  });
});

describe("emails for changes", () => {
  it("sends each kind of email once per booking", async () => {
    const b = await book("B", "15:00", "17:00");
    expect((await sendBookingEmail(db, b.id)).kind).toBe("confirmed");
    const request = await requestCancellation(db, b.refCode, "jane@example.com", ctx(3));
    await confirmCancellation(db, request.cancellationId, ctx(4));
    const cancelled = await sendBookingEmail(db, b.id);
    expect(cancelled).toMatchObject({ kind: "cancelled", status: "dry_run" });
    expect((await sendBookingEmail(db, b.id)).status).toBe("already_sent");
  });

  it("describes an update with the booking it replaced", async () => {
    const original = await book("A", "09:00", "11:00");
    const draft = await createDraft(
      db,
      { room: "A", date: TUESDAY, start_time: "10:00", end_time: "12:00", ...JANE, reschedule_reference: original.refCode },
      ctx(3),
    );
    const { booking } = await confirmDraft(db, draft.draftId, ctx(4));
    const result = await sendBookingEmail(db, booking.id);
    expect(result.kind).toBe("updated");
    expect(result.subject).toMatch(/^Booking updated/);

    const prev = { ...original, status: "cancelled" } as BookingView;
    const { text } = renderBookingEmail(booking, "updated", prev);
    expect(text).toContain(`Replaces: Room A, Tuesday 13 October 2026, 9:00 am – 11:00 am (${original.refCode}`);
  });
});

describe("schema upgrade", () => {
  it("upgrades a database created by the first version in place", async () => {
    const [{ PGlite }, { btree_gist }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("@electric-sql/pglite/contrib/btree_gist"),
    ]);
    const pg = await PGlite.create("memory://", { extensions: { btree_gist } });
    // The original tables, before change and cancel existed.
    await pg.exec(`
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      CREATE TABLE bookings (
        id text PRIMARY KEY, ref_code text NOT NULL UNIQUE, room text NOT NULL,
        starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
        customer_name text NOT NULL, customer_email text NOT NULL, duration_minutes integer NOT NULL,
        subtotal_cents integer NOT NULL, discount_cents integer NOT NULL, total_cents integer NOT NULL,
        status text NOT NULL DEFAULT 'confirmed', source text NOT NULL DEFAULT 'agent',
        draft_id text UNIQUE, conversation_id text, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE booking_drafts (id text PRIMARY KEY, conversation_id text NOT NULL);
      CREATE TABLE email_log (
        booking_id text PRIMARY KEY REFERENCES bookings(id), to_email text NOT NULL, subject text NOT NULL,
        status text NOT NULL, provider_id text, error text, attempts integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
      );
      INSERT INTO bookings (id, ref_code, room, starts_at, ends_at, customer_name, customer_email,
        duration_minutes, subtotal_cents, discount_cents, total_cents)
      VALUES ('bk_old', 'EE-OLDOLD', 'A', '2026-10-13T09:00+11', '2026-10-13T11:00+11', 'Old', 'old@example.com', 120, 20000, 0, 20000);
      INSERT INTO email_log (booking_id, to_email, subject, status) VALUES ('bk_old', 'old@example.com', 's', 'sent');
    `);

    await pg.exec(SCHEMA_SQL);
    await pg.exec(SCHEMA_SQL); // and again, as every cold start does

    const [log] = (await pg.query<{ kind: string }>(`SELECT kind FROM email_log WHERE booking_id = 'bk_old'`)).rows;
    expect(log.kind).toBe("confirmed");
    await pg.query(
      `INSERT INTO email_log (booking_id, kind, to_email, subject, status) VALUES ('bk_old', 'cancelled', 'old@example.com', 's', 'sent')`,
    );
    const columns = (
      await pg.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'bookings'`,
      )
    ).rows.map((r) => r.column_name);
    expect(columns).toEqual(expect.arrayContaining(["cancelled_at", "replaces", "replaced_by"]));
  });
});
