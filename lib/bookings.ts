import { DateTime } from "luxon";
import {
  CLOSE_MINUTE,
  DRAFT_TTL_MINUTES,
  OPEN_MINUTE,
  ROOM_IDS,
  ROOMS,
  SLOT_MINUTES,
  TIMEZONE,
  type RoomId,
} from "./config";
import { PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, pgErrorCode, type Db } from "./db";
import { BookingError } from "./errors";
import { newId, newRefCode } from "./ids";
import { calculatePrice, cheaperLongerOption, formatHours, formatMoney } from "./pricing";
import {
  clock,
  clockLabel,
  dateLabel,
  parseDate,
  resolveSlot,
  slotLabel,
  type Slot,
  type SlotInput,
} from "./time";

// ---------------------------------------------------------------------------
// Shapes shared with the agent tools and the UI cards

export interface Interval {
  startMinute: number;
  endMinute: number;
}

export interface TimeWindow {
  start: string;
  end: string;
  label: string;
}

export interface BookingView {
  id: string;
  refCode: string;
  room: RoomId;
  roomName: string;
  date: string;
  start: string;
  end: string;
  when: string;
  durationMinutes: number;
  duration: string;
  customerName: string;
  customerEmail: string;
  subtotal: string;
  discount: string;
  total: string;
  totalCents: number;
  discountApplied: boolean;
}

export interface DraftView extends Omit<BookingView, "id" | "refCode"> {
  draftId: string;
  breakdown: string;
  expiresAt: string;
  cheaperAlternative: string | null;
}

export interface Alternative {
  room: RoomId;
  roomName: string;
  date: string;
  start: string;
  end: string;
  label: string;
}

interface BookingRow {
  id: string;
  ref_code: string;
  room: RoomId;
  starts_at: Date | string;
  ends_at: Date | string;
  customer_name: string;
  customer_email: string;
  duration_minutes: number;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  source: string;
  draft_id: string | null;
}

interface DraftRow extends Omit<BookingRow, "ref_code" | "source" | "draft_id"> {
  conversation_id: string;
  created_user_turn: number;
  expires_at: Date | string;
}

// ---------------------------------------------------------------------------
// Helpers

export function toStudioTime(value: Date | string): DateTime {
  const dt = value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value);
  return dt.setZone(TIMEZONE);
}

const minuteOfDay = (dt: DateTime) => dt.hour * 60 + dt.minute;
const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function window(startMinute: number, endMinute: number): TimeWindow {
  return {
    start: clock(startMinute),
    end: clock(endMinute),
    label: `${clockLabel(startMinute)} – ${clockLabel(endMinute)}`,
  };
}

/** Gaps between busy intervals within [from, to), in minutes after midnight. */
export function freeWindows(busy: Interval[], from: number, to: number): Interval[] {
  const sorted = [...busy].sort((a, b) => a.startMinute - b.startMinute);
  const free: Interval[] = [];
  let cursor = from;
  for (const b of sorted) {
    if (b.endMinute <= cursor) continue;
    if (b.startMinute >= to) break;
    if (b.startMinute > cursor) free.push({ startMinute: cursor, endMinute: b.startMinute });
    cursor = Math.max(cursor, b.endMinute);
  }
  if (cursor < to) free.push({ startMinute: cursor, endMinute: to });
  return free;
}

const overlaps = (a: Interval, b: Interval) =>
  a.startMinute < b.endMinute && b.startMinute < a.endMinute;

function rowToView(row: BookingRow): BookingView {
  const start = toStudioTime(row.starts_at);
  const end = toStudioTime(row.ends_at);
  const date = start.toISODate()!;
  const startMinute = minuteOfDay(start);
  const endMinute = minuteOfDay(end);
  return {
    id: row.id,
    refCode: row.ref_code,
    room: row.room,
    roomName: ROOMS[row.room].name,
    date,
    start: clock(startMinute),
    end: clock(endMinute),
    when: slotLabel({ date, startMinute, endMinute }),
    durationMinutes: row.duration_minutes,
    duration: formatHours(row.duration_minutes / 60),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    subtotal: formatMoney(row.subtotal_cents),
    discount: formatMoney(row.discount_cents),
    total: formatMoney(row.total_cents),
    totalCents: row.total_cents,
    discountApplied: row.discount_cents > 0,
  };
}

// ---------------------------------------------------------------------------
// Queries

/** Busy intervals per room for one studio day. */
export async function busyByRoom(db: Db, date: string): Promise<Record<RoomId, Interval[]>> {
  const day = parseDate(date);
  const rows = await db.query<Pick<BookingRow, "room" | "starts_at" | "ends_at">>(
    `SELECT room, starts_at, ends_at FROM bookings
      WHERE status = 'confirmed' AND starts_at < $2 AND ends_at > $1
      ORDER BY starts_at`,
    [day.toISO(), day.plus({ days: 1 }).toISO()],
  );
  const result = Object.fromEntries(ROOM_IDS.map((r) => [r, [] as Interval[]])) as Record<
    RoomId,
    Interval[]
  >;
  for (const row of rows) {
    result[row.room].push({
      startMinute: minuteOfDay(toStudioTime(row.starts_at)),
      endMinute: minuteOfDay(toStudioTime(row.ends_at)),
    });
  }
  return result;
}

/** First bookable minute on `date`, given the current time. */
function earliestStart(date: string, now: DateTime): number {
  const day = parseDate(date);
  if (day > now.startOf("day")) return OPEN_MINUTE;
  if (day < now.startOf("day")) return CLOSE_MINUTE;
  const next = Math.ceil((minuteOfDay(now) + 1) / SLOT_MINUTES) * SLOT_MINUTES;
  return Math.min(Math.max(OPEN_MINUTE, next), CLOSE_MINUTE);
}

export function suggestAlternatives(
  busy: Record<RoomId, Interval[]>,
  wanted: { room: RoomId | null; date: string; startMinute: number; endMinute: number },
  now: DateTime,
  limit = 3,
): Alternative[] {
  const duration = wanted.endMinute - wanted.startMinute;
  const from = earliestStart(wanted.date, now);
  const make = (room: RoomId, s: number): Alternative => ({
    room,
    roomName: ROOMS[room].name,
    date: wanted.date,
    start: clock(s),
    end: clock(s + duration),
    label: `${ROOMS[room].name}, ${clockLabel(s)} – ${clockLabel(s + duration)}`,
  });
  const fits = (room: RoomId, s: number) =>
    s >= from &&
    s + duration <= CLOSE_MINUTE &&
    !busy[room].some((b) => overlaps(b, { startMinute: s, endMinute: s + duration }));

  const out: Alternative[] = [];
  const rooms = wanted.room ? [wanted.room, ...ROOM_IDS.filter((r) => r !== wanted.room)] : ROOM_IDS;

  // Same time in another room is the least disruptive change.
  for (const room of rooms.slice(wanted.room ? 1 : 0)) {
    if (fits(room, wanted.startMinute)) out.push(make(room, wanted.startMinute));
  }
  // Then real choices rather than 4:00 / 4:30 / 5:00: in each room the nearest
  // later and nearest earlier start, closest first, then anything else.
  // Options in the same room stay at least two hours apart.
  const tooClose = (room: RoomId, s: number) =>
    out.some((a) => a.room === room && Math.abs(toMinute(a.start) - s) < 120);
  const options: Array<{ room: RoomId; s: number; dist: number }> = [];
  for (const room of rooms) {
    for (let s = OPEN_MINUTE; s + duration <= CLOSE_MINUTE; s += SLOT_MINUTES) {
      if (s !== wanted.startMinute && fits(room, s)) {
        options.push({ room, s, dist: Math.abs(s - wanted.startMinute) });
      }
    }
  }
  options.sort((a, b) => a.dist - b.dist);
  const nearest = (room: RoomId, later: boolean) =>
    options.find((o) => o.room === room && o.s > wanted.startMinute === later && !tooClose(room, o.s));
  const firstPass = rooms
    .flatMap((room) => [nearest(room, true), nearest(room, false)])
    .filter((o): o is (typeof options)[number] => Boolean(o))
    .sort((a, b) => a.dist - b.dist);
  for (const o of [...firstPass, ...options]) {
    if (out.length >= limit) break;
    if (!tooClose(o.room, o.s)) out.push(make(o.room, o.s));
  }
  return out;
}

export interface AvailabilityInput {
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_hours?: number | null;
  room?: RoomId | null;
}

export async function checkAvailability(db: Db, input: AvailabilityInput, now: DateTime) {
  const date = parseDate(input.date).toISODate()!;
  if (parseDate(date) < now.startOf("day")) {
    throw new BookingError("IN_PAST", `${dateLabel(date)} has already passed.`);
  }
  const busy = await busyByRoom(db, date);
  const from = earliestStart(date, now);
  const rooms = input.room ? [input.room] : ROOM_IDS;

  const freeToday = Object.fromEntries(
    rooms.map((room) => [
      ROOMS[room].name,
      freeWindows(busy[room], from, CLOSE_MINUTE)
        .filter((w) => w.endMinute - w.startMinute >= 60)
        .map((w) => window(w.startMinute, w.endMinute)),
    ]),
  );
  const base = {
    date,
    dateLabel: dateLabel(date),
    openingHours: window(OPEN_MINUTE, CLOSE_MINUTE).label,
    freeWindows: freeToday,
  };

  if (!input.start_time) return { ...base, requested: null, alternatives: [] as Alternative[] };

  const slot = resolveSlot({ ...input, date, start_time: input.start_time }, now);
  const requestedRooms = rooms.map((room) => ({
    room,
    roomName: ROOMS[room].name,
    available: !busy[room].some((b) => overlaps(b, slot)),
  }));
  const noneFree = requestedRooms.every((r) => !r.available);
  return {
    ...base,
    requested: {
      when: slotLabel(slot),
      start: clock(slot.startMinute),
      end: clock(slot.endMinute),
      durationHours: slot.durationMinutes / 60,
      rooms: requestedRooms,
    },
    alternatives: noneFree
      ? suggestAlternatives(busy, { room: input.room ?? null, ...slot }, now)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Drafts and bookings

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface DraftInput extends SlotInput {
  room: RoomId;
  customer_name: string;
  customer_email: string;
}

export async function createDraft(
  db: Db,
  input: DraftInput,
  ctx: { conversationId: string; userTurn: number; now: DateTime },
): Promise<DraftView> {
  const name = input.customer_name.trim().replace(/\s+/g, " ");
  const email = input.customer_email.trim().toLowerCase();
  if (name.length < 2 || name.length > 100) {
    throw new BookingError("INVALID_NAME", "Ask the customer for their full name.");
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    throw new BookingError("INVALID_EMAIL", `"${input.customer_email}" doesn't look like a valid email address.`);
  }
  if (!ROOM_IDS.includes(input.room)) {
    throw new BookingError("ROOM_UNAVAILABLE", `Only ${ROOM_IDS.map((r) => ROOMS[r].name).join(" and ")} can be booked.`);
  }

  const slot = resolveSlot(input, ctx.now);
  await assertFree(db, input.room, slot, ctx.now);

  const price = calculatePrice(slot.durationMinutes);
  const id = newId("dr");
  const expiresAt = ctx.now.plus({ minutes: DRAFT_TTL_MINUTES });
  await db.query(
    `INSERT INTO booking_drafts
       (id, conversation_id, room, starts_at, ends_at, customer_name, customer_email,
        duration_minutes, subtotal_cents, discount_cents, total_cents, created_user_turn, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      ctx.conversationId,
      input.room,
      slot.start.toISO(),
      slot.end.toISO(),
      name,
      email,
      slot.durationMinutes,
      price.subtotalCents,
      price.discountCents,
      price.totalCents,
      ctx.userTurn,
      expiresAt.toISO(),
    ],
  );

  const cheaper = cheaperLongerOption(slot.durationMinutes);
  return {
    draftId: id,
    room: input.room,
    roomName: ROOMS[input.room].name,
    date: slot.date,
    start: clock(slot.startMinute),
    end: clock(slot.endMinute),
    when: slotLabel(slot),
    durationMinutes: slot.durationMinutes,
    duration: formatHours(price.durationHours),
    customerName: name,
    customerEmail: email,
    subtotal: formatMoney(price.subtotalCents),
    discount: formatMoney(price.discountCents),
    total: formatMoney(price.totalCents),
    totalCents: price.totalCents,
    discountApplied: price.discountApplied,
    breakdown: price.breakdown,
    expiresAt: expiresAt.toISO()!,
    cheaperAlternative: cheaper
      ? `Booking ${formatHours(cheaper.durationHours)} instead would cost ${formatMoney(cheaper.totalCents)} (less than ${formatMoney(price.totalCents)}) thanks to the 15% discount for 4+ hours.`
      : null,
  };
}

async function assertFree(db: Db, room: RoomId, slot: Slot, now: DateTime) {
  const busy = await busyByRoom(db, slot.date);
  if (busy[room].some((b) => overlaps(b, slot))) {
    throw unavailableError(busy, room, slot, now);
  }
}

function unavailableError(busy: Record<RoomId, Interval[]>, room: RoomId, slot: Slot, now: DateTime) {
  return new BookingError(
    "ROOM_UNAVAILABLE",
    `${ROOMS[room].name} is already booked during ${slotLabel(slot)}.`,
    { alternatives: suggestAlternatives(busy, { room, ...slot }, now) },
  );
}

export interface ConfirmResult {
  booking: BookingView;
  alreadyConfirmed: boolean;
}

/**
 * Turns a draft into a booking. Idempotent per draft, and it refuses to run in
 * the same user turn the draft was created in: the customer must have replied
 * to the quote before anything is booked.
 */
export async function confirmDraft(
  db: Db,
  draftId: string,
  ctx: { conversationId: string; userTurn: number; now: DateTime },
): Promise<ConfirmResult> {
  const [draft] = await db.query<DraftRow>(
    `SELECT * FROM booking_drafts WHERE id = $1 AND conversation_id = $2`,
    [draftId, ctx.conversationId],
  );
  if (!draft) {
    throw new BookingError("DRAFT_NOT_FOUND", "That quote doesn't exist. Create a new booking draft.");
  }

  const existing = await bookingByDraft(db, draftId);
  if (existing) return { booking: existing, alreadyConfirmed: true };

  if (ctx.userTurn <= draft.created_user_turn) {
    throw new BookingError(
      "NEEDS_USER_CONFIRMATION",
      "Show the customer the quote and wait for them to accept it before confirming.",
    );
  }
  const start = toStudioTime(draft.starts_at);
  if (toStudioTime(draft.expires_at) < ctx.now) {
    throw new BookingError("DRAFT_EXPIRED", "The quote expired. Create a fresh draft to re-check availability.");
  }
  if (start <= ctx.now) {
    throw new BookingError("IN_PAST", "That time has already passed.");
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newId("bk");
    try {
      const [row] = await db.query<BookingRow>(
        `INSERT INTO bookings
           (id, ref_code, room, starts_at, ends_at, customer_name, customer_email, duration_minutes,
            subtotal_cents, discount_cents, total_cents, draft_id, conversation_id)
         SELECT $1, $2, room, starts_at, ends_at, customer_name, customer_email, duration_minutes,
                subtotal_cents, discount_cents, total_cents, id, conversation_id
           FROM booking_drafts WHERE id = $3
         RETURNING *`,
        [id, newRefCode(), draftId],
      );
      return { booking: rowToView(row), alreadyConfirmed: false };
    } catch (err) {
      const code = pgErrorCode(err);
      if (code === PG_EXCLUSION_VIOLATION) {
        const date = start.toISODate()!;
        const slot = {
          date,
          startMinute: minuteOfDay(start),
          endMinute: minuteOfDay(toStudioTime(draft.ends_at)),
          start,
          end: toStudioTime(draft.ends_at),
          durationMinutes: draft.duration_minutes,
        };
        throw unavailableError(await busyByRoom(db, date), draft.room, slot, ctx.now);
      }
      if (code === PG_UNIQUE_VIOLATION) {
        // Either a concurrent confirm of the same draft won, or a ref-code clash.
        const raced = await bookingByDraft(db, draftId);
        if (raced) return { booking: raced, alreadyConfirmed: true };
        continue;
      }
      throw err;
    }
  }
  throw new Error("Could not allocate a booking reference");
}

async function bookingByDraft(db: Db, draftId: string): Promise<BookingView | null> {
  const [row] = await db.query<BookingRow>(`SELECT * FROM bookings WHERE draft_id = $1`, [draftId]);
  return row ? rowToView(row) : null;
}

export async function getBooking(db: Db, bookingId: string): Promise<BookingView | null> {
  const [row] = await db.query<BookingRow>(
    `SELECT * FROM bookings WHERE id = $1 OR ref_code = $1`,
    [bookingId],
  );
  return row ? rowToView(row) : null;
}

/** Public schedule for the timeline: time blocks only, no customer details. */
export async function scheduleBetween(db: Db, from: DateTime, days: number) {
  const rows = await db.query<Pick<BookingRow, "id" | "room" | "starts_at" | "ends_at" | "source">>(
    `SELECT id, room, starts_at, ends_at, source FROM bookings
      WHERE status = 'confirmed' AND starts_at < $2 AND ends_at > $1
      ORDER BY starts_at`,
    [from.startOf("day").toISO(), from.startOf("day").plus({ days }).toISO()],
  );
  return rows.map((r) => {
    const s = toStudioTime(r.starts_at);
    const e = toStudioTime(r.ends_at);
    return {
      id: r.id,
      room: r.room,
      date: s.toISODate()!,
      start: clock(minuteOfDay(s)),
      end: clock(minuteOfDay(e)),
      demo: r.source === "seed",
    };
  });
}
