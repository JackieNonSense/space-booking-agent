"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { calculatePrice, cheaperLongerOption, formatMoney } from "@/lib/pricing";
import { XIcon } from "./icons";
import { EASE, pressable } from "./motion";

// Pick a room, a start and a length by tapping, with the price on every
// option. Submitting sends a plain sentence to the agent, which still checks
// availability and quotes through its tools.

type Room = "A" | "B";

export interface PickerRequest {
  date: string;
  room?: Room;
  /** "HH:MM" */
  start?: string;
}

interface DayData {
  date: string;
  label: string;
  openMinute: number;
  closeMinute: number;
  nowMinute: number | null;
  rooms: Record<Room, Array<{ start: string; end: string }>>;
}

const DURATIONS = [60, 90, 120, 180, 210, 240, 300, 360, 480];
const STEP = 30;

const toMinute = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const label = (m: number) => {
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
};
const hours = (m: number) => `${m / 60} ${m === 60 ? "hour" : "hours"}`;
const shortHours = (m: number) => `${m / 60} h`;

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { ...opts, timeZone: "UTC" });

export function SlotPicker({
  request,
  today,
  disabled = false,
  onClose,
  onSubmit,
}: {
  request: PickerRequest;
  today: string;
  /** True while the assistant is still answering; picking is fine, sending waits. */
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState(request.date < today ? today : request.date);
  const [room, setRoom] = useState<Room>(request.room ?? "A");
  const [start, setStart] = useState<number | null>(request.start ? toMinute(request.start) : null);
  const [duration, setDuration] = useState<number | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/day?date=${date}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setDay(body as DayData);
          setError(null);
        } else setError(body.error ?? "Couldn't load that day.");
      })
      .catch(() => !cancelled && setError("Couldn't load that day."));
    return () => {
      cancelled = true;
    };
  }, [date]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i)), [today]);
  const loaded = day?.date === date ? day : null;

  // Everything below is derived, so switching day or room never leaves a stale choice selected.
  const open = loaded?.openMinute ?? 480;
  const close = loaded?.closeMinute ?? 1320;
  const earliest = loaded?.nowMinute != null ? Math.ceil((loaded.nowMinute + 1) / STEP) * STEP : open;
  const busyFor = (r: Room) =>
    (loaded?.rooms[r] ?? []).map((b) => ({ s: toMinute(b.start), e: toMinute(b.end) }));
  const isFree = (r: Room, s: number, e: number) =>
    s >= Math.max(open, earliest) && e <= close && !busyFor(r).some((b) => s < b.e && b.s < e);

  const startsFor = (r: Room) => {
    const out: number[] = [];
    for (let s = Math.max(open, earliest); s + 60 <= close; s += STEP) if (isFree(r, s, s + 60)) out.push(s);
    return out;
  };
  const freeHours = (r: Room) => {
    let total = 0;
    for (let s = Math.max(open, earliest); s < close; s += STEP) if (isFree(r, s, s + STEP)) total += STEP;
    return total / 60;
  };

  const starts = loaded ? startsFor(room) : [];
  const chosenStart = start != null && starts.includes(start) ? start : null;
  const fits = (d: number) => chosenStart != null && isFree(room, chosenStart, chosenStart + d);
  const chosenDuration = duration != null && fits(duration) ? duration : null;
  const quote = chosenDuration ? calculatePrice(chosenDuration) : null;
  const cheaper = chosenDuration ? cheaperLongerOption(chosenDuration) : null;

  const groups: Array<[string, number[]]> = [
    ["Morning", starts.filter((s) => s < 720)],
    ["Afternoon", starts.filter((s) => s >= 720 && s < 1020)],
    ["Evening", starts.filter((s) => s >= 1020)],
  ];

  const close_ = () => dialogRef.current?.close();
  const submit = () => {
    if (chosenStart == null || !chosenDuration || disabled) return;
    const when = fmt(date, { weekday: "long", day: "numeric", month: "long" });
    onSubmit(`Book Room ${room} on ${when} from ${label(chosenStart)} to ${label(chosenStart + chosenDuration)}.`);
    close_();
  };

  const chip = (selected: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
      selected ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface text-fg hover:bg-hover"
    }`;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && close_()}
      aria-labelledby="picker-title"
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-surface p-0 text-fg shadow-card backdrop:bg-ink/45 sm:m-auto sm:max-h-[88dvh] sm:max-w-xl sm:rounded-2xl"
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="flex max-h-[inherit] flex-col"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
          <div>
            <h2 id="picker-title" className="font-serif text-xl font-semibold">
              Pick a time
            </h2>
            <p className="mt-0.5 text-[13px] text-fg-2">Prices update as you choose. Times are AEDT.</p>
          </div>
          <button
            type="button"
            onClick={close_}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Day */}
          <div role="group" aria-label="Day" className="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1">
            {days.map((d) => {
              const selected = d === date;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDate(d)}
                  className={`flex w-14 shrink-0 flex-col items-center rounded-xl border py-1.5 transition-colors ${
                    selected ? "border-ink bg-ink text-on-ink" : "border-line text-fg hover:bg-hover"
                  }`}
                >
                  <span className={`text-xs ${selected ? "text-on-ink/75" : d === today ? "text-brand" : "text-fg-3"}`}>
                    {d === today ? "Today" : fmt(d, { weekday: "short" })}
                  </span>
                  <span className="num text-base font-semibold">{Number(d.slice(8))}</span>
                </button>
              );
            })}
          </div>

          {/* Room */}
          <div role="group" aria-label="Room" className="grid grid-cols-2 gap-2">
            {(["A", "B"] as const).map((r) => {
              const selected = r === room;
              const free = loaded ? freeHours(r) : null;
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setRoom(r)}
                  className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                    selected ? "border-ink bg-ink text-on-ink" : "border-line-strong hover:bg-hover"
                  }`}
                >
                  <div className="text-sm font-semibold">Room {r}</div>
                  <div className={`num text-xs ${selected ? "text-on-ink/75" : "text-fg-3"}`}>
                    {free == null ? "…" : free === 0 ? "Fully booked" : `${free} hours free`}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Start */}
          <div>
            <div className="mb-2 text-[13px] font-semibold">Start time</div>
            {error ? (
              <p className="text-sm text-danger">{error}</p>
            ) : !loaded ? (
              <div className="h-20 animate-pulse rounded-xl bg-hover" aria-label="Loading times" />
            ) : starts.length === 0 ? (
              <p className="rounded-xl bg-inset px-3.5 py-3 text-sm text-fg-2">
                Room {room} has no free hour left on {fmt(date, { weekday: "long", day: "numeric", month: "short" })}. Try
                the other room or another day.
              </p>
            ) : (
              <div className="space-y-2.5">
                {groups
                  .filter(([, list]) => list.length)
                  .map(([name, list]) => (
                    <div key={name} role="group" aria-label={`${name} start times`}>
                      <div className="mb-1 text-xs text-fg-3">{name}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((s) => (
                          <button
                            key={s}
                            type="button"
                            aria-pressed={s === chosenStart}
                            onClick={() => setStart(s)}
                            className={`num ${chip(s === chosenStart)}`}
                          >
                            {label(s)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Duration */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-semibold">How long</span>
              <span className="text-xs text-fg-3">15% off 4 hours or more</span>
            </div>
            <div role="group" aria-label="Duration" className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {DURATIONS.map((d) => {
                const price = calculatePrice(d);
                const selected = d === chosenDuration;
                return (
                  <motion.button
                    key={d}
                    type="button"
                    {...pressable}
                    aria-pressed={selected}
                    disabled={!fits(d)}
                    onClick={() => setDuration(d)}
                    className={`flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                      selected ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface hover:bg-hover"
                    }`}
                  >
                    <span className="num text-[13px] font-semibold">{shortHours(d)}</span>
                    <span className={`num text-xs ${selected ? "text-on-ink/80" : "text-fg-2"}`}>
                      {formatMoney(price.totalCents)}
                      {price.discountApplied && (
                        <span className={`ml-1 font-semibold ${selected ? "text-on-ink" : "text-ok"}`}>−15%</span>
                      )}
                    </span>
                  </motion.button>
                );
              })}
            </div>
            <AnimatePresence>
              {cheaper && fits(cheaper.durationMinutes) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-ok-border bg-ok-soft px-3 py-2 text-[13px] text-ok">
                    <span>
                      4 hours costs {formatMoney(cheaper.totalCents)}, less than {formatMoney(quote!.totalCents)}.
                    </span>
                    <button
                      type="button"
                      onClick={() => setDuration(cheaper.durationMinutes)}
                      className="shrink-0 font-semibold underline underline-offset-2"
                    >
                      Switch to 4 hours
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-inset px-5 py-3.5">
          <div className="min-w-0 text-sm">
            {chosenStart != null && chosenDuration ? (
              <>
                <div className="num truncate font-medium">
                  Room {room} · {fmt(date, { weekday: "short", day: "numeric", month: "short" })} · {label(chosenStart)} –{" "}
                  {label(chosenStart + chosenDuration)}
                </div>
                <div className="num text-xs text-fg-2">
                  {hours(chosenDuration)} · <span className="font-semibold text-fg">{formatMoney(quote!.totalCents)}</span>
                  {quote!.discountApplied ? " with 15% off" : ""}
                </div>
              </>
            ) : (
              <span className="text-fg-2">Choose a start time and how long you need.</span>
            )}
          </div>
          <motion.button
            type="button"
            {...pressable}
            disabled={chosenStart == null || !chosenDuration || disabled}
            onClick={submit}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-on-ink transition-colors hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-hover disabled:text-fg-3"
          >
            Get a quote
          </motion.button>
        </div>
      </motion.div>
    </dialog>
  );
}
