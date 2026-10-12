"use client";

import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  ExternalIcon,
  MailIcon,
  TagIcon,
} from "./icons";
import { EASE, fadeUp, popIn, pressable, stagger } from "./motion";
import type { Alternative } from "./types";

type Data = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** "2026-10-16" → "Fri 16 Oct 2026" (dates are already in studio time). */
const shortDate = (iso: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";

// ---------------------------------------------------------------------------
// Building blocks

function Card({
  children,
  tone = "default",
  dimmed = false,
}: {
  children: ReactNode;
  tone?: "default" | "ok" | "warn";
  dimmed?: boolean;
}) {
  const ring =
    tone === "ok" ? "border-ok/35" : tone === "warn" ? "border-danger/25" : "border-line";
  return (
    <motion.div
      variants={popIn}
      initial="hidden"
      animate="show"
      className={`overflow-hidden rounded-2xl border ${ring} bg-surface shadow-[0_1px_2px_rgba(43,38,34,0.04),0_8px_24px_-12px_rgba(43,38,34,0.12)] transition-opacity duration-300 ${
        dimmed ? "opacity-55" : ""
      }`}
    >
      {children}
    </motion.div>
  );
}

function Header({ icon, label, aside }: { icon: ReactNode; label: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent">{icon}</span>
        {label}
      </div>
      {aside}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className="relative flex h-2 w-2" aria-hidden>
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-ok" : "bg-danger"}`} />
    </span>
  );
}

function Chips({
  alternatives,
  onPick,
  disabled,
}: {
  alternatives: Alternative[];
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  if (!alternatives.length) return null;
  return (
    <div className="border-t border-line bg-paper/50 px-4 py-3">
      <div className="mb-2 text-xs text-muted">Free instead — tap to choose</div>
      <motion.div className="flex flex-wrap gap-2" variants={stagger(0.06, 0.15)} initial="hidden" animate="show">
        {alternatives.map((a) => (
          <motion.button
            key={`${a.room}-${a.start}`}
            type="button"
            variants={fadeUp}
            {...pressable}
            disabled={disabled}
            onClick={() => onPick(`Let's go with ${a.label} instead.`)}
            className="rounded-full border border-accent/30 bg-surface px-3 py-1.5 text-xs font-medium text-accent-strong shadow-sm transition-colors hover:border-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            {a.label}
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AvailabilityCard({
  data,
  onPick,
  disabled,
}: {
  data: Data;
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  const requested = data.requested as
    | { when: string; rooms: Array<{ room: string; roomName: string; available: boolean }> }
    | null;
  const free = (data.freeWindows ?? {}) as Record<string, Array<{ label: string }>>;
  const alternatives = (data.alternatives ?? []) as Alternative[];

  return (
    <Card>
      <Header icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Availability" />
      <div className="px-4 pb-3.5 pt-2">
        <div className="text-[15px] font-medium text-ink">{requested ? requested.when : str(data.dateLabel)}</div>
        <motion.ul className="mt-2.5 space-y-1.5" variants={stagger(0.07, 0.1)} initial="hidden" animate="show">
          {requested
            ? requested.rooms.map((r) => (
                <motion.li key={r.room} variants={fadeUp} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-ink">{r.roomName}</span>
                  <span className={`flex items-center gap-1.5 font-medium ${r.available ? "text-ok" : "text-danger"}`}>
                    <StatusDot ok={r.available} />
                    {r.available ? "Free" : "Booked"}
                  </span>
                </motion.li>
              ))
            : Object.entries(free).map(([room, windows]) => (
                <motion.li key={room} variants={fadeUp} className="flex gap-3 text-sm">
                  <span className="w-16 shrink-0 text-muted">{room}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {windows.length ? (
                      windows.map((w) => (
                        <span key={w.label} className="rounded-md bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">
                          {w.label}
                        </span>
                      ))
                    ) : (
                      <span className="text-danger">Fully booked</span>
                    )}
                  </span>
                </motion.li>
              ))}
        </motion.ul>
      </div>
      <Chips alternatives={alternatives} onPick={onPick} disabled={disabled} />
    </Card>
  );
}

export function UnavailableCard({
  data,
  onPick,
  disabled,
}: {
  data: Data;
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <Card tone="warn">
      <Header icon={<AlertIcon className="h-3.5 w-3.5" />} label="Not available" />
      <p className="px-4 pb-3.5 pt-2 text-sm text-ink">{str(data.message)}</p>
      <Chips alternatives={(data.alternatives ?? []) as Alternative[]} onPick={onPick} disabled={disabled} />
    </Card>
  );
}

export function PriceCard({ data }: { data: Data }) {
  return (
    <Card>
      <Header icon={<TagIcon className="h-3.5 w-3.5" />} label="Price" />
      <div className="flex items-end justify-between gap-4 px-4 pb-3.5 pt-2">
        <p className="text-xs leading-relaxed text-muted">{str(data.breakdown)}</p>
        <span className="font-serif text-2xl font-semibold text-ink">{str(data.total)}</span>
      </div>
    </Card>
  );
}

export type QuoteState = "active" | "booked" | "superseded";

export function QuoteCard({
  data,
  state,
  onConfirm,
  onChange,
  disabled,
}: {
  data: Data;
  state: QuoteState;
  onConfirm: () => void;
  onChange: () => void;
  disabled: boolean;
}) {
  const discounted = data.discountApplied === true;
  const badge =
    state === "booked" ? (
      <span className="flex items-center gap-1 rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-medium text-ok">
        <CheckIcon className="h-3 w-3" /> Booked
      </span>
    ) : state === "superseded" ? (
      <span className="text-xs text-faint">Replaced</span>
    ) : (
      <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">
        Held for 15 min
      </span>
    );

  return (
    <Card dimmed={state === "superseded"}>
      <Header icon={<TagIcon className="h-3.5 w-3.5" />} label="Your quote" aside={badge} />

      <motion.div className="px-4 pt-2.5" variants={stagger(0.05, 0.08)} initial="hidden" animate="show">
        <motion.div variants={fadeUp} className="font-serif text-xl font-semibold text-ink">
          {str(data.roomName)}
        </motion.div>
        <motion.div variants={fadeUp} className="mt-0.5 text-sm text-muted">
          {str(data.when)} · {str(data.duration)}
        </motion.div>
        <motion.div variants={fadeUp} className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span>{str(data.customerName)}</span>
          <span className="flex items-center gap-1">
            <MailIcon className="h-3.5 w-3.5" />
            {str(data.customerEmail)}
          </span>
        </motion.div>
      </motion.div>

      {/* Ticket perforation */}
      <div className="relative my-3.5" aria-hidden>
        <div className="mx-4 border-t border-dashed border-line" />
        <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-line bg-paper" />
        <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-line bg-paper" />
      </div>

      <div className="px-4">
        {discounted && (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between text-muted">
              <dt>Subtotal</dt>
              <dd>{str(data.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-ok">
              <dt>4+ hour discount (15%)</dt>
              <dd>−{str(data.discount)}</dd>
            </div>
          </dl>
        )}
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink">Total</span>
          <motion.span
            className="font-serif text-3xl font-semibold tracking-tight text-ink"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25, ease: EASE }}
          >
            {str(data.total)}
          </motion.span>
        </div>
        <p className="mt-1 text-xs text-faint">{str(data.breakdown)}</p>
      </div>

      {state === "active" ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-line bg-paper/50 px-4 py-3">
          <motion.button
            type="button"
            {...pressable}
            disabled={disabled}
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckIcon className="h-4 w-4" />
            Confirm booking
          </motion.button>
          <motion.button
            type="button"
            {...pressable}
            disabled={disabled}
            onClick={onChange}
            className="rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-accent-soft hover:text-ink disabled:opacity-50"
          >
            Change something
          </motion.button>
        </div>
      ) : (
        <div className="h-3.5" />
      )}
    </Card>
  );
}

/** A check mark that draws itself once. */
function DrawnCheck() {
  return (
    <motion.svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <motion.circle
        cx="12"
        cy="12"
        r="10"
        className="fill-ok"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
      />
      <motion.path
        d="m7.5 12.5 3 3 6-6.5"
        stroke="white"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: 0.2, ease: EASE }}
      />
    </motion.svg>
  );
}

function CopyRef({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.button
      type="button"
      {...pressable}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="flex items-center gap-1.5 rounded-lg bg-ok-soft px-2.5 py-1 font-mono text-sm font-semibold text-ok transition-colors hover:bg-ok/15"
      title="Copy booking reference"
    >
      {value}
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5 opacity-70" />}
    </motion.button>
  );
}

export function ConfirmedCard({ data }: { data: Data }) {
  return (
    <Card tone="ok">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <div className="flex items-center gap-2">
          <DrawnCheck />
          <span className="text-[15px] font-semibold text-ink">Booking confirmed</span>
        </div>
        <CopyRef value={str(data.refCode)} />
      </div>
      <motion.dl
        className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 pb-4 pt-3 text-sm sm:grid-cols-4"
        variants={stagger(0.05, 0.3)}
        initial="hidden"
        animate="show"
      >
        {[
          ["Room", str(data.roomName)],
          ["Date", shortDate(str(data.date))],
          ["Time", str(data.when).split(", ").slice(-1)[0]],
          ["Total", str(data.total)],
        ].map(([k, v]) => (
          <motion.div key={k} variants={fadeUp}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className={k === "Total" ? "font-serif text-lg font-semibold text-ink" : "text-ink"}>{v}</dd>
          </motion.div>
        ))}
      </motion.dl>
    </Card>
  );
}

export function EmailCard({
  data,
  automatic,
  bookingId,
}: {
  data: Data;
  automatic?: boolean;
  bookingId?: string;
}) {
  const status = str(data.status);
  const to = str(data.to);
  const failed = status === "failed";
  const title =
    status === "sent"
      ? `Confirmation emailed to ${to}`
      : status === "already_sent"
        ? `Confirmation already sent to ${to}`
        : status === "dry_run"
          ? `Confirmation email ready for ${to}`
          : `Email to ${to} couldn't be sent`;
  const detail =
    status === "sent"
      ? "Check the spam folder if it isn't in the inbox within a minute."
      : status === "dry_run"
        ? "This test server doesn't send emails. Preview it below."
        : automatic
          ? "Sent automatically by the booking system."
          : null;

  return (
    <motion.div
      variants={popIn}
      initial="hidden"
      animate="show"
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
        failed ? "border-danger/25 bg-danger-soft" : "border-line bg-surface"
      }`}
    >
      <motion.span
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${failed ? "bg-white text-danger" : "bg-ok-soft text-ok"}`}
        initial={{ x: -6, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.35, delay: 0.1, ease: EASE }}
      >
        <MailIcon className="h-4 w-4" />
      </motion.span>
      <div className="min-w-0 flex-1">
        <div className={failed ? "text-danger" : "text-ink"}>{title}</div>
        {str(data.subject) && <div className="mt-0.5 truncate text-xs text-muted">“{str(data.subject)}”</div>}
        {detail && <div className="mt-0.5 text-xs text-muted">{detail}</div>}
      </div>
      {bookingId && !failed && (
        <motion.a
          {...pressable}
          href={`/api/bookings/${bookingId}/email`}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-accent-soft"
        >
          Preview
          <ExternalIcon className="h-3.5 w-3.5" />
        </motion.a>
      )}
    </motion.div>
  );
}
