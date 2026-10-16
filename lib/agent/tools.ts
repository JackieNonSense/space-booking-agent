import type Anthropic from "@anthropic-ai/sdk";
import type { DateTime } from "luxon";
import { z } from "zod";
import {
  checkAvailability,
  confirmCancellation,
  confirmDraft,
  createDraft,
  findBooking,
  requestCancellation,
  touchedByConversation,
} from "../bookings";
import type { Db } from "../db";
import { sendBookingEmail, sendConfirmationEmail } from "../email";
import { BookingError } from "../errors";
import { calculatePrice, cheaperLongerOption, formatMoney } from "../pricing";
import { parseClock } from "../time";

type Tool = Anthropic.Beta.BetaTool;

const nullable = (schema: Record<string, unknown>, description: string) => ({
  anyOf: [schema, { type: "null" }],
  description,
});

const DATE = { type: "string", description: "Date in YYYY-MM-DD (Australian Eastern time)." };
const TIME = (what: string) => ({ type: "string", description: `${what} as 24-hour HH:MM.` });
const REFERENCE = { type: "string", description: "Booking reference, e.g. EE-7K3Q9M." };
const EMAIL = { type: "string", description: "The email address the booking was made with." };

// Tool order and text are part of the cached, thinking-bound prompt prefix:
// changing them mid-conversation invalidates earlier thinking blocks.
export const TOOLS: Tool[] = [
  {
    name: "check_availability",
    description:
      "Check which rooms are free. With a start time (plus end time or duration) it reports whether each room is free for that slot and suggests alternatives if none is. Without a start time it lists the free time windows of each room on that date. Always call this before quoting or drafting a booking.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        date: DATE,
        start_time: nullable({ type: "string" }, "Requested start, 24-hour HH:MM, or null to list the whole day."),
        end_time: nullable({ type: "string" }, "Requested end, 24-hour HH:MM, or null."),
        duration_hours: nullable({ type: "number" }, "Requested length in hours if no end time was given, or null."),
        room: nullable({ type: "string", enum: ["A", "B"] }, "Only check this room, or null for both."),
      },
      required: ["date", "start_time", "end_time", "duration_hours", "room"],
      additionalProperties: false,
    },
  },
  {
    name: "calculate_price",
    description:
      "Price a booking length without reserving anything, e.g. when the customer asks how much 5 hours costs. Give either duration_hours, or start_time and end_time.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        duration_hours: nullable({ type: "number" }, "Length in hours, or null."),
        start_time: nullable({ type: "string" }, "Start as 24-hour HH:MM, or null."),
        end_time: nullable({ type: "string" }, "End as 24-hour HH:MM, or null."),
      },
      required: ["duration_hours", "start_time", "end_time"],
      additionalProperties: false,
    },
  },
  {
    name: "create_booking_draft",
    description:
      "Validate a booking and produce a price quote held for 15 minutes. Needs the room, date, start time, end time or duration, and the customer's full name and email. Returns a draft_id. This does NOT book the room: show the quote to the customer and wait for them to accept it. To move an existing booking, set reschedule_reference to its reference and use the email it was booked with; the quote then shows what it replaces and the price difference, and confirming it moves the booking.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        room: { type: "string", enum: ["A", "B"], description: "A for Room A, B for Room B." },
        date: DATE,
        start_time: TIME("Start"),
        end_time: nullable({ type: "string" }, "End as 24-hour HH:MM, or null if duration_hours is given."),
        duration_hours: nullable({ type: "number" }, "Length in hours, or null if end_time is given."),
        customer_name: { type: "string", description: "Customer's full name." },
        customer_email: { type: "string", description: "Customer's email address for the confirmation." },
        reschedule_reference: nullable(
          { type: "string" },
          "Reference of the booking this replaces when the customer is moving an existing booking, or null for a new booking.",
        ),
      },
      required: [
        "room",
        "date",
        "start_time",
        "end_time",
        "duration_hours",
        "customer_name",
        "customer_email",
        "reschedule_reference",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_booking",
    description:
      "Book the room for a draft the customer has explicitly accepted in their latest message. Never call it in the same turn the draft was created. For a reschedule draft this moves the booking: the old one is cancelled and a new reference is issued. Returns the booking_id and reference.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { draft_id: { type: "string", description: "The draft_id from create_booking_draft." } },
      required: ["draft_id"],
      additionalProperties: false,
    },
  },
  {
    name: "send_confirmation_email",
    description:
      "Email the booking confirmation (name, room, date and time, duration, total price, reference) to the customer, or the update notice for a moved booking. Call it right after confirm_booking succeeds. Safe to call twice: it never sends duplicates.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { booking_id: { type: "string", description: "The booking_id from confirm_booking." } },
      required: ["booking_id"],
      additionalProperties: false,
    },
  },
  {
    name: "find_booking",
    description:
      "Look up an existing booking. Needs both the booking reference and the email address it was made with; if either is wrong nothing is returned. Use it when a customer asks about, wants to change, or wants to cancel a booking.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { reference: REFERENCE, email: EMAIL },
      required: ["reference", "email"],
      additionalProperties: false,
    },
  },
  {
    name: "request_cancellation",
    description:
      "Start cancelling a booking (reference and email must match). Nothing is cancelled yet: tell the customer what will be cancelled and ask them to confirm. Returns a cancellation_id.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { reference: REFERENCE, email: EMAIL },
      required: ["reference", "email"],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_cancellation",
    description:
      "Cancel the booking for a cancellation the customer has explicitly confirmed in their latest message. Never call it in the same turn as request_cancellation. Emails the customer a cancellation notice.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { cancellation_id: { type: "string", description: "The cancellation_id from request_cancellation." } },
      required: ["cancellation_id"],
      additionalProperties: false,
    },
  },
];

export type ToolName =
  | "check_availability"
  | "calculate_price"
  | "create_booking_draft"
  | "confirm_booking"
  | "send_confirmation_email"
  | "find_booking"
  | "request_cancellation"
  | "confirm_cancellation";

const room = z.enum(["A", "B"]);
const str = z.string();
const optStr = z.string().nullable().optional();
const optNum = z.number().nullable().optional();
const lookup = z.object({ reference: str, email: str });

const inputs = {
  check_availability: z.object({
    date: str,
    start_time: optStr,
    end_time: optStr,
    duration_hours: optNum,
    room: room.nullable().optional(),
  }),
  calculate_price: z.object({ duration_hours: optNum, start_time: optStr, end_time: optStr }),
  create_booking_draft: z.object({
    room,
    date: str,
    start_time: str,
    end_time: optStr,
    duration_hours: optNum,
    customer_name: str,
    customer_email: str,
    reschedule_reference: optStr,
  }),
  confirm_booking: z.object({ draft_id: str }),
  send_confirmation_email: z.object({ booking_id: str }),
  find_booking: lookup,
  request_cancellation: lookup,
  confirm_cancellation: z.object({ cancellation_id: str }),
} satisfies Record<ToolName, z.ZodType>;

// Tells the model how to describe each email outcome in customer terms.
const EMAIL_NOTES: Record<string, string> = {
  sent: "The email was sent.",
  already_sent: "This email had already been sent. Don't send it again.",
  dry_run:
    "This test server has email sending switched off, so nothing was delivered. Tell the customer the change is done and that emails aren't sent from this test server, in plain words.",
  failed: "The email could not be sent. The booking change itself still went through: give the customer the reference.",
};

export interface ToolContext {
  db: Db;
  conversationId: string;
  userTurn: number;
  now: DateTime;
}

export interface ToolOutcome {
  ok: boolean;
  /** Structured result, also sent to the UI to render cards. */
  data: Record<string, unknown>;
}

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(name in inputs)) {
    return { ok: false, data: { error_code: "UNKNOWN_TOOL", message: `There is no tool named ${name}.` } };
  }
  const parsed = inputs[name as ToolName].safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      data: { error_code: "INVALID_INPUT", message: z.prettifyError(parsed.error) },
    };
  }

  try {
    return { ok: true, data: await dispatch(name as ToolName, parsed.data, ctx) };
  } catch (err) {
    if (err instanceof BookingError) {
      return { ok: false, data: { error_code: err.code, message: err.message, ...err.details } };
    }
    throw err;
  }
}

async function dispatch(
  name: ToolName,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "check_availability": {
      const i = input as z.infer<typeof inputs.check_availability>;
      return checkAvailability(ctx.db, i, ctx.now);
    }

    case "calculate_price": {
      const i = input as z.infer<typeof inputs.calculate_price>;
      let minutes: number;
      if (i.start_time && i.end_time) {
        minutes = parseClock(i.end_time) - parseClock(i.start_time);
      } else if (i.duration_hours != null) {
        minutes = Math.round(i.duration_hours * 60);
      } else {
        throw new BookingError("MISSING_END", "Give a duration, or a start and end time.");
      }
      if (minutes <= 0) {
        throw new BookingError("END_BEFORE_START", "The end time must be after the start time.");
      }
      const quote = calculatePrice(minutes);
      const cheaper = cheaperLongerOption(minutes);
      return {
        duration_hours: quote.durationHours,
        subtotal: formatMoney(quote.subtotalCents),
        discount_applied: quote.discountApplied,
        discount: formatMoney(quote.discountCents),
        total: formatMoney(quote.totalCents),
        breakdown: quote.breakdown,
        cheaper_alternative: cheaper
          ? `${cheaper.durationHours} hours would cost ${formatMoney(cheaper.totalCents)}, less than ${formatMoney(quote.totalCents)}.`
          : null,
      };
    }

    case "create_booking_draft": {
      const i = input as z.infer<typeof inputs.create_booking_draft>;
      const draft = await createDraft(ctx.db, i, ctx);
      return {
        draft_id: draft.draftId,
        ...draft,
        cheaper_alternative: draft.cheaperAlternative,
        next_step: draft.replaces
          ? `Show this new time next to the booking it replaces (${draft.replaces.refCode}, ${draft.replaces.when}) and the price difference, and ask the customer to confirm the change. Do not call confirm_booking until they accept in a new message.`
          : "Show this quote and ask the customer to confirm. Do not call confirm_booking until they accept in a new message.",
      };
    }

    case "confirm_booking": {
      const i = input as z.infer<typeof inputs.confirm_booking>;
      const { booking, alreadyConfirmed, replaced } = await confirmDraft(ctx.db, i.draft_id, ctx);
      return {
        booking_id: booking.id,
        ...booking,
        already_confirmed: alreadyConfirmed,
        replaced: replaced ? { refCode: replaced.refCode, when: replaced.when, roomName: replaced.roomName } : null,
        next_step: replaced
          ? `The booking moved: ${replaced.refCode} is cancelled and ${booking.refCode} is the new reference. Call send_confirmation_email with this booking_id.`
          : "Call send_confirmation_email with this booking_id.",
      };
    }

    case "send_confirmation_email": {
      const i = input as z.infer<typeof inputs.send_confirmation_email>;
      if (!(await touchedByConversation(ctx.db, i.booking_id, ctx.conversationId))) {
        throw new BookingError(
          "BOOKING_NOT_FOUND",
          `There is no booking ${i.booking_id} from this conversation. Use the booking_id returned by confirm_booking.`,
        );
      }
      const result = await sendConfirmationEmail(ctx.db, i.booking_id);
      return { ...result, note: EMAIL_NOTES[result.status] };
    }

    case "find_booking": {
      const i = input as z.infer<typeof inputs.find_booking>;
      const booking = await findBooking(ctx.db, i.reference, i.email);
      return { booking_id: booking.id, ...booking };
    }

    case "request_cancellation": {
      const i = input as z.infer<typeof inputs.request_cancellation>;
      const { cancellationId, booking, expiresAt } = await requestCancellation(ctx.db, i.reference, i.email, ctx);
      return {
        cancellation_id: cancellationId,
        cancellationId,
        expiresAt,
        ...booking,
        next_step:
          "Tell the customer which booking will be cancelled and ask them to confirm. Do not call confirm_cancellation until they confirm in a new message.",
      };
    }

    case "confirm_cancellation": {
      const i = input as z.infer<typeof inputs.confirm_cancellation>;
      const { booking, alreadyCancelled } = await confirmCancellation(ctx.db, i.cancellation_id, ctx);
      const email = await sendBookingEmail(ctx.db, booking.id, "cancelled");
      return {
        ...booking,
        already_cancelled: alreadyCancelled,
        email: { status: email.status, to: email.to, subject: email.subject },
        note: EMAIL_NOTES[email.status],
      };
    }
  }
}
