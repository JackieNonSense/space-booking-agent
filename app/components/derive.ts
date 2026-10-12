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
