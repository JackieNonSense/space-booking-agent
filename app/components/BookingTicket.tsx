"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { BookingProgress } from "./derive";
import { CalendarIcon, ClockIcon, DoorIcon, ExternalIcon, MailIcon, UserIcon } from "./icons";
import { EASE, pressable } from "./motion";

const STEPS = ["Date & time", "Room", "Your details", "Confirmed"] as const;

function stepsDone(p: BookingProgress): boolean[] {
  return [
    Boolean(p.time),
    Boolean(p.roomName),
    Boolean(p.customerName && p.customerEmail),
    p.stage === "booked",
  ];
}

const STATUS: Record<BookingProgress["stage"], string> = {
  idle: "Not started",
  when: "Finding a time",
  room: "Room chosen",
  quote: "Waiting for your OK",
  booked: "Confirmed",
};

/** A value that animates when it first appears or changes. */
function Value({ value, placeholder = "—" }: { value?: string; placeholder?: string }) {
  return (
    <span className="relative block min-h-5 overflow-hidden text-right">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value ?? "__empty"}
          className={`block truncate ${value ? "text-ink" : "text-faint"}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.28, ease: EASE }}
        >
          {value ?? placeholder}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Field({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
  return (
    <div className="grid grid-cols-[1.25rem_5.5rem_minmax(0,1fr)] items-center gap-2 py-1.5 text-sm">
      <span className={value ? "text-accent" : "text-faint"}>{icon}</span>
      <span className="text-muted">{label}</span>
      <Value value={value} />
    </div>
  );
}

export function BookingTicket({ progress }: { progress: BookingProgress }) {
  const done = stepsDone(progress);
  const current = done.findIndex((d) => !d);
  const completed = current === -1 ? STEPS.length : current;
  const booked = progress.stage === "booked";

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(43,38,34,0.04),0_12px_32px_-16px_rgba(43,38,34,0.18)]"
      aria-labelledby="ticket-heading"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <h2 id="ticket-heading" className="font-serif text-lg font-semibold text-ink">
          Your booking
        </h2>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={progress.stage}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              booked ? "bg-ok-soft text-ok" : progress.stage === "idle" ? "bg-paper text-muted" : "bg-accent-soft text-accent-strong"
            }`}
          >
            {STATUS[progress.stage]}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Progress */}
      <div className="px-4 pt-3.5">
        <div className="relative h-1 overflow-hidden rounded-full bg-paper">
          <motion.div
            className={`absolute inset-y-0 left-0 rounded-full ${booked ? "bg-ok" : "bg-accent"}`}
            initial={false}
            animate={{ width: `${(completed / STEPS.length) * 100}%` }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        </div>
        <ol className="mt-2 grid grid-cols-4 gap-1 text-[11px]">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`transition-colors duration-300 ${
                done[i] ? "font-medium text-ink" : i === current ? "text-accent-strong" : "text-faint"
              }`}
            >
              {label}
            </li>
          ))}
        </ol>
      </div>

      <div className="px-4 pt-2">
        <Field icon={<CalendarIcon className="h-4 w-4" />} label="Date" value={progress.dateLabel} />
        <Field icon={<ClockIcon className="h-4 w-4" />} label="Time" value={progress.time} />
        <Field icon={<ClockIcon className="h-4 w-4 opacity-0" />} label="Duration" value={progress.duration} />
        <Field icon={<DoorIcon className="h-4 w-4" />} label="Room" value={progress.roomName} />
        <Field icon={<UserIcon className="h-4 w-4" />} label="Name" value={progress.customerName} />
        <Field icon={<MailIcon className="h-4 w-4" />} label="Email" value={progress.customerEmail} />
      </div>

      <div className="relative my-3" aria-hidden>
        <div className="mx-4 border-t border-dashed border-line" />
        <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-line bg-paper" />
        <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-line bg-paper" />
      </div>

      <div className="flex items-end justify-between gap-3 px-4 pb-4">
        <div className="shrink-0">
          <div className="text-xs text-muted">Total</div>
          {progress.discountApplied && (
            <motion.div
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              className="mt-0.5 text-xs font-medium text-ok"
            >
              15% off for 4+ hours
            </motion.div>
          )}
        </div>
        {/* Stamp */}
        <AnimatePresence>
          {booked && (
            <motion.span
              key="stamp"
              aria-hidden
              className="mb-1 rounded-md border-2 border-ok/70 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ok/80"
              initial={{ opacity: 0, scale: 1.5, rotate: -16 }}
              animate={{ opacity: 1, scale: 1, rotate: -8 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, delay: 0.25, ease: EASE }}
            >
              Booked
            </motion.span>
          )}
        </AnimatePresence>
        <span className="font-serif text-3xl font-semibold tracking-tight">
          <Value value={progress.total} placeholder="$—" />
        </span>
      </div>

      <AnimatePresence>
        {booked && (
          <motion.div
            key="confirmed"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="border-t border-line bg-ok-soft/60"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-ok">Reference {progress.refCode}</div>
                <div className="truncate text-xs text-muted">
                  {progress.email
                    ? progress.email.status === "failed"
                      ? "The confirmation email couldn't be sent"
                      : progress.email.status === "dry_run"
                        ? "Email ready (not sent from this test server)"
                        : `Confirmation sent to ${progress.email.to}`
                    : "Sending confirmation email…"}
                </div>
              </div>
              {progress.bookingId && progress.email && progress.email.status !== "failed" && (
                <motion.a
                  {...pressable}
                  href={`/api/bookings/${progress.bookingId}/email`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-ok/30 bg-surface px-2.5 py-1 text-xs font-medium text-ok"
                >
                  View email <ExternalIcon className="h-3.5 w-3.5" />
                </motion.a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </section>
  );
}

/** Slim version for the top of the mobile chat. */
export function ProgressStrip({ progress, onOpen }: { progress: BookingProgress; onOpen: () => void }) {
  const done = stepsDone(progress);
  if (progress.stage === "idle") return null;
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex w-full items-center gap-3 border-b border-line bg-surface/90 px-4 py-2 text-left text-xs backdrop-blur lg:hidden"
    >
      <span className="flex gap-1" aria-hidden>
        {done.map((d, i) => (
          <motion.span
            key={i}
            className="h-1.5 w-5 rounded-full"
            initial={false}
            animate={{ backgroundColor: d ? (progress.stage === "booked" ? "#3f7a52" : "#8a6d4b") : "#e8e1d6" }}
          />
        ))}
      </span>
      <span className="flex-1 truncate text-muted">
        {STATUS[progress.stage]}
        {progress.roomName ? ` · ${progress.roomName}` : ""}
        {progress.dateLabel ? ` · ${progress.dateLabel}` : ""}
      </span>
      {progress.total && <span className="font-semibold text-ink">{progress.total}</span>}
    </motion.button>
  );
}
