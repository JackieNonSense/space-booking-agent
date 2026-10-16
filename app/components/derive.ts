import type { CancellationState, QuoteState } from "./cards";
import type { ChatMessage, FocusSlot, Part } from "./types";

// Everything the UI shows about "where the booking is" is derived from tool
// results, never from the model's prose, so it can't drift from the database.

export type ToolPart = Extract<Part, { kind: "tool" }>;
type Data = Record<string, unknown>;

export type Stage = "idle" | "when" | "room" | "quote" | "booked" | "cancelled";

export interface BookingProgress {
  stage: Stage;
  date?: string;
  dateLabel?: string;
  time?: string;
  duration?: string;
  roomName?: string;
  customerName?: string;
  customerEmail?: string;
  total?: string;
  subtotal?: string;
  discountApplied?: boolean;
  refCode?: string;
  bookingId?: string;
  email?: { status: string; to: string };
  /** Reference of the booking a pending or finished move replaces. */
  replacesRef?: string;
  /** A cancellation is waiting for the customer's OK. */
  cancelPending?: boolean;
}

export function toolParts(messages: ChatMessage[]): ToolPart[] {
  return messages.flatMap((m) => m.parts.filter((p): p is ToolPart => p.kind === "tool"));
}

const s = (v: unknown) => (typeof v === "string" ? v : undefined);

function clockLabel(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function shortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** The booking-shaped fields shared by drafts, bookings and lookups. */
function fromBooking(d: Data): Omit<BookingProgress, "stage"> {
  return {
    date: s(d.date),
    dateLabel: s(d.date) ? shortDate(String(d.date)) : undefined,
    time: s(d.start) && s(d.end) ? `${clockLabel(String(d.start))} – ${clockLabel(String(d.end))}` : undefined,
    duration: s(d.duration),
    roomName: s(d.roomName),
    customerName: s(d.customerName),
    customerEmail: s(d.customerEmail),
    total: s(d.total),
    subtotal: s(d.subtotal),
    discountApplied: d.discountApplied === true,
  };
}

export function bookingProgress(parts: ToolPart[]): BookingProgress {
  let p: BookingProgress = { stage: "idle" };
  for (const part of parts) {
    const d = part.result?.ok ? (part.result.data as Data) : null;
    if (!d) continue;

    switch (part.name) {
      case "check_availability": {
        const req = d.requested as
          | { start: string; end: string; durationHours: number; rooms: Array<{ room: string; available: boolean }> }
          | null;
        // A room counts as chosen only if it's actually free for that slot.
        const asked = (part.input as { room?: string | null } | null)?.room;
        const room = asked && req?.rooms.some((r) => r.room === asked && r.available) ? asked : null;
        // A new search after a finished booking starts a fresh one.
        if (p.stage === "booked" || p.stage === "cancelled") p = { stage: "idle" };
        p = {
          ...p,
          stage: p.stage === "quote" ? "quote" : room ? "room" : "when",
          date: s(d.date),
          dateLabel: s(d.date) ? shortDate(String(d.date)) : undefined,
          time: req ? `${clockLabel(req.start)} – ${clockLabel(req.end)}` : p.time,
          duration: req ? `${req.durationHours} ${req.durationHours === 1 ? "hour" : "hours"}` : p.duration,
          roomName: room ? `Room ${room}` : p.roomName,
        };
        break;
      }
      case "create_booking_draft": {
        const replaces = d.replaces as { refCode: string } | null;
        p = { stage: "quote", ...fromBooking(d), replacesRef: replaces?.refCode };
        break;
      }
      case "confirm_booking": {
        const replaced = d.replaced as { refCode: string } | null;
        p = { stage: "booked", ...fromBooking(d), refCode: s(d.refCode), bookingId: s(d.id), replacesRef: replaced?.refCode };
        break;
      }
      case "find_booking":
        p = {
          stage: d.status === "cancelled" ? "cancelled" : "booked",
          ...fromBooking(d),
          refCode: s(d.refCode),
          bookingId: s(d.id),
        };
        break;
      case "request_cancellation":
        p = { stage: "booked", ...fromBooking(d), refCode: s(d.refCode), bookingId: s(d.id), cancelPending: true };
        break;
      case "confirm_cancellation": {
        const email = d.email as { status: string; to: string } | undefined;
        p = { stage: "cancelled", ...fromBooking(d), refCode: s(d.refCode), bookingId: s(d.id), email };
        break;
      }
      case "send_confirmation_email":
        if (p.stage === "booked") p = { ...p, email: { status: String(d.status), to: String(d.to) } };
        break;
    }
  }
  return p;
}

export function focusSlot(parts: ToolPart[]): FocusSlot | null {
  let current: FocusSlot | null = null;
  for (const p of parts) {
    const d = p.result?.ok ? p.result.data : null;
    if (!d) continue;
    if (p.name === "check_availability") {
      const req = d.requested as { start: string; end: string } | null;
      const room = (p.input as { room?: "A" | "B" | null } | null)?.room ?? null;
      current = { date: String(d.date), start: req?.start, end: req?.end, room };
    } else if (["create_booking_draft", "confirm_booking", "find_booking", "request_cancellation"].includes(p.name)) {
      current = { date: String(d.date), start: String(d.start), end: String(d.end), room: d.room as "A" | "B" };
    } else if (p.name === "confirm_cancellation") {
      current = { date: String(d.date) };
    }
  }
  return current;
}

export function bookedIds(parts: ToolPart[]): Set<string> {
  return new Set(
    parts.filter((p) => p.name === "confirm_booking" && p.result?.ok).map((p) => String(p.result!.data.id)),
  );
}

export function quoteStates(parts: ToolPart[]): Map<string, QuoteState> {
  const quotes = parts.filter((p) => p.name === "create_booking_draft" && p.result?.ok);
  const confirmed = new Set(
    parts
      .filter((p) => p.name === "confirm_booking" && p.result?.ok)
      .map((p) => (p.input as { draft_id?: string } | null)?.draft_id),
  );
  const states = new Map<string, QuoteState>();
  quotes.forEach((q, i) => {
    const draftId = String(q.result!.data.draftId);
    states.set(q.id, confirmed.has(draftId) ? "booked" : i === quotes.length - 1 ? "active" : "superseded");
  });
  return states;
}

export function cancellationStates(parts: ToolPart[]): Map<string, CancellationState> {
  const requests = parts.filter((p) => p.name === "request_cancellation" && p.result?.ok);
  const confirmed = new Set(
    parts
      .filter((p) => p.name === "confirm_cancellation" && p.result?.ok)
      .map((p) => (p.input as { cancellation_id?: string } | null)?.cancellation_id),
  );
  const states = new Map<string, CancellationState>();
  requests.forEach((r, i) => {
    const id = String(r.result!.data.cancellationId);
    states.set(r.id, confirmed.has(id) ? "done" : i === requests.length - 1 ? "active" : "superseded");
  });
  return states;
}

// ---------------------------------------------------------------------------
// Plain-language step summaries for the chat and the activity log

export type StepTone = "running" | "ok" | "error" | "info";

export interface StepSummary {
  tone: StepTone;
  title: string;
  detail?: string;
}

function shortTime(start?: unknown, end?: unknown) {
  return typeof start === "string" && typeof end === "string" ? `${clockLabel(start)} – ${clockLabel(end)}` : undefined;
}

const RUNNING: Record<string, string> = {
  check_availability: "Checking availability",
  calculate_price: "Calculating the price",
  create_booking_draft: "Preparing a quote",
  confirm_booking: "Booking the room",
  send_confirmation_email: "Sending the confirmation",
  find_booking: "Looking up the booking",
  request_cancellation: "Preparing the cancellation",
  confirm_cancellation: "Cancelling the booking",
};

const FAILED: Record<string, string> = {
  check_availability: "Couldn't check availability",
  calculate_price: "Couldn't calculate the price",
  create_booking_draft: "Couldn't prepare the quote",
  confirm_booking: "Couldn't book the room",
  send_confirmation_email: "Couldn't send the email",
  find_booking: "No booking matched",
  request_cancellation: "Couldn't start the cancellation",
  confirm_cancellation: "Couldn't cancel the booking",
};

export function describeStep(p: ToolPart): StepSummary {
  if (!p.result) return { tone: "running", title: RUNNING[p.name] ?? "Working" };

  const d = p.result.data as Data;
  const join = (...xs: Array<string | undefined>) => xs.filter(Boolean).join(" · ");
  const date = s(d.date) ? shortDate(String(d.date)) : undefined;

  if (!p.result.ok) {
    const code = s(d.error_code);
    const message = s(d.message);
    if (code === "NEEDS_USER_CONFIRMATION") {
      return { tone: "info", title: "Waiting for your confirmation", detail: "Nothing changes until you say yes" };
    }
    if (code === "ROOM_UNAVAILABLE") return { tone: "error", title: "Room not available", detail: message };
    if (code === "BOOKING_NOT_FOUND") return { tone: "error", title: "No booking matched", detail: "The reference and email must both match" };
    if (code === "ALREADY_CANCELLED") return { tone: "info", title: "Already cancelled", detail: message };
    return { tone: "error", title: FAILED[p.name] ?? "Step failed", detail: message };
  }

  switch (p.name) {
    case "check_availability": {
      const req = d.requested as { start: string; end: string; rooms: Array<{ roomName: string; available: boolean }> } | null;
      const rooms = req?.rooms.map((r) => `${r.roomName} ${r.available ? "free" : "booked"}`).join(", ");
      return { tone: "ok", title: "Checked availability", detail: join(date, req ? shortTime(req.start, req.end) : "whole day", rooms) };
    }
    case "calculate_price":
      return { tone: "ok", title: "Calculated the price", detail: join(`${d.duration_hours} hours`, s(d.total)) };
    case "create_booking_draft": {
      const replaces = d.replaces as { refCode: string } | null;
      return replaces
        ? { tone: "ok", title: "Prepared a new time", detail: join(`replaces ${replaces.refCode}`, s(d.roomName), date, shortTime(d.start, d.end), s(d.priceDifference)) }
        : { tone: "ok", title: "Prepared a quote", detail: join(s(d.roomName), date, shortTime(d.start, d.end), s(d.total)) };
    }
    case "confirm_booking": {
      const replaced = d.replaced as { refCode: string } | null;
      if (replaced) return { tone: "ok", title: "Moved the booking", detail: `${replaced.refCode} → ${s(d.refCode)}` };
      return { tone: "ok", title: d.already_confirmed ? "Booking already confirmed" : "Booked the room", detail: join(s(d.roomName), s(d.refCode)) };
    }
    case "send_confirmation_email": {
      const status = s(d.status);
      const auto = p.automatic ? "sent by the booking system" : undefined;
      const what = d.kind === "updated" ? "update" : d.kind === "cancelled" ? "cancellation notice" : "confirmation";
      if (status === "dry_run") return { tone: "ok", title: `Prepared the ${what} email`, detail: join(`for ${s(d.to)}`, "not sent from this test server") };
      if (status === "already_sent") return { tone: "ok", title: `The ${what} was already sent`, detail: s(d.to) };
      if (status === "failed") return { tone: "error", title: "Couldn't send the email", detail: `${s(d.to)} · the change itself went through` };
      return { tone: "ok", title: `Emailed the ${what}`, detail: join(s(d.to), auto) };
    }
    case "find_booking":
      return { tone: "ok", title: "Found the booking", detail: join(s(d.refCode), s(d.roomName), date, shortTime(d.start, d.end), d.status === "cancelled" ? "cancelled" : undefined) };
    case "request_cancellation":
      return { tone: "info", title: "Ready to cancel", detail: join(s(d.refCode), "waiting for your confirmation") };
    case "confirm_cancellation": {
      const email = d.email as { status: string; to: string } | undefined;
      return {
        tone: "ok",
        title: d.already_cancelled ? "Booking already cancelled" : "Cancelled the booking",
        detail: join(s(d.refCode), email?.status === "sent" ? `notice emailed to ${email.to}` : email?.status === "dry_run" ? "notice not sent from this test server" : undefined),
      };
    }
  }
  return { tone: "ok", title: p.name };
}

/** Suggested next replies for the current stage of the booking. */
export function quickReplies(progress: BookingProgress, quoteActive: boolean, cancelActive: boolean): string[] {
  if (cancelActive) return ["Yes, cancel it", "No, keep my booking"];
  if (progress.stage === "quote" && quoteActive) {
    return progress.replacesRef
      ? ["Yes, move my booking", "Choose a different time"]
      : ["Yes, confirm the booking", "Change the time", "Change my email"];
  }
  if (progress.stage === "booked") return ["Move this booking", "Cancel this booking", "Book another room"];
  if (progress.stage === "cancelled") return ["Book another time"];
  if (progress.stage === "when" || progress.stage === "room") return ["What's free that day?", "How much would 4 hours cost?"];
  return [];
}
