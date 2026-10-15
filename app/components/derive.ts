import type { QuoteState } from "./cards";
import type { ChatMessage, FocusSlot, Part } from "./types";

// Everything the UI shows about "where the booking is" is derived from tool
// results, never from the model's prose, so it can't drift from the database.

export type ToolPart = Extract<Part, { kind: "tool" }>;
type Data = Record<string, unknown>;

export type Stage = "idle" | "when" | "room" | "quote" | "booked";

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

export function bookingProgress(parts: ToolPart[]): BookingProgress {
  let p: BookingProgress = { stage: "idle" };
  for (const part of parts) {
    const d = part.result?.ok ? (part.result.data as Data) : null;
    if (!d) continue;

    if (part.name === "check_availability") {
      const req = d.requested as
        | { start: string; end: string; durationHours: number; rooms: Array<{ room: string; available: boolean }> }
        | null;
      // A room counts as chosen only if it's actually free for that slot.
      const asked = (part.input as { room?: string | null } | null)?.room;
      const room = asked && req?.rooms.some((r) => r.room === asked && r.available) ? asked : null;
      // A new search after a finished booking starts a fresh one.
      if (p.stage === "booked") p = { stage: "idle" };
      p = {
        ...p,
        stage: p.stage === "quote" ? "quote" : room ? "room" : "when",
        date: s(d.date),
        dateLabel: s(d.date) ? shortDate(String(d.date)) : undefined,
        time: req ? `${clockLabel(req.start)} – ${clockLabel(req.end)}` : p.time,
        duration: req ? `${req.durationHours} ${req.durationHours === 1 ? "hour" : "hours"}` : p.duration,
        roomName: room ? `Room ${room}` : p.roomName,
      };
    } else if (part.name === "create_booking_draft" || part.name === "confirm_booking") {
      const booked = part.name === "confirm_booking";
      p = {
        stage: booked ? "booked" : "quote",
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
        refCode: booked ? s(d.refCode) : undefined,
        bookingId: booked ? s(d.id) : undefined,
      };
    } else if (part.name === "send_confirmation_email" && p.stage === "booked") {
      p = { ...p, email: { status: String(d.status), to: String(d.to) } };
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
    } else if (p.name === "create_booking_draft" || p.name === "confirm_booking") {
      current = { date: String(d.date), start: String(d.start), end: String(d.end), room: d.room as "A" | "B" };
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

export function describeStep(p: ToolPart): StepSummary {
  const running: Record<string, string> = {
    check_availability: "Checking availability",
    calculate_price: "Calculating the price",
    create_booking_draft: "Preparing a quote",
    confirm_booking: "Booking the room",
    send_confirmation_email: "Sending the confirmation",
  };
  if (!p.result) return { tone: "running", title: running[p.name] ?? "Working" };

  const d = p.result.data as Data;
  const join = (...xs: Array<string | undefined>) => xs.filter(Boolean).join(" · ");

  if (!p.result.ok) {
    const code = s(d.error_code);
    const message = s(d.message);
    if (code === "NEEDS_USER_CONFIRMATION") {
      return { tone: "info", title: "Held the booking for your confirmation", detail: "Nothing is booked until you accept the quote" };
    }
    if (code === "ROOM_UNAVAILABLE") return { tone: "error", title: "Room not available", detail: message };
    const failed: Record<string, string> = {
      check_availability: "Couldn't check availability",
      calculate_price: "Couldn't calculate the price",
      create_booking_draft: "Couldn't prepare the quote",
      confirm_booking: "Couldn't book the room",
      send_confirmation_email: "Couldn't send the email",
    };
    return { tone: "error", title: failed[p.name] ?? "Step failed", detail: message };
  }

  switch (p.name) {
    case "check_availability": {
      const req = d.requested as { start: string; end: string; rooms: Array<{ roomName: string; available: boolean }> } | null;
      const date = s(d.date) ? shortDate(String(d.date)) : undefined;
      const rooms = req?.rooms.map((r) => `${r.roomName} ${r.available ? "free" : "booked"}`).join(", ");
      return {
        tone: "ok",
        title: "Checked availability",
        detail: join(date, req ? shortTime(req.start, req.end) : "whole day", rooms),
      };
    }
    case "calculate_price":
      return { tone: "ok", title: "Calculated the price", detail: join(`${d.duration_hours} hours`, s(d.total)) };
    case "create_booking_draft":
      return {
        tone: "ok",
        title: "Prepared a quote",
        detail: join(s(d.roomName), s(d.date) ? shortDate(String(d.date)) : undefined, shortTime(d.start, d.end), s(d.total)),
      };
    case "confirm_booking":
      return { tone: "ok", title: d.already_confirmed ? "Booking already confirmed" : "Booked the room", detail: join(s(d.roomName), s(d.refCode)) };
    case "send_confirmation_email": {
      const status = s(d.status);
      const auto = p.automatic ? "sent by the booking system" : undefined;
      if (status === "dry_run") return { tone: "ok", title: "Prepared the confirmation email", detail: join(`for ${s(d.to)}`, "not sent from this test server") };
      if (status === "already_sent") return { tone: "ok", title: "Confirmation already sent", detail: s(d.to) };
      if (status === "failed") return { tone: "error", title: "Couldn't send the email", detail: s(d.error) };
      return { tone: "ok", title: "Emailed the confirmation", detail: join(s(d.to), auto) };
    }
  }
  return { tone: "ok", title: p.name };
}

/** Suggested next replies for the current stage of the booking. */
export function quickReplies(progress: BookingProgress, quoteActive: boolean): string[] {
  if (progress.stage === "quote" && quoteActive) {
    return ["Yes, confirm the booking", "Change the time", "Change my email"];
  }
  if (progress.stage === "booked") return ["Book another room", "What else is free that day?"];
  if (progress.stage === "when" || progress.stage === "room") return ["What's free that day?", "How much would 4 hours cost?"];
  return [];
}
