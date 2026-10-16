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
  XIcon,
} from "./icons";
import { EASE, fadeUp, popIn, pressable, stagger } from "./motion";
import type { Alternative } from "./types";

// Inline cards follow one rule set: a title row, the content, and at most one
// primary and one secondary action at the bottom.

type Data = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** "2026-10-16" → "Fri 16 Oct" (dates are already in studio time). */
const shortDate = (iso: string) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";

/** Clock time of an ISO timestamp in studio time (AEDT), e.g. "3:12 pm". */
const sydneyTime = (iso: string) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" })
    : "";

// ---------------------------------------------------------------------------
// Building blocks

function Card({ children, tone = "default", dimmed = false }: { children: ReactNode; tone?: "default" | "ok" | "danger"; dimmed?: boolean }) {
  const border = tone === "ok" ? "border-ok-border" : tone === "danger" ? "border-danger-border" : "border-line";
  return (
    <motion.div
      variants={popIn}
      initial="hidden"
      animate="show"
      className={`overflow-hidden rounded-xl border ${border} bg-surface shadow-card transition-opacity duration-300 ${dimmed ? "opacity-60" : ""}`}
    >
      {children}
    </motion.div>
  );
}

function Title({ icon, children, aside }: { icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        <span className="text-fg-3">{icon}</span>
        <span>{children}</span>
      </div>
      {aside}
    </div>
  );
}

function Badge({ tone, children }: { tone: "ok" | "danger" | "brand" | "neutral"; children: ReactNode }) {
  const style = {
    ok: "bg-ok-soft text-ok",
    danger: "bg-danger-soft text-danger",
    brand: "bg-brand-soft text-brand-strong",
    neutral: "bg-hover text-fg-2",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{children}</span>;
}

function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      {...pressable}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-on-ink transition-colors hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </motion.button>
  );
}

function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      {...pressable}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </motion.button>
  );
}

/** Alternatives as comparable options, each one tap away. */
function Options({ alternatives, onPick, disabled }: { alternatives: Alternative[]; onPick: (text: string) => void; disabled: boolean }) {
  if (!alternatives.length) return null;
  return (
    <div className="border-t border-line bg-inset px-4 pb-3 pt-2.5">
      <div className="mb-1.5 text-xs font-medium text-fg-2">Available instead</div>
      <motion.ul className="divide-y divide-line" variants={stagger(0.06, 0.12)} initial="hidden" animate="show">
        {alternatives.map((a) => (
          <motion.li key={`${a.room}-${a.start}`} variants={fadeUp} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-fg">{a.roomName}</div>
              <div className="num text-[13px] text-fg-2">{a.label.split(", ").slice(1).join(", ")}</div>
            </div>
            <div className="num text-right">
              <div className="text-sm font-semibold text-fg">{a.total}</div>
              <div className="text-xs text-fg-3">{a.duration}</div>
            </div>
            <SecondaryButton disabled={disabled} onClick={() => onPick(`Let's go with ${a.label} instead.`)}>
              Choose
            </SecondaryButton>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Footer link that opens the slot picker for the same day. */
function PickAnotherTime({ onClick, disabled }: { onClick?: () => void; disabled: boolean }) {
  if (!onClick) return null;
  return (
    <div className="border-t border-line px-4 py-2.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg underline-offset-2 hover:underline disabled:opacity-40"
      >
        <CalendarIcon className="h-4 w-4 text-fg-3" />
        Pick another time
      </button>
    </div>
  );
}

export function AvailabilityCard({
  data,
  onPick,
  onPickTime,
  disabled,
}: {
  data: Data;
  onPick: (text: string) => void;
  onPickTime?: () => void;
  disabled: boolean;
}) {
  const requested = data.requested as
    | { when: string; rooms: Array<{ room: string; roomName: string; available: boolean }> }
    | null;
  const free = (data.freeWindows ?? {}) as Record<string, Array<{ label: string }>>;
  const alternatives = (data.alternatives ?? []) as Alternative[];

  return (
    <Card>
      <Title icon={<CalendarIcon className="h-4 w-4" />}>Availability</Title>
      <div className="px-4 pb-3.5 pt-1.5">
        <div className="num text-[15px] text-fg">{requested ? requested.when : str(data.dateLabel)}</div>
        <motion.ul className="mt-2.5 divide-y divide-line" variants={stagger(0.06, 0.08)} initial="hidden" animate="show">
          {requested
            ? requested.rooms.map((r) => (
                <motion.li key={r.room} variants={fadeUp} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-medium text-fg">{r.roomName}</span>
                  {r.available ? (
                    <Badge tone="ok">
                      <CheckIcon className="h-3 w-3" strokeWidth={2.5} /> Free
                    </Badge>
                  ) : (
                    <Badge tone="danger">Booked</Badge>
                  )}
                </motion.li>
              ))
            : Object.entries(free).map(([room, windows]) => (
                <motion.li key={room} variants={fadeUp} className="flex gap-3 py-2 text-sm">
                  <span className="w-16 shrink-0 font-medium text-fg">{room}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {windows.length ? (
                      windows.map((w) => (
                        <span key={w.label} className="num rounded-md bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">
                          {w.label}
                        </span>
                      ))
                    ) : (
                      <Badge tone="danger">Fully booked</Badge>
                    )}
                  </span>
                </motion.li>
              ))}
        </motion.ul>
      </div>
      <Options alternatives={alternatives} onPick={onPick} disabled={disabled} />
      <PickAnotherTime onClick={onPickTime} disabled={disabled} />
    </Card>
  );
}

export function UnavailableCard({
  data,
  onPick,
  onPickTime,
  disabled,
}: {
  data: Data;
  onPick: (text: string) => void;
  onPickTime?: () => void;
  disabled: boolean;
}) {
  return (
    <Card tone="danger">
      <Title icon={<AlertIcon className="h-4 w-4 text-danger" />}>Not available</Title>
      <p className="px-4 pb-3.5 pt-1.5 text-sm text-fg-2">{str(data.message)}</p>
      <Options alternatives={(data.alternatives ?? []) as Alternative[]} onPick={onPick} disabled={disabled} />
      <PickAnotherTime onClick={onPickTime} disabled={disabled} />
    </Card>
  );
}

export function PriceCard({ data }: { data: Data }) {
  return (
    <Card>
      <Title icon={<TagIcon className="h-4 w-4" />}>Price</Title>
      <div className="flex items-end justify-between gap-4 px-4 pb-4 pt-1.5">
        <p className="num text-[13px] leading-relaxed text-fg-2">{str(data.breakdown)}</p>
        <span className="num font-serif text-[28px] font-semibold leading-none text-fg">{str(data.total)}</span>
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
  const replaces = data.replaces as { refCode: string; roomName: string; when: string; total: string } | null;
  const badge =
    state === "booked" ? (
      <Badge tone="ok">
        <CheckIcon className="h-3 w-3" strokeWidth={2.5} /> Booked
      </Badge>
    ) : state === "superseded" ? (
      <Badge tone="neutral">Replaced by a newer quote</Badge>
    ) : (
      <Badge tone="brand">Held until {sydneyTime(str(data.expiresAt))}</Badge>
    );

  return (
    <Card dimmed={state === "superseded"}>
      <Title icon={<TagIcon className="h-4 w-4" />} aside={badge}>
        {replaces ? "New time" : "Quote"}
      </Title>
      {replaces && (
        <div className="mx-4 mt-2.5 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-[13px] text-brand-strong">
          <div className="font-semibold">Moving booking {replaces.refCode}</div>
          <div className="num">
            From {replaces.roomName}, {replaces.when}
          </div>
        </div>
      )}

      <motion.div className="px-4 pt-2" variants={stagger(0.05, 0.06)} initial="hidden" animate="show">
        <motion.div variants={fadeUp} className="text-lg font-semibold text-fg">
          {str(data.roomName)}
        </motion.div>
        <motion.div variants={fadeUp} className="num mt-0.5 text-[15px] text-fg-2">
          {str(data.when)}
        </motion.div>
        <motion.dl variants={fadeUp} className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
          <div>
            <dt className="text-fg-3">Duration</dt>
            <dd className="num font-medium text-fg">{str(data.duration)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-fg-3">Name</dt>
            <dd className="truncate font-medium text-fg">{str(data.customerName)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-fg-3">Email</dt>
            <dd className="truncate font-medium text-fg" title={str(data.customerEmail)}>
              {str(data.customerEmail)}
            </dd>
          </div>
        </motion.dl>
      </motion.div>

      <div className="mx-4 mt-3.5 rounded-lg bg-inset px-3.5 py-3">
        {discounted && (
          <dl className="num mb-2 space-y-1 border-b border-line pb-2 text-[13px]">
            <div className="flex justify-between text-fg-2">
              <dt>Subtotal</dt>
              <dd>{str(data.subtotal)}</dd>
            </div>
            <div className="flex justify-between font-medium text-ok">
              <dt>4+ hour discount (15%)</dt>
              <dd>−{str(data.discount)}</dd>
            </div>
          </dl>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-fg">Total</span>
          <motion.span
            className="num font-serif text-[28px] font-semibold leading-none tracking-tight text-fg"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2, ease: EASE }}
          >
            {str(data.total)}
          </motion.span>
        </div>
        <p className="num mt-1.5 text-xs text-fg-3">{str(data.breakdown)}</p>
        {replaces && (
          <div className="num mt-2 flex justify-between border-t border-line pt-2 text-[13px]">
            <span className="text-fg-2">Change from {replaces.total}</span>
            <span className="font-semibold text-fg">{str(data.priceDifference)}</span>
          </div>
        )}
      </div>

      {state === "active" ? (
        <div className="px-4 pb-4 pt-3.5">
          <p className="text-[13px] text-fg-2">
            {replaces ? (
              <>
                Confirming moves {replaces.refCode} to this time. It will be cancelled, and the new reference is
                emailed to <span className="font-medium text-fg [overflow-wrap:anywhere]">{str(data.customerEmail)}</span>.
              </>
            ) : (
              <>
                Confirming books {str(data.roomName)} and emails the confirmation to{" "}
                <span className="font-medium text-fg [overflow-wrap:anywhere]">{str(data.customerEmail)}</span>.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <PrimaryButton onClick={onConfirm} disabled={disabled}>
              <CheckIcon className="h-4 w-4" strokeWidth={2.25} />
              {replaces ? "Confirm change" : "Confirm and book"}
            </PrimaryButton>
            <SecondaryButton onClick={onChange} disabled={disabled}>
              Change
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <div className="h-4" />
      )}
    </Card>
  );
}

/** A check mark that draws itself once. */
function DrawnCheck() {
  return (
    <motion.svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden>
      <motion.circle
        cx="12"
        cy="12"
        r="11"
        className="fill-ok"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
      />
      <motion.path
        d="m7.5 12.5 3 3 6-6.5"
        stroke="white"
        strokeWidth={2.4}
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
      className="inline-flex items-center gap-1.5 rounded-lg border border-ok-border bg-ok-soft px-2.5 py-1 font-mono text-sm font-semibold text-ok transition-colors hover:bg-surface"
      title="Copy booking reference"
      aria-label={`Copy booking reference ${value}`}
    >
      {value}
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
    </motion.button>
  );
}

export function ConfirmedCard({ data }: { data: Data }) {
  const replaced = data.replaced as { refCode: string; when: string } | null;
  return (
    <Card tone="ok">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <div className="flex items-center gap-2.5">
          <DrawnCheck />
          <span className="text-[15px] font-semibold text-fg">{replaced ? "Booking moved" : "Booking confirmed"}</span>
        </div>
        <CopyRef value={str(data.refCode)} />
      </div>
      <motion.dl
        className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pb-4 pt-3.5 sm:grid-cols-4"
        variants={stagger(0.05, 0.25)}
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
            <dt className="text-xs text-fg-3">{k}</dt>
            <dd className={`num ${k === "Total" ? "font-serif text-lg font-semibold" : "text-sm font-medium"} text-fg`}>{v}</dd>
          </motion.div>
        ))}
      </motion.dl>
      {replaced && (
        <p className="num border-t border-line px-4 py-2.5 text-[13px] text-fg-2">
          Replaces <span className="font-mono font-semibold text-fg line-through">{replaced.refCode}</span> (
          {replaced.when}), now cancelled.
        </p>
      )}
      <div className="border-t border-line px-4 py-2.5">
        <a
          href={googleCalendarUrl(data)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg underline-offset-2 hover:underline"
        >
          <CalendarIcon className="h-4 w-4 text-fg-3" />
          Add to Google Calendar
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </Card>
  );
}

/** A prefilled Google Calendar event; times are studio-local with ctz. */
function googleCalendarUrl(data: Data) {
  const stamp = (hhmm: string) => `${str(data.date).replaceAll("-", "")}T${hhmm.replace(":", "")}00`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${str(data.roomName)} booking – Eastern Essence Studio`,
    dates: `${stamp(str(data.start))}/${stamp(str(data.end))}`,
    ctz: "Australia/Sydney",
    details: `Booking ${str(data.refCode)} · ${str(data.duration)} · ${str(data.total)}`,
    location: `Eastern Essence Studio – ${str(data.roomName)}`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Four facts about a booking, used by the lookup and cancellation cards. */
function BookingFacts({ data }: { data: Data }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pb-4 pt-3 sm:grid-cols-4">
      {[
        ["Room", str(data.roomName)],
        ["Date", shortDate(str(data.date))],
        ["Time", str(data.when).split(", ").slice(-1)[0]],
        ["Total", str(data.total)],
      ].map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-fg-3">{k}</dt>
          <dd className="num text-sm font-medium text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BookingFoundCard({ data }: { data: Data }) {
  const cancelled = data.status === "cancelled";
  return (
    <Card>
      <Title
        icon={<CalendarIcon className="h-4 w-4" />}
        aside={<Badge tone={cancelled ? "danger" : "ok"}>{cancelled ? "Cancelled" : "Confirmed"}</Badge>}
      >
        Booking <span className="font-mono">{str(data.refCode)}</span>
      </Title>
      <BookingFacts data={data} />
    </Card>
  );
}

export type CancellationState = "active" | "done" | "superseded";

export function CancellationCard({
  data,
  state,
  onConfirm,
  onKeep,
  disabled,
}: {
  data: Data;
  state: CancellationState;
  onConfirm: () => void;
  onKeep: () => void;
  disabled: boolean;
}) {
  return (
    <Card tone={state === "active" ? "danger" : "default"} dimmed={state === "superseded"}>
      <Title
        icon={<AlertIcon className="h-4 w-4 text-danger" />}
        aside={state === "done" ? <Badge tone="danger">Cancelled</Badge> : null}
      >
        Cancel booking <span className="font-mono">{str(data.refCode)}</span>?
      </Title>
      <BookingFacts data={data} />
      {state === "active" && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <p className="text-[13px] text-fg-2">
            Cancelling releases this time. A cancellation notice goes to{" "}
            <span className="font-medium text-fg [overflow-wrap:anywhere]">{str(data.customerEmail)}</span>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <motion.button
              type="button"
              {...pressable}
              onClick={onConfirm}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3.5 py-2 text-sm font-semibold text-on-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Yes, cancel it
            </motion.button>
            <SecondaryButton onClick={onKeep} disabled={disabled}>
              Keep it
            </SecondaryButton>
          </div>
        </div>
      )}
    </Card>
  );
}

export function CancelledCard({ data }: { data: Data }) {
  const email = data.email as { status: string; to: string } | undefined;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-danger text-on-ink" aria-hidden>
            <XIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <span className="text-[15px] font-semibold text-fg">Booking cancelled</span>
        </div>
        <span className="font-mono text-sm font-semibold text-fg-2 line-through">{str(data.refCode)}</span>
      </div>
      <BookingFacts data={data} />
      {email && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] text-fg-2">
          <span className="flex items-center gap-2">
            <MailIcon className="h-4 w-4 text-fg-3" />
            {email.status === "sent"
              ? `Cancellation notice emailed to ${email.to}`
              : email.status === "dry_run"
                ? "Cancellation notice ready (not sent from this test server)"
                : email.status === "already_sent"
                  ? `Notice already sent to ${email.to}`
                  : "The cancellation notice couldn't be sent"}
          </span>
          {email.status !== "failed" && (
            <a
              href={`/api/bookings/${str(data.id)}/email`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-fg underline-offset-2 hover:underline"
            >
              Preview <ExternalIcon className="h-3.5 w-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

export function EmailCard({ data, automatic, bookingId }: { data: Data; automatic?: boolean; bookingId?: string }) {
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
          : `Couldn't email ${to}`;
  const detail =
    status === "sent"
      ? "If it isn't in the inbox within a minute, check the spam folder."
      : status === "dry_run"
        ? "This test server doesn't send emails. You can preview it."
        : failed
          ? "The booking is still confirmed. Keep the booking reference."
          : null;

  return (
    <Card tone={failed ? "danger" : "default"}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <motion.span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${failed ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok"}`}
          initial={{ x: -6, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.1, ease: EASE }}
        >
          <MailIcon className="h-4 w-4" />
        </motion.span>
        <div className="min-w-0 flex-1">
          {/* Long addresses have no natural break points. */}
          <div className="text-sm font-semibold text-fg [overflow-wrap:anywhere]">{title}</div>
          {str(data.subject) && <div className="mt-0.5 truncate text-[13px] text-fg-2">{str(data.subject)}</div>}
          {(detail || automatic) && (
            <div className="mt-1 text-xs text-fg-3">
              {detail}
              {automatic ? " Sent by the booking system." : ""}
            </div>
          )}
        </div>
        {bookingId && !failed && (
          <motion.a
            {...pressable}
            href={`/api/bookings/${bookingId}/email`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
          >
            Preview
            <span className="sr-only"> (opens in a new tab)</span>
            <ExternalIcon className="h-3.5 w-3.5" />
          </motion.a>
        )}
      </div>
    </Card>
  );
}
