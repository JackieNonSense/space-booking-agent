import { DateTime } from "luxon";
import {
  CLOSE_MINUTE,
  MAX_ADVANCE_DAYS,
  MIN_BOOKING_MINUTES,
  OPEN_MINUTE,
  SLOT_MINUTES,
  TIMEZONE,
} from "./config";
import { BookingError } from "./errors";

export interface Slot {
  /** ISO date in studio time, e.g. "2026-10-16". */
  date: string;
  startMinute: number;
  endMinute: number;
  start: DateTime;
  end: DateTime;
  durationMinutes: number;
}

export interface SlotInput {
  date: string;
  start_time: string;
  end_time?: string | null;
  duration_hours?: number | null;
}

export function studioNow(): DateTime {
  return DateTime.now().setZone(TIMEZONE);
}

export function parseDate(date: string): DateTime {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? DateTime.fromISO(date, { zone: TIMEZONE })
    : null;
  if (!parsed?.isValid) {
    throw new BookingError("INVALID_DATE", `"${date}" is not a valid date. Use YYYY-MM-DD.`);
  }
  return parsed.startOf("day");
}

/**
 * Parses "14:00", "9:30", "2pm" or "2:30 pm" into minutes after midnight.
 * The model is asked for 24-hour HH:MM, but accepting the common spoken forms
 * costs nothing and removes a failure mode.
 */
export function parseClock(time: string): number {
  const match = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(time);
  if (!match) {
    throw new BookingError("INVALID_TIME", `"${time}" is not a valid time. Use 24-hour HH:MM.`);
  }
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) {
      throw new BookingError("INVALID_TIME", `"${time}" is not a valid time.`);
    }
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) {
    throw new BookingError("INVALID_TIME", `"${time}" is not a valid time.`);
  }
  return hour * 60 + minute;
}

export function clock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "2:00 pm" style label for customer-facing text. */
export function clockLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const suffix = h >= 12 && h < 24 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function dateLabel(date: string): string {
  return parseDate(date).toFormat("cccc d LLLL yyyy");
}

export function atMinute(date: string, minute: number): DateTime {
  return parseDate(date).plus({ minutes: minute });
}

/**
 * Turns what the customer asked for into a validated slot. Duration is always
 * computed here from the clock times, never taken from the model's arithmetic.
 */
export function resolveSlot(input: SlotInput, now: DateTime = studioNow()): Slot {
  const day = parseDate(input.date);
  const startMinute = parseClock(input.start_time);

  let endMinute: number;
  const hasEnd = input.end_time != null && input.end_time !== "";
  const hasDuration = input.duration_hours != null;
  if (hasDuration && (!Number.isFinite(input.duration_hours) || input.duration_hours! <= 0)) {
    throw new BookingError("INVALID_DURATION", `Duration must be a positive number of hours.`);
  }
  if (hasEnd) {
    endMinute = parseClock(input.end_time!);
    if (endMinute <= startMinute) {
      // "10pm to 2am" style requests land here.
      throw new BookingError(
        endMinute === startMinute ? "END_BEFORE_START" : "CROSSES_MIDNIGHT",
        endMinute === startMinute
          ? "The end time must be after the start time."
          : "Bookings must start and finish on the same day.",
      );
    }
    if (hasDuration) {
      const implied = Math.round(input.duration_hours! * 60);
      if (implied !== endMinute - startMinute) {
        throw new BookingError(
          "CONFLICTING_END",
          `${clock(startMinute)}–${clock(endMinute)} is ${(endMinute - startMinute) / 60} hours, not ${input.duration_hours}. Confirm which one the customer wants.`,
        );
      }
    }
  } else if (hasDuration) {
    endMinute = startMinute + Math.round(input.duration_hours! * 60);
  } else {
    throw new BookingError("MISSING_END", "Ask the customer for an end time or a duration.");
  }

  if (endMinute > 24 * 60) {
    throw new BookingError("CROSSES_MIDNIGHT", "Bookings must start and finish on the same day.");
  }
  if (startMinute % SLOT_MINUTES !== 0 || endMinute % SLOT_MINUTES !== 0) {
    throw new BookingError(
      "NOT_ON_GRID",
      `Bookings start and end on the hour or half hour (e.g. 14:00 or 14:30).`,
    );
  }
  if (startMinute < OPEN_MINUTE || endMinute > CLOSE_MINUTE) {
    throw new BookingError(
      "OUTSIDE_HOURS",
      `The studio is open ${clockLabel(OPEN_MINUTE)} to ${clockLabel(CLOSE_MINUTE)}.`,
      { open: clock(OPEN_MINUTE), close: clock(CLOSE_MINUTE) },
    );
  }
  const durationMinutes = endMinute - startMinute;
  if (durationMinutes < MIN_BOOKING_MINUTES) {
    throw new BookingError("TOO_SHORT", `The minimum booking is ${MIN_BOOKING_MINUTES / 60} hour.`);
  }

  const start = day.plus({ minutes: startMinute });
  const end = day.plus({ minutes: endMinute });
  if (start <= now) {
    throw new BookingError("IN_PAST", "That time has already passed. Pick a future time.", {
      now: now.toISO(),
    });
  }
  if (start > now.plus({ days: MAX_ADVANCE_DAYS })) {
    throw new BookingError(
      "TOO_FAR_AHEAD",
      `Bookings open up to ${MAX_ADVANCE_DAYS} days in advance.`,
    );
  }

  return { date: day.toISODate()!, startMinute, endMinute, start, end, durationMinutes };
}

export function slotLabel(slot: Pick<Slot, "date" | "startMinute" | "endMinute">): string {
  return `${dateLabel(slot.date)}, ${clockLabel(slot.startMinute)} – ${clockLabel(slot.endMinute)}`;
}

/** Date reference for the system prompt so the model never guesses weekdays. */
export function upcomingDays(now: DateTime, count = 14): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = now.startOf("day").plus({ days: i });
    const tag = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : "";
    lines.push(`- ${d.toFormat("cccc")} ${d.toISODate()}${tag}`);
  }
  return lines.join("\n");
}
