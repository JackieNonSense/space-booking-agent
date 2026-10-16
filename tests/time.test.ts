import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { TIMEZONE } from "@/lib/config";
import { BookingError } from "@/lib/errors";
import { clockLabel, parseClock, resolveSlot, slotLabel, upcomingDays } from "@/lib/time";

// Saturday 10 Oct 2026, 09:15 in Sydney.
const NOW = DateTime.fromISO("2026-10-10T09:15", { zone: TIMEZONE });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof BookingError) return err.code;
    throw err;
  }
  return undefined;
}

describe("parseClock", () => {
  it.each([
    ["14:00", 840],
    ["09:30", 570],
    ["9:30", 570],
    ["2pm", 840],
    ["2:30 pm", 870],
    ["12am", 0],
    ["12pm", 720],
    ["10 AM", 600],
  ])("%s → %i", (input, minutes) => {
    expect(parseClock(input)).toBe(minutes);
  });

  it.each(["25:00", "13pm", "noonish", "14:75", ""])("rejects %s", (input) => {
    expect(codeOf(() => parseClock(input))).toBe("INVALID_TIME");
  });
});

describe("resolveSlot", () => {
  it("computes duration from start and end", () => {
    const slot = resolveSlot({ date: "2026-10-16", start_time: "14:00", end_time: "18:00" }, NOW);
    expect(slot.durationMinutes).toBe(240);
    expect(slot.start.toISO()).toBe("2026-10-16T14:00:00.000+11:00");
  });

  it("computes end from start and duration", () => {
    const slot = resolveSlot({ date: "2026-10-16", start_time: "14:00", duration_hours: 5 }, NOW);
    expect(slot.endMinute).toBe(19 * 60);
  });

  it("handles half hours", () => {
    const slot = resolveSlot({ date: "2026-10-16", start_time: "14:30", end_time: "18:00" }, NOW);
    expect(slot.durationMinutes).toBe(210);
  });

  it("accepts end and duration when they agree", () => {
    const slot = resolveSlot(
      { date: "2026-10-16", start_time: "10:00", end_time: "14:00", duration_hours: 4 },
      NOW,
    );
    expect(slot.durationMinutes).toBe(240);
  });

  it.each([
    [{ date: "2026-10-16", start_time: "10:00", end_time: "14:00", duration_hours: 3 }, "CONFLICTING_END"],
    [{ date: "2026-10-16", start_time: "14:00" }, "MISSING_END"],
    [{ date: "2026-10-16", start_time: "14:00", end_time: "14:00" }, "END_BEFORE_START"],
    [{ date: "2026-10-16", start_time: "21:00", end_time: "02:00" }, "CROSSES_MIDNIGHT"],
    [{ date: "2026-10-16", start_time: "20:00", duration_hours: 6 }, "CROSSES_MIDNIGHT"],
    [{ date: "2026-10-16", start_time: "14:15", end_time: "16:00" }, "NOT_ON_GRID"],
    [{ date: "2026-10-16", start_time: "07:00", end_time: "10:00" }, "OUTSIDE_HOURS"],
    [{ date: "2026-10-16", start_time: "20:00", end_time: "23:00" }, "OUTSIDE_HOURS"],
    [{ date: "2026-10-16", start_time: "14:00", end_time: "14:30" }, "TOO_SHORT"],
    [{ date: "2026-10-10", start_time: "09:00", end_time: "11:00" }, "IN_PAST"],
    [{ date: "2027-10-10", start_time: "09:00", end_time: "11:00" }, "TOO_FAR_AHEAD"],
    [{ date: "16/10/2026", start_time: "09:00", end_time: "11:00" }, "INVALID_DATE"],
    [{ date: "2026-02-30", start_time: "09:00", end_time: "11:00" }, "INVALID_DATE"],
    [{ date: "2026-10-16", start_time: "09:00", duration_hours: -2 }, "INVALID_DURATION"],
  ])("rejects %j with %s", (input, code) => {
    expect(codeOf(() => resolveSlot(input, NOW))).toBe(code);
  });

  it.each([
    // Daylight saving ends 4 Apr 2027 (03:00 AEDT -> 02:00 AEST) and starts 4 Oct 2026.
    ["2027-04-04", "2027-04-04T14:00:00.000+10:00", "2027-04-04T18:00:00.000+10:00"],
    ["2027-04-03", "2027-04-03T14:00:00.000+11:00", "2027-04-03T18:00:00.000+11:00"],
  ])("keeps wall-clock times on %s around a daylight saving change", (date, start, end) => {
    const slot = resolveSlot({ date, start_time: "14:00", end_time: "18:00" }, NOW);
    expect(slot.start.toISO()).toBe(start);
    expect(slot.end.toISO()).toBe(end);
    expect(slot.durationMinutes).toBe(240);
  });

  it("keeps wall-clock times on the day daylight saving starts", () => {
    const before = DateTime.fromISO("2026-09-30T09:00", { zone: TIMEZONE });
    const slot = resolveSlot({ date: "2026-10-04", start_time: "09:00", end_time: "13:00" }, before);
    expect(slot.start.toISO()).toBe("2026-10-04T09:00:00.000+11:00");
    expect(slot.end.diff(slot.start, "minutes").minutes).toBe(240);
  });

  it("allows a booking later today", () => {
    const slot = resolveSlot({ date: "2026-10-10", start_time: "10:00", end_time: "12:00" }, NOW);
    expect(slot.date).toBe("2026-10-10");
  });
});

describe("labels", () => {
  it("formats customer-facing slot text", () => {
    expect(slotLabel({ date: "2026-10-16", startMinute: 840, endMinute: 1080 })).toBe(
      "Friday 16 October 2026, 2:00 pm – 6:00 pm",
    );
    expect(clockLabel(12 * 60)).toBe("12:00 pm");
    expect(clockLabel(9 * 60 + 30)).toBe("9:30 am");
  });

  it("lists upcoming days with weekdays", () => {
    const days = upcomingDays(NOW, 3);
    expect(days).toContain("Saturday 2026-10-10 (today)");
    expect(days).toContain("Sunday 2026-10-11 (tomorrow)");
    expect(days).toContain("Monday 2026-10-12");
  });
});
