"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { EASE, pressable } from "./motion";
import type { PickerRequest } from "./SlotPicker";
import type { FocusSlot, Schedule as ScheduleData, ScheduleBlock } from "./types";

const HOUR_PX = 24;
const ROOMS = ["A", "B"] as const;

const toMinute = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** 14:00 → "2pm", 14:30 → "2:30pm" */
const compact = (minute: number) => {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 && h < 24 ? "pm" : "am"}`;
};

/** 840 → "14:00" */
const clockOf = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const range = (start: string, end: string) => `${compact(toMinute(start))}–${compact(toMinute(end))}`;

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

export function Schedule({
  schedule,
  week,
  onWeekChange,
  focus,
  highlightIds,
  onPick,
}: {
  schedule: ScheduleData | null;
  week: number;
  onWeekChange: (week: number) => void;
  focus: FocusSlot | null;
  highlightIds: Set<string>;
  /** Opens the slot picker; called from a click on free time or the day's "Pick a time" button. */
  onPick?: (request: PickerRequest) => void;
}) {
  // The day follows the conversation; a click picks another day until the
  // conversation moves on to a new slot.
  const focusKey = focus ? `${focus.date}|${focus.start}|${focus.end}|${focus.room}` : "";
  const [picked, setPicked] = useState<{ date: string; focusKey: string } | null>(null);

  if (!schedule) {
    return <div className="h-[30rem] animate-pulse rounded-2xl border border-line bg-surface" aria-label="Loading schedule" />;
  }

  const { openMinute: open, closeMinute: close, days } = schedule;
  const preferred = picked && picked.focusKey === focusKey ? picked.date : (focus?.date ?? schedule.today);
  const selected = days.some((d) => d.date === preferred) ? preferred : days[0].date;
  const blocksOn = (date: string, room: "A" | "B") =>
    schedule.bookings.filter((b) => b.date === date && b.room === room);
  const pct = (m: number) => ((Math.min(Math.max(m, open), close) - open) / (close - open)) * 100;

  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card" aria-labelledby="schedule-heading">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div>
          <h2 id="schedule-heading" className="font-serif text-xl font-semibold text-fg">
            Room schedule
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-3">AEDT · open 8am–10pm</p>
        </div>
        <div className="flex gap-1">
          {[
            { label: "Previous week", to: week - 1, disabled: week === 0, Icon: ChevronLeftIcon },
            { label: "Next week", to: week + 1, disabled: week >= 25, Icon: ChevronRightIcon },
          ].map(({ label, to, disabled, Icon }) => (
            <motion.button
              key={label}
              type="button"
              {...pressable}
              onClick={() => onWeekChange(to)}
              disabled={disabled}
              aria-label={label}
              className="grid h-8 w-8 place-items-center rounded-lg border border-line text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-35"
            >
              <Icon className="h-4 w-4" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* Week strip */}
      <div className="mt-3 grid grid-cols-7 gap-1 px-3" role="group" aria-label="Choose a day">
        {days.map((day) => {
          const isSelected = day.date === selected;
          const isToday = day.date === schedule.today;
          return (
            <button
              key={day.date}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${longDate(day.date)}${isToday ? ", today" : ""}: ${ROOMS.map((r) => {
                const n = blocksOn(day.date, r).length;
                return `Room ${r} ${n === 0 ? "free all day" : `${n} booking${n === 1 ? "" : "s"}`}`;
              }).join(", ")}`}
              onClick={() => setPicked({ date: day.date, focusKey })}
              className={`relative rounded-xl px-1 pb-2 pt-1.5 text-center transition-colors ${
                isSelected ? "text-on-ink" : "text-fg hover:bg-hover"
              }`}
            >
              {isSelected && (
                <motion.span
                  layoutId="day-pill"
                  className="absolute inset-0 rounded-xl bg-ink"
                  transition={{ duration: 0.3, ease: EASE }}
                />
              )}
              <span className="relative block text-xs font-medium">
                <span className={isSelected ? "text-on-ink/75" : isToday ? "text-brand" : "text-fg-3"}>
                  {isToday ? "Today" : day.weekday}
                </span>
              </span>
              <span className="num relative block text-base font-semibold leading-6">{Number(day.date.slice(8))}</span>
              <span className="relative mt-1 block space-y-[3px] px-1" aria-hidden>
                {ROOMS.map((room) => (
                  <span
                    key={room}
                    className={`relative block h-[3px] overflow-hidden rounded-full ${isSelected ? "bg-on-ink/25" : "bg-hover"}`}
                  >
                    {blocksOn(day.date, room).map((b) => (
                      <span
                        key={b.id}
                        className={`absolute inset-y-0 ${
                          highlightIds.has(b.id) ? "bg-brand" : isSelected ? "bg-on-ink" : "bg-booked"
                        }`}
                        style={{
                          left: `${pct(toMinute(b.start))}%`,
                          width: `${pct(toMinute(b.end)) - pct(toMinute(b.start))}%`,
                        }}
                      />
                    ))}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <DayView
        date={selected}
        isToday={selected === schedule.today}
        nowIso={schedule.now}
        open={open}
        close={close}
        blocksOn={blocksOn}
        focus={focus?.date === selected ? focus : null}
        highlightIds={highlightIds}
        // Days past the booking window are shown but can't be picked.
        onPick={selected <= schedule.lastBookableDate ? onPick : undefined}
        notOpen={selected > schedule.lastBookableDate}
      />

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-xs text-fg-2">
        <Legend swatch="bg-surface border border-line-strong">Free</Legend>
        <Legend swatch="bg-booked">Booked</Legend>
        <Legend swatch="bg-brand">Your booking</Legend>
        <Legend swatch="border-2 border-dashed border-brand bg-brand-soft">Requested</Legend>
        <Legend swatch="border-2 border-dashed border-danger bg-danger-soft">Clash</Legend>
      </div>
    </section>
  );
}

function DayView({
  date,
  isToday,
  nowIso,
  open,
  close,
  blocksOn,
  focus,
  highlightIds,
  onPick,
  notOpen = false,
}: {
  date: string;
  isToday: boolean;
  nowIso: string;
  open: number;
  close: number;
  blocksOn: (date: string, room: "A" | "B") => ScheduleBlock[];
  focus: FocusSlot | null;
  highlightIds: Set<string>;
  onPick?: (request: PickerRequest) => void;
  notOpen?: boolean;
}) {
  const [hover, setHover] = useState<{ room: "A" | "B"; minute: number } | null>(null);
  const height = ((close - open) / 60) * HOUR_PX;
  const y = (minute: number) => ((Math.min(Math.max(minute, open), close) - open) / 60) * HOUR_PX;
  // nowIso is ISO in studio time, so HH:MM sits at 11–16.
  const nowMinute = toMinute(nowIso.slice(11, 16));
  const hours: number[] = [];
  for (let m = open; m <= close; m += 60) hours.push(m);
  const earliest = isToday ? Math.ceil((nowMinute + 1) / 30) * 30 : open;

  /** Half-hour slot under the pointer, in minutes after midnight. */
  const minuteAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const top = e.currentTarget.getBoundingClientRect().top;
    return Math.floor((open + ((e.clientY - top) / HOUR_PX) * 60) / 30) * 30;
  };
  const canStart = (room: "A" | "B", m: number) =>
    m >= Math.max(open, earliest) &&
    m + 60 <= close &&
    !blocksOn(date, room).some((b) => m < toMinute(b.end) && toMinute(b.start) < m + 60);

  return (
    <div className="px-4 pb-4 pt-3">
      <div className="flex items-center justify-between gap-3">
        {/* Not animated: a popped-out exiting heading flashed over the grid below. */}
        <h3 className="text-sm font-semibold text-fg">{longDate(date)}</h3>
        {onPick && (
          <motion.button
            type="button"
            {...pressable}
            onClick={() => onPick({ date })}
            className="rounded-lg border border-line-strong px-2.5 py-1 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
          >
            Pick a time
          </motion.button>
        )}
        {notOpen && <span className="text-[13px] text-fg-3">Not open for booking yet</span>}
      </div>

      <div className="mt-2 grid grid-cols-[2.75rem_1fr_1fr] gap-x-1.5 text-[13px] font-medium text-fg-2">
        <span />
        <span className="px-1">Room A</span>
        <span className="px-1">Room B</span>
      </div>

      <div className="relative mt-1.5" style={{ height }}>
        {/* Hour grid and labels */}
        {hours.map((m) => (
          <div key={m} className="absolute inset-x-0" style={{ top: y(m) }} aria-hidden>
            <span className="num absolute left-0 w-10 -translate-y-1/2 pr-1.5 text-right text-xs text-fg-3">
              {compact(m)}
            </span>
            <span className="absolute left-[2.75rem] right-0 border-t border-line" />
          </div>
        ))}

        {/* Both days are absolutely positioned, so they cross-fade in place with no empty frame. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={date}
            className="absolute bottom-0 left-[3.125rem] right-0 top-0 grid grid-cols-2 gap-x-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {ROOMS.map((room) => {
              const blocks = blocksOn(date, room);
              const showFocus = focus?.start && focus?.end && (!focus.room || focus.room === room);
              const alreadyBooked = blocks.some(
                (b) => highlightIds.has(b.id) && b.start === focus?.start && b.end === focus?.end,
              );
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
                  className={`relative rounded-md ${onPick ? "cursor-pointer" : ""}`}
                  role="group"
                  aria-label={`Room ${room}`}
                  onMouseMove={(e) => {
                    const m = minuteAt(e);
                    setHover(onPick && canStart(room, m) ? { room, minute: m } : null);
                  }}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => {
                    const m = minuteAt(e);
                    if (onPick && canStart(room, m)) onPick({ date, room, start: clockOf(m) });
                  }}
                >
                  {hover?.room === room && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 flex items-center rounded-md border border-dashed border-fg-3 bg-hover/90 px-2 text-xs font-semibold text-fg"
                      style={{ top: y(hover.minute), height: HOUR_PX }}
                      aria-hidden
                    >
                      + {compact(hover.minute)}
                    </div>
                  )}
                  {isToday && nowMinute > open && (
                    <div className="hatch absolute inset-x-0 top-0 rounded-t-md" style={{ height: y(nowMinute) }} aria-hidden />
                  )}
                  {blocks.map((b, i) => {
                    const mine = highlightIds.has(b.id);
                    const h = y(toMinute(b.end)) - y(toMinute(b.start));
                    return (
                      <motion.div
                        key={b.id}
                        className={`absolute inset-x-0 overflow-hidden rounded-md px-2 ${
                          mine ? "bg-brand text-on-ink" : "bg-booked text-on-booked"
                        } ${h >= 40 ? "py-1.5" : "flex items-center"}`}
                        style={{ top: y(toMinute(b.start)) + 1, height: h - 2 }}
                        initial={{ opacity: 0, scaleY: 0.8 }}
                        animate={{ opacity: 1, scaleY: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.04, ease: EASE }}
                        title={`Room ${room}: ${range(b.start, b.end)}${mine ? " (your booking)" : " (booked)"}`}
                      >
                        <div className="truncate text-xs font-semibold leading-4">
                          {mine ? "Your booking" : "Booked"}
                          {h < 40 && <span className="num font-normal opacity-85"> · {range(b.start, b.end)}</span>}
                        </div>
                        {h >= 40 && <div className="num truncate text-xs leading-4 opacity-85">{range(b.start, b.end)}</div>}
                      </motion.div>
                    );
                  })}
                  <AnimatePresence>
                    {showFocus && !alreadyBooked && (
                      <motion.div
                        key={`${focus.start}-${focus.end}`}
                        className={`absolute inset-x-0 z-10 rounded-md border-2 border-dashed px-2 py-1 ${
                          conflict ? "border-danger bg-danger-soft/85 text-danger" : "border-brand bg-brand-soft/90 text-brand-strong"
                        }`}
                        style={{ top: y(toMinute(focus.start!)), height: y(toMinute(focus.end!)) - y(toMinute(focus.start!)) }}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease: EASE }}
                      >
                        <div className="truncate text-xs font-semibold leading-4">{conflict ? "Clash" : "Requested"}</div>
                        <div className="num truncate text-xs leading-4">{range(focus.start!, focus.end!)}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>

        {/* Now line */}
        {isToday && nowMinute > open && nowMinute < close && (
          <div className="pointer-events-none absolute left-[2.75rem] right-0 z-20" style={{ top: y(nowMinute) }} aria-hidden>
            <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-danger" />
            <span className="absolute inset-x-0 top-0 h-0.5 bg-danger" />
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, children }: { swatch: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded-[3px] ${swatch}`} aria-hidden />
      {children}
    </span>
  );
}
