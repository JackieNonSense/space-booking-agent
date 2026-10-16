"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { calculatePrice, formatMoney } from "@/lib/pricing";
import { DoorIcon } from "./icons";
import { fadeUp, pressable, stagger } from "./motion";
import type { PickerRequest } from "./SlotPicker";
import type { Schedule } from "./types";

// The two rooms as a customer first meets them: when each is free on a day of
// this week, with start times one tap away. Built from the live schedule, so
// it shows real availability rather than a description of the rooms.

type Room = "A" | "B";
const ROOMS: Room[] = ["A", "B"];
const STEP = 30;
const MIN_LENGTH = 60;

const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const clockOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const label = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
};

/** Free stretches of at least an hour in one room on one day, from `from` onwards. */
export function freeWindows(
  booked: Array<{ start: string; end: string }>,
  from: number,
  close: number,
): Array<{ start: number; end: number }> {
  const busy = booked.map((b) => ({ start: toMinute(b.start), end: toMinute(b.end) })).sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  let cursor = from;
  for (const b of busy) {
    if (b.start > cursor) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (close > cursor) out.push({ start: cursor, end: close });
  return out.filter((w) => w.end - w.start >= MIN_LENGTH);
}

/** Up to `limit` start times spread across the free windows: each window's start, then every 2 hours. */
function suggestedStarts(windows: Array<{ start: number; end: number }>, limit = 4): number[] {
  const out: number[] = [];
  for (const w of windows) {
    for (let s = w.start; s + MIN_LENGTH <= w.end && out.length < limit; s += 120) out.push(s);
  }
  return out;
}

export function RoomsAtAGlance({ schedule, onPick }: { schedule: Schedule; onPick: (request: PickerRequest) => void }) {
  const { openMinute: open, closeMinute: close, days, today } = schedule;
  const nowMinute = toMinute(schedule.now.slice(11, 16));
  const earliest = (date: string) =>
    date === today ? Math.max(open, Math.ceil((nowMinute + 1) / STEP) * STEP) : open;
  const windowsFor = (date: string, room: Room) =>
    freeWindows(
      schedule.bookings.filter((b) => b.date === date && b.room === room),
      earliest(date),
      close,
    );

  // Today unless it's effectively over, in which case tomorrow.
  const firstOpen = days.find((d) => ROOMS.some((r) => windowsFor(d.date, r).length > 0))?.date ?? days[0]?.date;
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? firstOpen;
  if (!date) return null;
  const dayLabel = (d: string) => (d === today ? "Today" : days.find((x) => x.date === d)?.weekday ?? "");
  const longDay = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const fourHours = formatMoney(calculatePrice(240).totalCents);

  return (
    <section aria-labelledby="rooms-heading" className="mt-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="rooms-heading" className="text-[13px] font-semibold text-fg">
          When the rooms are free
        </h3>
        <span className="text-xs text-fg-3">Times are AEDT · open 8am–10pm</span>
      </div>

      <div
        role="group"
        aria-label="Day"
        className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map((d) => {
          const selected = d.date === date;
          return (
            <button
              key={d.date}
              type="button"
              aria-pressed={selected}
              onClick={() => setPicked(d.date)}
              className={`flex min-w-14 shrink-0 flex-col items-center rounded-xl border px-2 py-1.5 transition-colors ${
                selected ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-fg hover:bg-hover"
              }`}
            >
              <span className={`text-xs ${selected ? "text-on-ink/75" : d.date === today ? "text-brand" : "text-fg-3"}`}>
                {dayLabel(d.date)}
              </span>
              <span className="num text-base font-semibold">{Number(d.date.slice(8))}</span>
            </button>
          );
        })}
      </div>

      <motion.div
        key={date}
        variants={stagger(0.05)}
        initial="hidden"
        animate="show"
        className="mt-3 grid gap-3 sm:grid-cols-2"
      >
        {ROOMS.map((room) => {
          const windows = windowsFor(date, room);
          const starts = suggestedStarts(windows);
          return (
            <motion.div
              key={room}
              variants={fadeUp}
              className="rounded-2xl border border-line bg-surface p-4 shadow-card"
              role="group"
              aria-label={`Room ${room}, ${longDay}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                  <DoorIcon className="h-4 w-4 text-fg-3" />
                  Room {room}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    windows.length ? "bg-ok-soft text-ok" : "bg-hover text-fg-2"
                  }`}
                >
                  {windows.length ? "Available" : "Fully booked"}
                </span>
              </div>
              <p className="num mt-2 text-[13px] leading-5 text-fg-2">
                {windows.length
                  ? `Free ${windows.map((w) => `${label(w.start)}–${label(w.end)}`).join(", ")}`
                  : `No free hour left on ${longDay}. Try another day.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {starts.map((s) => (
                  <motion.button
                    key={s}
                    type="button"
                    {...pressable}
                    onClick={() => onPick({ date, room, start: clockOf(s) })}
                    aria-label={`Start Room ${room} at ${label(s)} on ${longDay}`}
                    className="num rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
                  >
                    {label(s)}
                  </motion.button>
                ))}
                <motion.button
                  type="button"
                  {...pressable}
                  onClick={() => onPick({ date, room })}
                  className="rounded-lg px-2 py-1 text-[13px] font-medium text-brand underline-offset-2 hover:underline"
                >
                  {starts.length ? "Other times" : "Pick another day"}
                </motion.button>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      <p className="num mt-3 text-[13px] text-fg-2">
        <span className="font-semibold text-fg">$100 per hour</span> · bookings of 4 hours or more get{" "}
        <span className="font-semibold text-ok">15% off</span> (4 hours = {fourHours})
      </p>
    </section>
  );
}
