"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent/events";
import { BookingTicket, ProgressStrip } from "./BookingTicket";
import {
  AvailabilityCard,
  ConfirmedCard,
  EmailCard,
  PriceCard,
  QuoteCard,
  UnavailableCard,
} from "./cards";
import { bookedIds, bookingProgress, focusSlot, quoteStates, toolParts, type ToolPart } from "./derive";
import { ArrowUpIcon, AssistantMark, CalendarIcon, MailIcon, PlusIcon, TagIcon } from "./icons";
import { EASE, fadeUp, pressable, stagger } from "./motion";
import { RichText } from "./RichText";
import type { ChatMessage, Part, Schedule } from "./types";
import { WeekTimeline } from "./WeekTimeline";

const SUGGESTIONS = [
  "Is Room A free this Friday from 2pm to 6pm?",
  "What's available tomorrow afternoon?",
  "How much is a 5-hour booking?",
  "Book Room B on Sunday 10am to 1:30pm",
];

const TOOL_STATUS: Record<string, string> = {
  check_availability: "Checking availability",
  calculate_price: "Calculating the price",
  create_booking_draft: "Preparing your quote",
  confirm_booking: "Booking the room",
  send_confirmation_email: "Sending the confirmation email",
};

const uid = () => Math.random().toString(36).slice(2);

function Avatar() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-white shadow-sm" aria-hidden>
      <AssistantMark className="h-4 w-4" />
    </span>
  );
}

export function BookingApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [trace, setTrace] = useState(false);
  const [tab, setTab] = useState<"chat" | "booking">("chat");
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [week, setWeek] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---- schedule -----------------------------------------------------------
  const loadSchedule = useCallback(async (w: number) => {
    try {
      const res = await fetch(`/api/schedule?week=${w}`, { cache: "no-store" });
      if (res.ok) setSchedule(await res.json());
    } catch {
      // The timeline is a nice-to-have; the chat works without it.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on week change; state is set after the request
    void loadSchedule(week);
  }, [week, loadSchedule]);

  // ---- state derived from tool results ------------------------------------
  const parts = useMemo(() => toolParts(messages), [messages]);
  const progress = useMemo(() => bookingProgress(parts), [parts]);
  const focus = useMemo(() => focusSlot(parts), [parts]);
  const highlightIds = useMemo(() => bookedIds(parts), [parts]);
  const quotes = useMemo(() => quoteStates(parts), [parts]);

  // Jump the timeline to the week the conversation is about.
  useEffect(() => {
    if (!focus?.date || !schedule) return;
    const days = Math.round(
      (Date.parse(`${focus.date}T00:00:00Z`) - Date.parse(`${schedule.today}T00:00:00Z`)) / 86_400_000,
    );
    const target = Math.min(Math.max(Math.floor(days / 7), 0), 25);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the conversation
    if (target !== week) setWeek(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the focus date changes
  }, [focus?.date]);

  useEffect(() => {
    // The welcome screen starts at the top; only follow the conversation once it exists.
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  // Grow the composer with its content.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // ---- streaming ----------------------------------------------------------
  const updateAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((all) => {
      const copy = [...all];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });

  const handleEvent = (event: AgentEvent) => {
    switch (event.type) {
      case "conversation":
        setConversationId(event.id);
        break;
      case "text":
        updateAssistant((m) => {
          const ps = [...m.parts];
          const last = ps[ps.length - 1];
          if (last?.kind === "text") ps[ps.length - 1] = { ...last, text: last.text + event.delta };
          else ps.push({ kind: "text", text: event.delta });
          return { ...m, parts: ps };
        });
        break;
      case "tool_call":
        updateAssistant((m) => ({
          ...m,
          parts: [...m.parts, { kind: "tool", id: event.id, name: event.name, input: event.input }],
        }));
        break;
      case "tool_result":
        updateAssistant((m) => {
          const result = { ok: event.ok, data: event.data, ms: event.ms };
          const found = m.parts.some((p) => p.kind === "tool" && p.id === event.id);
          const ps: Part[] = found
            ? m.parts.map((p) => (p.kind === "tool" && p.id === event.id ? { ...p, result } : p))
            : [...m.parts, { kind: "tool", id: event.id, name: event.name, input: null, automatic: event.automatic, result }];
          return { ...m, parts: ps };
        });
        if (event.ok && event.name === "confirm_booking") void loadSchedule(week);
        break;
      case "error":
        updateAssistant((m) => ({ ...m, error: event.message }));
        break;
      case "done":
        if (event.usage) updateAssistant((m) => ({ ...m, usage: event.usage }));
        break;
    }
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    setTab("chat");
    setBusy(true);
    setMessages((all) => [
      ...all,
      { id: uid(), role: "user", parts: [{ kind: "text", text }] },
      { id: uid(), role: "assistant", parts: [] },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        updateAssistant((m) => ({ ...m, error: body.error ?? "Something went wrong. Please try again." }));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handleEvent(JSON.parse(line) as AgentEvent);
        }
      }
    } catch {
      updateAssistant((m) => ({ ...m, error: "The connection dropped. Please send your message again." }));
    } finally {
      setBusy(false);
      void loadSchedule(week);
      inputRef.current?.focus();
    }
  };

  const newChat = () => {
    if (busy) return;
    setMessages([]);
    setConversationId(null);
    setInput("");
    inputRef.current?.focus();
  };

  const startChange = () => {
    setInput("I'd like to change ");
    inputRef.current?.focus();
  };

  // ---- rendering ----------------------------------------------------------
  const renderTool = (p: ToolPart, isLive: boolean) => {
    const pick = (t: string) => void send(t);
    if (!p.result) {
      return (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 py-1 text-sm"
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/50 motion-reduce:animate-none" />
            <span className="relative h-2 w-2 rounded-full bg-accent" />
          </span>
          <span className="shimmer-text">{TOOL_STATUS[p.name] ?? "Working"}…</span>
        </motion.div>
      );
    }
    const { ok, data } = p.result;
    let card: React.ReactNode = null;
    if (ok && p.name === "check_availability") card = <AvailabilityCard data={data} onPick={pick} disabled={busy || !isLive} />;
    else if (ok && p.name === "calculate_price") card = <PriceCard data={data} />;
    else if (ok && p.name === "create_booking_draft")
      card = (
        <QuoteCard
          data={data}
          state={quotes.get(p.id) ?? "superseded"}
          onConfirm={() => void send("Yes, please confirm the booking.")}
          onChange={startChange}
          disabled={busy}
        />
      );
    else if (ok && p.name === "confirm_booking") card = <ConfirmedCard data={data} />;
    else if (p.name === "send_confirmation_email") {
      const bookingId = (p.input as { booking_id?: string } | null)?.booking_id ?? p.id.replace(/^auto_/, "");
      card = <EmailCard data={data} automatic={p.automatic} bookingId={bookingId} />;
    } else if (!ok && data.error_code === "ROOM_UNAVAILABLE")
      card = <UnavailableCard data={data} onPick={pick} disabled={busy || !isLive} />;

    return (
      <div key={p.id} className="space-y-1.5">
        {card}
        <AnimatePresence initial={false}>
          {trace && (
            <motion.details
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="overflow-hidden rounded-xl border border-dashed border-line bg-surface/60 px-3 py-2 text-xs text-muted"
            >
              <summary className="cursor-pointer select-none font-mono">
                <span className={ok ? "text-ok" : "text-danger"}>{ok ? "✓" : "✗"}</span> {p.name}
                {p.automatic ? " (automatic)" : ""} · {p.result.ms} ms
              </summary>
              <div className="mt-2 grid gap-2">
                {p.input != null && (
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-paper p-2 font-mono text-[11px] text-ink">
                    {JSON.stringify(p.input, null, 2)}
                  </pre>
                )}
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-paper p-2 font-mono text-[11px] text-ink">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </div>
            </motion.details>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const last = messages[messages.length - 1];
  const lastPart = last?.parts[last.parts.length - 1];
  const showTyping =
    busy && last?.role === "assistant" && (!lastPart || (lastPart.kind === "tool" && !!lastPart.result));

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh flex-col">
        <header className="relative z-10 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink text-paper" aria-hidden>
                <AssistantMark className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                  Eastern Essence Studio
                </div>
                <h1 className="truncate font-serif text-lg font-semibold leading-tight text-ink sm:text-xl">
                  <span className="hidden sm:inline">Room </span>Booking Assistant
                </h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={trace}
                onClick={() => setTrace((t) => !t)}
                className="flex items-center gap-2 text-xs text-muted"
                title="Show every tool call the agent makes"
              >
                <span className={`relative h-5 w-9 rounded-full transition-colors ${trace ? "bg-accent" : "bg-line"}`}>
                  <motion.span
                    className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow"
                    animate={{ left: trace ? 18 : 2 }}
                    transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  />
                </span>
                <span className="hidden sm:inline">Agent trace</span>
                <span className="sm:hidden">Trace</span>
              </button>
              <motion.button
                type="button"
                {...pressable}
                onClick={newChat}
                aria-label="New chat"
                disabled={busy || messages.length === 0}
                className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-ink transition-colors hover:bg-accent-soft disabled:opacity-40"
              >
                <PlusIcon className="h-4 w-4" />
                <span className="hidden sm:inline">New chat</span>
              </motion.button>
            </div>
          </div>
        </header>

        {/* Mobile tabs */}
        <div className="border-b border-line bg-surface px-4 lg:hidden">
          <div className="mx-auto flex max-w-6xl gap-5" role="tablist">
            {(
              [
                ["chat", "Chat"],
                ["booking", "Booking & schedule"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`relative py-2.5 text-sm font-medium transition-colors ${tab === t ? "text-ink" : "text-muted"}`}
              >
                {label}
                {tab === t && (
                  <motion.span layoutId="tab-underline" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />
                )}
              </button>
            ))}
          </div>
        </div>
        {tab === "chat" && <ProgressStrip progress={progress} onOpen={() => setTab("booking")} />}

        <main className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Chat */}
          <section className={`min-h-0 flex-col ${tab === "chat" ? "flex" : "hidden"} lg:flex`} aria-label="Chat">
            <div className="flex-1 overflow-y-auto py-6">
              <div className="mx-auto max-w-2xl space-y-5">
                <AnimatePresence initial={false}>
                  {messages.length === 0 && (
                    <motion.div
                      key="welcome"
                      variants={stagger(0.07)}
                      initial="hidden"
                      animate="show"
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                      className="pt-2 sm:pt-8"
                    >
                      <motion.div variants={fadeUp}>
                        <Avatar />
                      </motion.div>
                      <motion.h2
                        variants={fadeUp}
                        className="mt-4 font-serif text-2xl font-semibold leading-snug text-ink sm:text-[28px]"
                      >
                        Book Room A or Room B in a couple of messages.
                      </motion.h2>
                      <motion.p variants={fadeUp} className="mt-2 max-w-lg text-[15px] leading-relaxed text-muted">
                        Tell me when you need a space. I&apos;ll check both rooms, give you an exact price and email
                        your confirmation once you&apos;re happy with it.
                      </motion.p>

                      <motion.ol variants={fadeUp} className="mt-6 grid grid-cols-3 gap-2">
                        {[
                          { icon: <CalendarIcon className="h-4 w-4" />, title: "Pick a time", body: "Any day, 8am – 10pm" },
                          { icon: <TagIcon className="h-4 w-4" />, title: "Get a quote", body: "15% off for 4+ hours" },
                          { icon: <MailIcon className="h-4 w-4" />, title: "Confirm", body: "Confirmation by email" },
                        ].map((s, i) => (
                          <li
                            key={s.title}
                            className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 sm:flex-row sm:items-start sm:gap-3"
                          >
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                              {s.icon}
                            </span>
                            <div>
                              <div className="text-sm font-medium leading-snug text-ink">
                                <span className="text-faint">{i + 1}.</span> {s.title}
                              </div>
                              <div className="hidden text-xs text-muted sm:block">{s.body}</div>
                            </div>
                          </li>
                        ))}
                      </motion.ol>

                      <motion.div variants={fadeUp} className="mt-6 text-xs font-medium uppercase tracking-[0.12em] text-faint">
                        Try asking
                      </motion.div>
                      <motion.div variants={stagger(0.05, 0.25)} className="mt-2 flex flex-wrap gap-2">
                        {SUGGESTIONS.map((s) => (
                          <motion.button
                            key={s}
                            type="button"
                            variants={fadeUp}
                            {...pressable}
                            onClick={() => void send(s)}
                            className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-ink shadow-sm transition-colors hover:border-accent/50 hover:bg-accent-soft"
                          >
                            {s}
                          </motion.button>
                        ))}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {messages.map((m, mi) =>
                  m.role === "user" ? (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.28, ease: EASE }}
                      className="flex justify-end"
                    >
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] text-white shadow-sm">
                        {(m.parts[0] as { text: string }).text}
                      </div>
                    </motion.div>
                  ) : (
                    <div key={m.id} className="flex gap-3">
                      <div className="hidden pt-0.5 sm:block">{m.parts.length > 0 || m.error ? <Avatar /> : null}</div>
                      <div className="min-w-0 flex-1 space-y-2.5">
                        {m.parts.map((p, pi) =>
                          p.kind === "text" ? (
                            p.text.trim() && (
                              <motion.div
                                key={pi}
                                variants={fadeUp}
                                initial="hidden"
                                animate="show"
                                className="max-w-[92%] rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-[15px] text-ink shadow-[0_1px_2px_rgba(43,38,34,0.04)]"
                              >
                                <RichText text={p.text} />
                                {busy && mi === messages.length - 1 && pi === m.parts.length - 1 && (
                                  <span className="caret ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-accent" aria-hidden />
                                )}
                              </motion.div>
                            )
                          ) : (
                            <div key={p.id} className="max-w-[96%]">
                              {renderTool(p, mi === messages.length - 1)}
                            </div>
                          ),
                        )}
                        {m.error && (
                          <motion.div
                            variants={fadeUp}
                            initial="hidden"
                            animate="show"
                            className="max-w-[92%] rounded-2xl border border-danger/25 bg-danger-soft px-4 py-2.5 text-sm text-danger"
                          >
                            {m.error}
                          </motion.div>
                        )}
                        {trace && m.usage && (
                          <div className="font-mono text-[11px] text-faint">
                            {m.usage.steps} model call{m.usage.steps === 1 ? "" : "s"} ·{" "}
                            {((m.usage.inputTokens + m.usage.cachedTokens) / 1000).toFixed(1)}k in (
                            {(m.usage.cachedTokens / 1000).toFixed(1)}k cached) · {m.usage.outputTokens} out
                          </div>
                        )}
                      </div>
                    </div>
                  ),
                )}

                <AnimatePresence>
                  {showTyping && (
                    <motion.div
                      key="typing"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-3"
                      aria-label="Assistant is typing"
                    >
                      <div className="hidden sm:block">{last?.parts.length === 0 ? <Avatar /> : <span className="block w-8" />}</div>
                      <div className="flex gap-1 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3.5">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div ref={bottomRef} />
              </div>
            </div>

            <form
              className="bg-linear-to-t from-paper via-paper to-paper/0 pb-3 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-[0_8px_24px_-12px_rgba(43,38,34,0.18)] transition-colors focus-within:border-accent/60">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder="e.g. Room A, Tuesday 1–5pm"
                  aria-label="Message"
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-ink outline-none placeholder:text-faint"
                />
                <motion.button
                  type="submit"
                  {...pressable}
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-white shadow-sm transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
                >
                  <ArrowUpIcon className="h-5 w-5" />
                </motion.button>
              </div>
              <p className="mx-auto mt-2 max-w-2xl px-1 text-[11px] leading-relaxed text-faint">
                AI prototype for a technical assessment. Prices and availability come from the booking system; the
                schedule includes sample bookings.
              </p>
            </form>
          </section>

          {/* Booking, schedule and pricing */}
          <aside
            className={`min-h-0 space-y-4 overflow-y-auto py-6 ${tab === "booking" ? "block" : "hidden"} lg:block`}
            aria-label="Booking and schedule"
          >
            <BookingTicket progress={progress} />
            <WeekTimeline schedule={schedule} week={week} onWeekChange={setWeek} focus={focus} highlightIds={highlightIds} />
            <section className="rounded-2xl border border-line bg-surface p-4 text-sm">
              <h2 className="font-serif text-lg font-semibold text-ink">Pricing</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-paper p-3">
                  <div className="text-xs text-muted">Under 4 hours</div>
                  <div className="mt-0.5 font-serif text-lg font-semibold text-ink">$100/hr</div>
                </div>
                <div className="rounded-xl bg-ok-soft p-3">
                  <div className="text-xs text-ok">4 hours or more</div>
                  <div className="mt-0.5 font-serif text-lg font-semibold text-ok">15% off</div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Open 8am – 10pm daily, in 30-minute steps with a 1-hour minimum. Every price is calculated by the
                booking system, not the AI, so quotes are always exact.
              </p>
            </section>
          </aside>
        </main>
      </div>
    </MotionConfig>
  );
}
