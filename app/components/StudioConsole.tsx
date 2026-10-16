"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ToolPart } from "./derive";
import { AssistantMark, RetryIcon, XIcon } from "./icons";
import { EASE, fadeUp, pressable, stagger } from "./motion";
import { RichText } from "./RichText";
import { StepRow } from "./StepRow";

// The studio's view of the assistant: what it booked, how conversations
// convert, and every conversation step by step. Personal details arrive masked.

interface Overview {
  generatedAt: string;
  kpis: {
    liveBookings: number;
    revenue: string;
    discounted: number;
    utilisation: number;
    conversion: number | null;
    medianSecondsToBook: number | null;
    moves: number;
    cancellations: number;
  };
  funnel: Array<{ label: string; value: number }>;
  heatmap: Array<{ date: string; weekday: string; label: string; rooms: Record<"A" | "B", number> }>;
  bookings: Array<{
    id: string;
    ref: string;
    room: string;
    when: string;
    customer: string;
    email: string;
    total: string;
    status: "confirmed" | "moved" | "cancelled" | "replaced";
    conversationId: string | null;
  }>;
  conversations: Array<{
    id: string;
    startedAt: string;
    turns: number;
    outcome: "booked" | "quoted" | "browsing";
    firstMessage: string;
  }>;
}

type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; ok: boolean; data: Record<string, unknown> };

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  });

function duration(seconds: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

const STATUS_STYLE: Record<Overview["bookings"][number]["status"], [string, string]> = {
  confirmed: ["Confirmed", "bg-ok-soft text-ok"],
  moved: ["Moved", "bg-brand-soft text-brand-strong"],
  cancelled: ["Cancelled", "bg-danger-soft text-danger"],
  replaced: ["Replaced", "bg-hover text-fg-2"],
};

const OUTCOME_STYLE: Record<Overview["conversations"][number]["outcome"], [string, string]> = {
  booked: ["Booked", "bg-ok-soft text-ok"],
  quoted: ["Quoted", "bg-brand-soft text-brand-strong"],
  browsing: ["Browsing", "bg-hover text-fg-2"],
};

function Panel({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.section variants={fadeUp} className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <h2 className="font-serif text-lg font-semibold text-fg">{title}</h2>
        {aside}
      </div>
      <div className="px-4 pb-4 pt-3">{children}</div>
    </motion.section>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <motion.div variants={fadeUp} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="text-[13px] font-medium text-fg-2">{label}</div>
      <div className="num mt-1 font-serif text-[28px] font-semibold leading-tight text-fg">{value}</div>
      <div className="mt-0.5 text-xs text-fg-3">{note}</div>
    </motion.div>
  );
}

export function StudioConsole() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/studio", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
      setError(null);
    } catch {
      setError("Couldn't load the studio data. Try again in a moment.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch; state is set after the request
    void load();
  }, [load]);

  const funnelMax = Math.max(1, ...(data?.funnel.map((f) => f.value) ?? [1]));

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-canvas">
        <header className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-on-ink" aria-hidden>
                <AssistantMark className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-semibold leading-tight text-fg">Room Booking Assistant</h1>
                <p className="truncate text-[13px] text-fg-3">Eastern Essence Studio</p>
              </div>
            </div>
            <nav className="flex rounded-lg border border-line-strong p-0.5 text-[13px] font-medium" aria-label="View">
              <Link href="/" className="rounded-md px-3 py-1.5 text-fg-2 transition-colors hover:text-fg">
                Assistant
              </Link>
              <span className="rounded-md bg-ink px-3 py-1.5 text-on-ink" aria-current="page">
                Studio
              </span>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-[28px] font-semibold leading-tight text-fg">Studio overview</h2>
              <p className="mt-1 text-[13px] text-fg-2">
                What the assistant has booked and how conversations turn into bookings.
                {data ? ` Updated ${time(data.generatedAt)} AEDT.` : ""}
              </p>
            </div>
            <motion.button
              type="button"
              {...pressable}
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-hover"
            >
              <RetryIcon className="h-4 w-4" /> Refresh
            </motion.button>
          </div>

          <p className="mt-4 rounded-xl border border-line bg-inset px-4 py-2.5 text-[13px] text-fg-2">
            <span className="font-semibold text-fg">Demo view.</span> Names and emails are masked because this page is
            public. In production it would sit behind staff sign-in.
          </p>

          {error && <p className="mt-6 text-sm text-danger">{error}</p>}
          {!data && !error && <div className="mt-6 h-96 animate-pulse rounded-2xl bg-surface" aria-label="Loading" />}

          {data && (
            <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="mt-6 space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi
                  label="Booked by the assistant"
                  value={`${data.kpis.liveBookings}`}
                  note={`${data.kpis.revenue} · ${data.kpis.moves} moved · ${data.kpis.cancellations} cancelled`}
                />
                <Kpi label="Utilisation, next 7 days" value={`${data.kpis.utilisation}%`} note="Both rooms, 8am–10pm" />
                <Kpi
                  label="Conversion, last 7 days"
                  value={data.kpis.conversion == null ? "—" : `${data.kpis.conversion}%`}
                  note="Conversations that made a booking"
                />
                <Kpi label="Median time to book" value={duration(data.kpis.medianSecondsToBook)} note="From first message to confirmed" />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <Panel title="Bookings" aside={<span className="text-xs text-fg-3">Most recent first</span>}>
                  {data.bookings.length === 0 ? (
                    <p className="text-sm text-fg-2">No bookings from the assistant yet. Make one in the assistant and refresh.</p>
                  ) : (
                    <div className="-mx-4 overflow-x-auto">
                      <table className="w-full min-w-[560px] text-left text-[13px]">
                        <thead>
                          <tr className="border-b border-line text-xs text-fg-3">
                            {["Reference", "When", "Room", "Customer", "Total", "Status"].map((h) => (
                              <th key={h} className="px-4 pb-2 font-medium">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {data.bookings.map((b) => {
                            const [label, style] = STATUS_STYLE[b.status];
                            return (
                              <tr
                                key={b.id}
                                onClick={() => b.conversationId && setOpenId(b.conversationId)}
                                className={b.conversationId ? "cursor-pointer transition-colors hover:bg-inset" : ""}
                              >
                                <td className={`whitespace-nowrap px-4 py-2.5 font-mono font-semibold ${b.status === "replaced" || b.status === "cancelled" ? "text-fg-3 line-through" : "text-fg"}`}>
                                  {b.ref}
                                </td>
                                <td className="num px-4 py-2.5 text-fg">{b.when}</td>
                                <td className="whitespace-nowrap px-4 py-2.5 text-fg">{b.room}</td>
                                <td className="px-4 py-2.5">
                                  <div className="text-fg">{b.customer}</div>
                                  <div className="text-xs text-fg-3">{b.email}</div>
                                </td>
                                <td className="num whitespace-nowrap px-4 py-2.5 font-semibold text-fg">{b.total}</td>
                                <td className="px-4 py-2.5">
                                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>

                <div className="space-y-4">
                  <Panel title="Conversion" aside={<span className="text-xs text-fg-3">Last 7 days</span>}>
                    <ol className="space-y-2.5">
                      {data.funnel.map((step, i) => {
                        const prev = i > 0 ? data.funnel[i - 1].value : null;
                        return (
                          <li key={step.label}>
                            <div className="flex items-baseline justify-between text-[13px]">
                              <span className="text-fg">{step.label}</span>
                              <span className="num text-fg-2">
                                <span className="font-semibold text-fg">{step.value}</span>
                                {prev ? ` · ${Math.round((step.value / prev) * 100)}%` : ""}
                              </span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-hover">
                              <motion.div
                                className={`h-full rounded-full ${i === data.funnel.length - 1 ? "bg-ok" : "bg-ink"}`}
                                initial={{ width: 0 }}
                                animate={{ width: `${(step.value / funnelMax) * 100}%` }}
                                transition={{ duration: 0.6, delay: 0.1 + i * 0.08, ease: EASE }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </Panel>

                  <Panel title="Room utilisation" aside={<span className="text-xs text-fg-3">Next 7 days</span>}>
                    <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-1.5 text-[13px]">
                      <span />
                      <span className="text-center text-xs font-medium text-fg-2">Room A</span>
                      <span className="text-center text-xs font-medium text-fg-2">Room B</span>
                      {data.heatmap.map((d) => (
                        <div key={d.date} className="contents">
                          <span className="text-xs text-fg-2">
                            <span className="font-medium text-fg">{d.weekday}</span> {d.label}
                          </span>
                          {(["A", "B"] as const).map((r) => {
                            const pct = d.rooms[r];
                            return (
                              <span
                                key={r}
                                className={`num rounded-md py-1 text-center text-xs font-semibold ${pct >= 50 ? "text-on-ink" : "text-fg"}`}
                                style={{ background: `color-mix(in oklab, var(--ink) ${Math.max(pct, 4)}%, var(--hover))` }}
                                title={`Room ${r}, ${d.weekday} ${d.label}: ${pct}% booked`}
                              >
                                {pct}%
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </Panel>
                </div>
              </div>

              <Panel title="Conversations" aside={<span className="text-xs text-fg-3">Last 7 days · tap to read</span>}>
                {data.conversations.length === 0 ? (
                  <p className="text-sm text-fg-2">No conversations yet.</p>
                ) : (
                  <ul className="-mx-4 divide-y divide-line">
                    {data.conversations.map((c) => {
                      const [label, style] = OUTCOME_STYLE[c.outcome];
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setOpenId(c.id)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-inset"
                          >
                            <span className="num w-24 shrink-0 text-xs text-fg-3">{time(c.startedAt)}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{c.firstMessage || "—"}</span>
                            <span className="num hidden shrink-0 text-xs text-fg-3 sm:inline">
                              {c.turns} message{c.turns === 1 ? "" : "s"}
                            </span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </motion.div>
          )}
        </main>
        {openId && <Transcript id={openId} onClose={() => setOpenId(null)} />}
      </div>
    </MotionConfig>
  );
}

function Transcript({ id, onClose }: { id: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<TranscriptItem[] | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    let cancelled = false;
    fetch(`/api/studio/conversations/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setItems(body.items ?? []);
        setStartedAt(body.startedAt ?? null);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && close()}
      aria-label="Conversation"
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-xl bg-canvas p-0 text-fg shadow-card backdrop:bg-ink/45"
    >
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="flex h-full flex-col"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <div>
            <h2 className="font-serif text-lg font-semibold">Conversation</h2>
            {startedAt && <p className="text-[13px] text-fg-3">Started {time(startedAt)} AEDT</p>}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-hover hover:text-fg"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {!items && <div className="h-40 animate-pulse rounded-xl bg-surface" />}
          <AnimatePresence initial={false}>
            {items?.map((item, i) =>
              item.kind === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-hover px-3.5 py-2 text-sm text-fg">{item.text}</div>
                </div>
              ) : item.kind === "assistant" ? (
                <div key={i} className="text-sm leading-6 text-fg">
                  <RichText text={item.text} />
                </div>
              ) : (
                <StepRow
                  key={item.id}
                  part={
                    {
                      kind: "tool",
                      id: item.id,
                      name: item.name,
                      input: item.input,
                      at: 0,
                      result: { ok: item.ok, data: item.data, ms: 0 },
                    } satisfies ToolPart
                  }
                />
              ),
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </dialog>
  );
}
