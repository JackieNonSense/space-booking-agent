"use client";

import { AnimatePresence, motion } from "motion/react";
import { EASE, pressable } from "./motion";
import type { FocusSlot, Schedule } from "./types";

const toMinute = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const hourLabel = (minute: number) => {
  const h = minute / 60;
  return `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? "pm" : "am"}`;
};

export function WeekTimeline({
  schedule,
  week,
  onWeekChange,
  focus,
  highlightIds,
}: {
  schedule: Schedule | null;
  week: number;
  onWeekChange: (week: number) => void;
  focus: FocusSlot | null;
  highlightIds: Set<string>;
}) {
  if (!schedule) {
    return (
      <div className="h-96 animate-pulse rounded-2xl border border-line bg-surface" aria-label="Loading schedule" />
    );
  }

  const { openMinute: open, closeMinute: close } = schedule;
  const span = close - open;
  const pct = (m: number) => `${((Math.min(Math.max(m, open), close) - open) / span) * 100}%`;
  const width = (a: number, b: number) => `${((Math.min(b, close) - Math.max(a, open)) / span) * 100}%`;
  // schedule.now is ISO in studio time, so HH:MM sits at 11–16.
  const nowMinute = toMinute(schedule.now.slice(11, 16));
  const gridHours: number[] = [];
  for (let m = open; m <= close; m += 120) gridHours.push(m);

  const first = schedule.days[0];
  const last = schedule.days[schedule.days.length - 1];

  return (
    <section
      className="rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(43,38,34,0.04)]"
      aria-labelledby="week-heading"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="week-heading" className="font-serif text-lg font-semibold text-ink">
            Room schedule
          </h2>
          <p className="text-xs text-muted">
            {first.label} – {last.label} · Sydney time
          </p>
        </div>
        <div className="flex gap-1">
          {[
            { label: "Previous week", to: week - 1, disabled: week === 0, glyph: "‹" },
            { label: "Next week", to: week + 1, disabled: week >= 25, glyph: "›" },
          ].map((b) => (
            <motion.button
              key={b.label}
              type="button"
              {...pressable}
              onClick={() => onWeekChange(b.to)}
              disabled={b.disabled}
              aria-label={b.label}
              className="grid h-7 w-7 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-accent-soft hover:text-ink disabled:opacity-35"
            >
              {b.glyph}
            </motion.button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[3.75rem_1fr] gap-x-2">
        <div />
        <div className="relative mb-1.5 h-4 text-[10px] text-faint">
          {gridHours.map((m, i) => (
            <span
              key={m}
              className={`absolute ${i === 0 ? "" : i === gridHours.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: pct(m) }}
            >
              {hourLabel(m)}
            </span>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={first.date}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="relative grid grid-cols-[3.75rem_1fr] gap-x-2"
        >
          {schedule.days.map((day, dayIndex) => {
            const isToday = day.date === schedule.today;
            const isFocus = focus?.date === day.date;
            return (
              <div key={day.date} className="relative col-span-2 grid grid-cols-subgrid py-1">
                {isFocus && (
                  <motion.div
                    layoutId="focus-row"
                    className="absolute inset-0 -mx-1.5 rounded-xl bg-accent-soft"
                    transition={{ duration: 0.4, ease: EASE }}
                  />
                )}
                <div className="relative flex flex-col justify-center">
                  <span className={`text-xs font-semibold ${isToday ? "text-accent" : "text-ink"}`}>
                    {isToday ? "Today" : day.weekday}
                  </span>
                  <span className="text-[11px] text-muted">{day.label}</span>
                </div>
                <div className="relative space-y-1">
                  {(["A", "B"] as const).map((room) => {
                    const blocks = schedule.bookings.filter((b) => b.date === day.date && b.room === room);
                    // Once the requested slot is booked, the booking itself marks it.
                    const alreadyBooked = blocks.some(
                      (b) => highlightIds.has(b.id) && b.start === focus?.start && b.end === focus?.end,
                    );
                    const showFocus =
                      isFocus && focus?.start && focus?.end && (!focus.room || focus.room === room) && !alreadyBooked;
                    const conflict =
                      showFocus &&
                      blocks.some(
                        (b) =>
                          !highlightIds.has(b.id) &&
                          toMinute(b.start) < toMinute(focus.end!) &&
                          toMinute(focus.start!) < toMinute(b.end),
                      );
                    return (
                      <div
                        key={room}
                        className="relative h-[18px] overflow-hidden rounded-md bg-paper"
                        title={`Room ${room}`}
                      >
                        {/* Hour grid */}
                        {gridHours.slice(1, -1).map((m) => (
                          <span key={m} className="absolute inset-y-0 w-px bg-line/70" style={{ left: pct(m) }} aria-hidden />
                        ))}
                        <span className="absolute left-1.5 top-0 z-10 text-[9px] font-semibold leading-[18px] text-faint">
                          {room}
                        </span>
                        {isToday && nowMinute > open && (
                          <div
                            className="absolute inset-y-0 left-0 bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(43,38,34,0.06)_3px_5px)]"
                            style={{ width: width(open, nowMinute) }}
                            aria-hidden
                          />
                        )}
                        {blocks.map((b, i) => {
                          const mine = highlightIds.has(b.id);
                          return (
                            <motion.div
                              key={b.id}
                              className={`absolute inset-y-0.5 origin-left rounded ${mine ? "bg-accent shadow-[0_0_0_2px_rgba(138,109,75,0.25)]" : "bg-busy"}`}
                              style={{ left: pct(toMinute(b.start)), width: width(toMinute(b.start), toMinute(b.end)) }}
                              initial={{ scaleX: 0, opacity: 0 }}
                              animate={{ scaleX: 1, opacity: 1 }}
                              transition={{ duration: 0.45, delay: mine ? 0.1 : dayIndex * 0.03 + i * 0.02, ease: EASE }}
                              title={`Room ${room}: ${b.start}–${b.end}${mine ? " (booked in this chat)" : ""}`}
                            />
                          );
                        })}
                        <AnimatePresence>
                          {showFocus && (
                            <motion.div
                              key={`${focus.start}-${focus.end}`}
                              className={`absolute inset-y-0 rounded border-2 border-dashed ${
                                conflict ? "border-danger bg-danger/10" : "border-accent-strong bg-accent/5"
                              }`}
                              style={{ left: pct(toMinute(focus.start!)), width: width(toMinute(focus.start!), toMinute(focus.end!)) }}
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.3, ease: EASE }}
                              aria-hidden
                            />
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                  {isToday && nowMinute > open && nowMinute < close && (
                    <span
                      className="absolute -bottom-0.5 -top-0.5 z-20 w-0.5 rounded-full bg-accent"
                      style={{ left: pct(nowMinute) }}
                      title="Now"
                      aria-hidden
                    />
                  )}
                </div>
              </div>
            );
          })}
        </motion.div>
      </AnimatePresence>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <Legend className="bg-busy">Booked</Legend>
        <Legend className="bg-accent">Booked in this chat</Legend>
        <Legend className="border-2 border-dashed border-accent-strong">Requested</Legend>
        <Legend className="border-2 border-dashed border-danger bg-danger/10">Clash</Legend>
      </div>
    </section>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-4 rounded-sm ${className}`} aria-hidden />
      {children}
    </span>
  );
}
