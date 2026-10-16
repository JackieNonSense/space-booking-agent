"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { describeStep, type BookingProgress, type ToolPart } from "./derive";
import { CalendarIcon, ClockIcon, DoorIcon, ExternalIcon, MailIcon, UserIcon } from "./icons";
import { EASE, pressable } from "./motion";
import { StepIcon } from "./StepRow";

const STEPS = ["Date & time", "Room", "Details", "Confirmed"] as const;

function stepsDone(p: BookingProgress): boolean[] {
  return [Boolean(p.time), Boolean(p.roomName), Boolean(p.customerName && p.customerEmail), p.stage === "booked"];
}

const STATUS: Record<BookingProgress["stage"], string> = {
  idle: "Not started",
  when: "Finding a time",
  room: "Room chosen",
  quote: "Waiting for your OK",
  booked: "Confirmed",
  cancelled: "Cancelled",
};

/** A value that animates in when it first appears or changes. */
function Value({ value, placeholder = "—", className = "" }: { value?: string; placeholder?: string; className?: string }) {
  return (
    <span className={`relative block min-h-5 overflow-hidden text-right ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value ?? "__empty"}
          className={`num block truncate ${value ? "text-fg" : "text-fg-3"}`}
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
    <div className="grid grid-cols-[1.25rem_5rem_minmax(0,1fr)] items-center gap-2 py-[7px] text-sm">
      <span className={`transition-colors ${value ? "text-fg" : "text-fg-3"}`}>{icon}</span>
      <span className="text-fg-2">{label}</span>
      <Value value={value} className="font-medium" />
    </div>
  );
}

// Studio time, like every other time on the page.
const clock = (t: number) =>
  new Date(t).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Australia/Sydney",
  });

export function BookingTicket({ progress, steps }: { progress: BookingProgress; steps: ToolPart[] }) {
  const done = stepsDone(progress);
  const current = done.findIndex((d) => !d);
  const booked = progress.stage === "booked";
  const cancelled = progress.stage === "cancelled";

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-labelledby="ticket-heading">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <h2 id="ticket-heading" className="font-serif text-xl font-semibold text-fg">
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
              booked
                ? "bg-ok-soft text-ok"
                : cancelled
                  ? "bg-danger-soft text-danger"
                  : progress.stage === "idle"
                    ? "bg-hover text-fg-2"
                    : "bg-brand-soft text-brand-strong"
            }`}
          >
            {STATUS[progress.stage]}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Progress: four segments, one per step */}
      <ol className="mt-3.5 grid grid-cols-4 gap-1.5 px-4" aria-label="Booking progress">
        {STEPS.map((label, i) => (
          <li key={label}>
            <div className="h-1 overflow-hidden rounded-full bg-hover">
              <motion.div
                className={`h-full rounded-full ${booked ? "bg-ok" : cancelled ? "bg-danger" : "bg-ink"}`}
                initial={false}
                animate={{ width: done[i] ? "100%" : "0%" }}
                transition={{ duration: 0.45, ease: EASE }}
              />
            </div>
            <div
              className={`mt-1.5 truncate text-xs ${done[i] ? "font-medium text-fg" : i === current ? "font-medium text-brand" : "text-fg-3"}`}
            >
              {label}
              <span className="sr-only">{done[i] ? " (done)" : i === current ? " (in progress)" : ""}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-2 divide-y divide-line px-4">
        <Field icon={<CalendarIcon className="h-4 w-4" />} label="Date" value={progress.dateLabel} />
        <Field icon={<ClockIcon className="h-4 w-4" />} label="Time" value={progress.time} />
        <Field icon={<ClockIcon className="h-4 w-4 opacity-0" />} label="Duration" value={progress.duration} />
        <Field icon={<DoorIcon className="h-4 w-4" />} label="Room" value={progress.roomName} />
        <Field icon={<UserIcon className="h-4 w-4" />} label="Name" value={progress.customerName} />
        <Field icon={<MailIcon className="h-4 w-4" />} label="Email" value={progress.customerEmail} />
      </div>

      <div className="mx-4 mb-4 mt-2 flex items-end justify-between gap-3 rounded-xl bg-inset px-3.5 py-3">
        <div className="shrink-0">
          <div className="text-sm font-semibold text-fg">Total</div>
          <AnimatePresence>
            {progress.discountApplied && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="mt-0.5 text-xs font-medium text-ok"
              >
                15% off for 4+ hours
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence mode="popLayout">
          {(booked || cancelled) && (
            <motion.span
              key={cancelled ? "stamp-cancelled" : "stamp-booked"}
              aria-hidden
              className={`mb-1 rounded-md border-2 px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-[0.18em] ${
                cancelled ? "border-danger text-danger" : "border-brand text-brand"
              }`}
              initial={{ opacity: 0, scale: 1.5, rotate: -16 }}
              animate={{ opacity: 1, scale: 1, rotate: -8 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, delay: 0.25, ease: EASE }}
            >
              {cancelled ? "Cancelled" : "Booked"}
            </motion.span>
          )}
        </AnimatePresence>
        <span className="font-serif text-[28px] font-semibold leading-none tracking-tight">
          <Value value={progress.total} placeholder="$—" />
        </span>
      </div>

      <AnimatePresence>
        {(progress.replacesRef || progress.cancelPending) && !cancelled && (
          <motion.p
            key="pending-change"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-line bg-brand-soft px-4 py-2.5 text-[13px] text-brand-strong"
          >
            {progress.cancelPending
              ? `Cancelling ${progress.refCode}: waiting for your confirmation`
              : booked
                ? `Moved from ${progress.replacesRef}, which is now cancelled`
                : `Moving ${progress.replacesRef} to this new time`}
          </motion.p>
        )}
        {cancelled && (
          <motion.div
            key="cancelled"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="border-t border-danger-border bg-danger-soft px-4 py-3"
          >
            <div className="text-sm font-semibold text-danger">
              Reference <span className="font-mono line-through">{progress.refCode}</span> cancelled
            </div>
            <div className="text-xs text-fg-2">
              {progress.email?.status === "sent"
                ? `Cancellation notice sent to ${progress.email.to}`
                : progress.email?.status === "dry_run"
                  ? "Notice ready (not sent from this test server)"
                  : progress.email?.status === "demo_address"
                    ? "Notice ready (example address, not sent)"
                    : "This time has been released"}
            </div>
          </motion.div>
        )}
        {booked && (
          <motion.div
            key="confirmed"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="border-t border-ok-border bg-ok-soft"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ok">
                  Reference <span className="font-mono">{progress.refCode}</span>
                </div>
                <div className="truncate text-xs text-fg-2">
                  {progress.email
                    ? progress.email.status === "failed"
                      ? "The confirmation email couldn't be sent"
                      : progress.email.status === "dry_run"
                        ? "Email ready (not sent from this test server)"
                        : progress.email.status === "demo_address"
                          ? "Email ready (example address, not sent)"
                          : `Confirmation sent to ${progress.email.to}`
                    : "Sending the confirmation email…"}
                </div>
              </div>
              {progress.bookingId && progress.email && (
                <motion.a
                  {...pressable}
                  href={`/api/bookings/${progress.bookingId}/email`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-ok-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ok"
                >
                  View email <ExternalIcon className="h-3.5 w-3.5" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </motion.a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Activity: every step the agent took, as a record */}
      <div className="border-t border-line px-4 pb-3 pt-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-fg">Activity</h3>
          <span className="num text-xs text-fg-3">
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </span>
        </div>
        {steps.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-fg-3">Each check, quote and booking the assistant makes will be listed here.</p>
        ) : (
          <ol className="relative mt-2 space-y-2.5 before:absolute before:bottom-1 before:left-[7px] before:top-1 before:w-px before:bg-line">
            <AnimatePresence initial={false}>
              {steps.slice(-8).map((p) => {
                const step = describeStep(p);
                return (
                  <motion.li
                    key={p.id}
                    layout
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="relative flex gap-2.5"
                  >
                    <span className="relative z-10 mt-0.5 rounded-full bg-surface">
                      <StepIcon tone={step.tone} />
                    </span>
                    <div className="min-w-0 flex-1 text-[13px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-fg">{step.title}</span>
                        <span className="num shrink-0 text-xs text-fg-3">{clock(p.at)}</span>
                      </div>
                      {step.detail && <div className="num truncate text-xs text-fg-3">{step.detail}</div>}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        )}
      </div>
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
      className="flex w-full items-center gap-3 border-b border-line bg-surface px-4 py-2.5 text-left text-[13px] lg:hidden"
    >
      <span className="flex gap-1" aria-hidden>
        {done.map((d, i) => (
          <span
            key={i}
            className={`h-1.5 w-5 rounded-full transition-colors ${d ? (progress.stage === "booked" ? "bg-ok" : progress.stage === "cancelled" ? "bg-danger" : "bg-ink") : "bg-hover"}`}
          />
        ))}
      </span>
      <span className="num flex-1 truncate text-fg-2">
        <span className="font-medium text-fg">{STATUS[progress.stage]}</span>
        {progress.roomName ? ` · ${progress.roomName}` : ""}
        {progress.dateLabel ? ` · ${progress.dateLabel}` : ""}
      </span>
      {progress.total && <span className="num font-semibold text-fg">{progress.total}</span>}
    </motion.button>
  );
}
