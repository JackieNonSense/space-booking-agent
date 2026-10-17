"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent/events";
import { BookingTicket, ProgressStrip } from "./BookingTicket";
import {
  AvailabilityCard,
  BookingFoundCard,
  CancellationCard,
  CancelledCard,
  ConfirmedCard,
  DetailsCard,
  EmailCard,
  PriceCard,
  QuoteCard,
  UnavailableCard,
} from "./cards";
import {
  bookedIds,
  bookingProgress,
  detailsRequest,
  focusSlot,
  cancellationStates,
  quickReplies,
  quoteStates,
  toolParts,
  type ToolPart,
} from "./derive";
import { AlertIcon, ArrowUpIcon, AssistantMark, CalendarIcon, ChevronRightIcon, PlusIcon, RetryIcon, TagIcon } from "./icons";
import { EASE, defaultTransition, enter, fade, fadeUp, pressable, spring, stagger } from "./motion";
import { RichText } from "./RichText";
import { RoomsAtAGlance } from "./RoomsAtAGlance";
import { Schedule } from "./Schedule";
import { SlotPicker, type PickerRequest } from "./SlotPicker";
import { StepRow } from "./StepRow";
import type { ChatMessage, Part, Schedule as ScheduleData } from "./types";

const SUGGESTIONS = [
  { text: "A 3-hour workshop next Friday afternoon", icon: CalendarIcon },
  { text: "Room B tomorrow from 10am to 2pm", icon: CalendarIcon },
  { text: "What's free this weekend?", icon: CalendarIcon },
  { text: "How much is a 5-hour booking?", icon: TagIcon },
];

const uid = () => Math.random().toString(36).slice(2);

/** Today's date at the studio, "YYYY-MM-DD". */
const studioToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

/** Lets screen readers switch voices for replies written in Chinese. */
const langOf = (text: string) => (/[一-鿿]/.test(text) ? "zh" : undefined);

/** What the customer can safely assume after an error, without overclaiming either way. */
function errorOutcome(m: ChatMessage): string {
  const changed = m.parts.some(
    (p) => p.kind === "tool" && p.result?.ok && (p.name === "confirm_booking" || p.name === "confirm_cancellation"),
  );
  if (changed) return "The steps shown above did go through.";
  // The server finishes the turn even when the reply is cut off.
  if (m.dropped) return "If you had just confirmed something, it may still have gone through, and the email will say so.";
  return "Nothing was booked as a result.";
}

function Mark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-10 w-10 rounded-xl" : "h-7 w-7 rounded-lg";
  const icon = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span className={`grid shrink-0 place-items-center bg-ink text-on-ink ${box}`} aria-hidden>
      <AssistantMark className={icon} />
    </span>
  );
}

export function BookingApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [tab, setTab] = useState<"chat" | "booking">("chat");
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [thisWeek, setThisWeek] = useState<ScheduleData | null>(null);
  const [week, setWeek] = useState(0);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ---- schedule -----------------------------------------------------------
  // The side panel can page through weeks; the room cards on the welcome
  // screen always show this week, so they keep their own copy.
  const loadSchedule = useCallback(async (w: number) => {
    try {
      const res = await fetch(`/api/schedule?week=${w}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ScheduleData;
      setSchedule(data);
      if (w === 0) setThisWeek(data);
    } catch {
      // The schedule is a nice-to-have; the chat works without it.
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
  const quoteActive = [...quotes.values()].includes("active");
  const cancellations = useMemo(() => cancellationStates(parts), [parts]);
  const cancelActive = [...cancellations.values()].includes("active");

  // Jump the schedule to the week the conversation is about.
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

  // ---- scrolling ------------------------------------------------------------
  // Follow the conversation while the reader is at the bottom: whenever the
  // content grows (streamed words, cards opening) jump straight to the end,
  // at most once a frame. Scrolling up stops the following; sending a message
  // brings the reader back with one smooth scroll. Scrolling smoothly on every
  // streamed chunk made the scrolls fight each other.
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const smoothUntil = useRef(0);
  const hasMessages = messages.length > 0;
  const hasMessagesRef = useRef(hasMessages);
  useEffect(() => {
    hasMessagesRef.current = hasMessages;
  }, [hasMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    const content = logRef.current;
    if (!el || !content) return;
    const follow = new ResizeObserver(() => {
      // The welcome screen starts at the top; only follow a conversation.
      if (!hasMessagesRef.current || !pinned.current || Date.now() < smoothUntil.current) return;
      el.scrollTop = el.scrollHeight;
    });
    follow.observe(content);
    return () => follow.disconnect();
  }, []);

  const userTurns = messages.filter((m) => m.role === "user").length;
  useEffect(() => {
    const el = scrollRef.current;
    if (!userTurns || !el) return;
    pinned.current = true;
    smoothUntil.current = Date.now() + 600;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [userTurns, reduceMotion]);

  // Only a move upward means the reader is looking back. A long smooth scroll
  // passes through positions far from the bottom on its way down, and those
  // must not switch the following off.
  const lastTop = useRef(0);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (el.scrollTop < lastTop.current - 1) pinned.current = distance < 80;
    else if (distance < 80) pinned.current = true;
    lastTop.current = el.scrollTop;
  };

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
          parts: [...m.parts, { kind: "tool", id: event.id, name: event.name, input: event.input, at: Date.now() }],
        }));
        break;
      case "tool_result":
        updateAssistant((m) => {
          const result = { ok: event.ok, data: event.data, ms: event.ms };
          const found = m.parts.some((p) => p.kind === "tool" && p.id === event.id);
          const ps: Part[] = found
            ? m.parts.map((p) => (p.kind === "tool" && p.id === event.id ? { ...p, result } : p))
            : [
                ...m.parts,
                { kind: "tool", id: event.id, name: event.name, input: null, automatic: event.automatic, at: Date.now(), result },
              ];
          return { ...m, parts: ps };
        });
        if (event.ok && (event.name === "confirm_booking" || event.name === "confirm_cancellation")) void loadSchedule(week);
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
        updateAssistant((m) => ({ ...m, error: body.error ?? "The assistant couldn't answer just now." }));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as AgentEvent;
          if (event.type === "done") finished = true;
          handleEvent(event);
        }
      }
      // A stream that ends without "done" was cut off (e.g. a platform timeout).
      if (!finished) throw new Error("stream ended early");
    } catch {
      updateAssistant((m) => ({ ...m, error: "The connection dropped before the reply finished.", dropped: true }));
    } finally {
      setBusy(false);
      void loadSchedule(week);
      inputRef.current?.focus();
    }
  };

  const lastUserText = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const p = messages[i].parts[0];
      if (messages[i].role === "user" && p?.kind === "text") return p.text;
    }
    return "";
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
    let card: React.ReactNode = null;
    if (p.result) {
      const { ok, data } = p.result;
      if (ok && p.name === "check_availability")
        card = (
          <AvailabilityCard
            data={data}
            onPick={pick}
            onPickTime={() =>
              setPicker({ date: String(data.date), room: (p.input as { room?: "A" | "B" | null } | null)?.room ?? undefined })
            }
            onPickSlot={(room, start) => setPicker({ date: String(data.date), room, start })}
            disabled={busy || !isLive}
          />
        );
      else if (ok && p.name === "calculate_price") card = <PriceCard data={data} />;
      else if (ok && p.name === "create_booking_draft")
        card = (
          <QuoteCard
            data={data}
            state={quotes.get(p.id) ?? "superseded"}
            onConfirm={() => void send(data.replaces ? "Yes, please move my booking." : "Yes, please confirm the booking.")}
            onChange={startChange}
            disabled={busy}
          />
        );
      else if (ok && p.name === "confirm_booking") card = <ConfirmedCard data={data} />;
      else if (ok && p.name === "find_booking") card = <BookingFoundCard data={data} />;
      else if (ok && p.name === "request_cancellation")
        card = (
          <CancellationCard
            data={data}
            state={cancellations.get(p.id) ?? "superseded"}
            onConfirm={() => void send("Yes, please cancel it.")}
            onKeep={() => void send("No, keep my booking.")}
            disabled={busy}
          />
        );
      else if (ok && p.name === "confirm_cancellation") card = <CancelledCard data={data} />;
      else if (p.name === "send_confirmation_email") {
        const bookingId = (data.bookingId as string | undefined) ?? (p.input as { booking_id?: string } | null)?.booking_id;
        card = <EmailCard data={data} automatic={p.automatic} bookingId={bookingId} />;
      } else if (!ok && data.error_code === "ROOM_UNAVAILABLE")
        card = (
          <UnavailableCard
            data={data}
            onPick={pick}
            onPickTime={() => {
              const alt = (data.alternatives as Array<{ date: string }> | undefined)?.[0];
              setPicker({ date: alt?.date ?? focus?.date ?? studioToday() });
            }}
            disabled={busy || !isLive}
          />
        );
    }
    return (
      <div key={p.id} className="space-y-2">
        <StepRow part={p} />
        {card}
      </div>
    );
  };

  const last = messages[messages.length - 1];
  const lastPart = last?.parts[last.parts.length - 1];
  const showTyping = busy && last?.role === "assistant" && (!lastPart || (lastPart.kind === "tool" && !!lastPart.result));
  const details = busy ? null : detailsRequest(messages);
  const replies =
    !busy && last?.role === "assistant" && !last.error && !details ? quickReplies(progress, quoteActive, cancelActive) : [];
  // Sent as an ordinary message in the customer's language, so the assistant reads it like typed text.
  const sendDetails = (name: string, email: string) =>
    void send(
      langOf(lastUserText()) === "zh" ? `我叫${name}，邮箱是 ${email}。` : `My name is ${name} and my email is ${email}.`,
    );

  return (
    <MotionConfig reducedMotion="user" transition={defaultTransition}>
      <div className="flex h-dvh flex-col">
        <header className="relative z-10 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Mark size="lg" />
              {/* Too narrow on phones to show without truncating; screen readers still get it. */}
              <div className="min-w-0 max-sm:sr-only">
                <h1 className="truncate text-[15px] font-semibold leading-tight text-fg">Room Booking Assistant</h1>
                <p className="truncate text-[13px] text-fg-3">Eastern Essence Studio</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <nav className="flex rounded-lg border border-line-strong p-0.5 text-[13px] font-medium" aria-label="View">
                <span className="flex items-center gap-1.5 rounded-md bg-ink px-2.5 py-1 text-on-ink sm:px-3" aria-current="page">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
                  Assistant
                </span>
                <Link href="/studio" className="rounded-md px-2.5 py-1 text-fg-2 transition-colors hover:text-fg sm:px-3">
                  Studio
                </Link>
              </nav>
              <motion.button
                type="button"
                {...pressable}
                onClick={newChat}
                aria-label="New chat"
                disabled={busy || messages.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-hover disabled:opacity-40"
              >
                <PlusIcon className="h-4 w-4" />
                <span className="hidden sm:inline">New chat</span>
              </motion.button>
            </div>
          </div>
        </header>

        {/* Mobile tabs */}
        <div className="border-b border-line bg-surface px-4 lg:hidden">
          <div className="mx-auto flex max-w-6xl gap-5" role="group" aria-label="View">
            {(
              [
                ["chat", "Chat"],
                ["booking", "Booking & schedule"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
                className={`relative py-2.5 text-sm font-medium transition-colors ${tab === t ? "text-fg" : "text-fg-3"}`}
              >
                {label}
                {tab === t && <motion.span layoutId="tab-underline" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink" />}
              </button>
            ))}
          </div>
        </div>
        {tab === "chat" && <ProgressStrip progress={progress} onOpen={() => setTab("booking")} />}

        <main className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_392px]">
          {/* Chat */}
          <section className={`min-h-0 flex-col ${tab === "chat" ? "flex" : "hidden"} lg:flex`} aria-label="Chat">
            <div ref={scrollRef} onScroll={onScroll} className="scroll-fade flex-1 overflow-y-auto py-6">
              <div ref={logRef} className="mx-auto max-w-2xl space-y-6" role="log" aria-live="polite" aria-label="Conversation">
                <AnimatePresence initial={false}>
                  {messages.length === 0 && (
                    <motion.div
                      key="welcome"
                      variants={stagger(0.06)}
                      initial="hidden"
                      animate="show"
                      exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                      className="pt-2 sm:pt-8"
                    >
                      <motion.h2
                        variants={fadeUp}
                        className="font-serif text-[30px] font-semibold leading-tight tracking-tight text-fg sm:text-[36px]"
                      >
                        What are you planning?
                      </motion.h2>
                      <motion.p variants={fadeUp} className="mt-3 max-w-xl text-[15px] leading-relaxed text-fg-2">
                        Tell me the day and time you need a room. I&apos;ll check Room A and Room B, give you an exact
                        price, and email your confirmation once you accept it.
                      </motion.p>

                      {thisWeek && (
                        <motion.div variants={fadeUp}>
                          <RoomsAtAGlance schedule={thisWeek} onPick={setPicker} />
                        </motion.div>
                      )}

                      <motion.div variants={fadeUp} className="mt-7 text-[13px] font-semibold text-fg">
                        Or just ask
                      </motion.div>
                      <motion.div variants={stagger(0.05, 0.2)} className="mt-2 grid gap-2 sm:grid-cols-2">
                        {SUGGESTIONS.map(({ text, icon: Icon }) => (
                          <motion.button
                            key={text}
                            type="button"
                            variants={fadeUp}
                            {...pressable}
                            onClick={() => void send(text)}
                            className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left text-sm text-fg shadow-card transition-colors hover:border-line-strong"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-fg-3" />
                            <span className="flex-1">{text}</span>
                            <ChevronRightIcon className="h-4 w-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5" />
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
                      // Rises from the composer it was typed in.
                      initial={{ opacity: 0, y: 12, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ y: spring.smooth, scale: spring.smooth, opacity: { duration: 0.2, ease: EASE } }}
                      style={{ originX: 1, originY: 1 }}
                      className="flex justify-end"
                    >
                      <div
                        lang={langOf((m.parts[0] as { text: string }).text)}
                        className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-hover px-4 py-2.5 text-[15px] leading-relaxed text-fg [overflow-wrap:anywhere]"
                      >
                        {(m.parts[0] as { text: string }).text}
                      </div>
                    </motion.div>
                  ) : (
                    <div key={m.id} className="flex gap-3">
                      <div className="hidden pt-0.5 sm:block">{m.parts.length > 0 || m.error ? <Mark /> : <span className="block w-7" />}</div>
                      <div className="min-w-0 flex-1 space-y-3">
                        {m.parts.map((p, pi) =>
                          p.kind === "text" ? (
                            p.text.trim() && (
                              <motion.div key={pi} lang={langOf(p.text)} variants={fadeUp} initial="hidden" animate="show" className="text-[15px] leading-7 text-fg [overflow-wrap:anywhere]">
                                <RichText
                                  text={p.text}
                                  trailing={
                                    busy && mi === messages.length - 1 && pi === m.parts.length - 1 ? (
                                      <span className="caret ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 rounded-full bg-fg" aria-hidden />
                                    ) : null
                                  }
                                />
                              </motion.div>
                            )
                          ) : (
                            renderTool(p, mi === messages.length - 1)
                          ),
                        )}
                        {m.error && (
                          <motion.div
                            variants={fadeUp}
                            initial="hidden"
                            animate="show"
                            className="flex items-start gap-3 rounded-xl border border-danger-border bg-danger-soft px-4 py-3"
                            role="alert"
                          >
                            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                            <div className="min-w-0 flex-1 text-sm">
                              <div className="font-semibold text-danger">That didn&apos;t go through</div>
                              <div className="mt-0.5 text-fg-2">
                                {m.error} {errorOutcome(m)}
                              </div>
                            </div>
                            {mi === messages.length - 1 && (
                              <motion.button
                                type="button"
                                {...pressable}
                                disabled={busy}
                                onClick={() => void send(lastUserText())}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-danger-border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-danger"
                              >
                                <RetryIcon className="h-3.5 w-3.5" /> Try again
                              </motion.button>
                            )}
                          </motion.div>
                        )}
                        {mi === messages.length - 1 && details && (
                          <DetailsCard
                            key={m.id}
                            initial={details}
                            retry={details.retry}
                            disabled={busy}
                            onSubmit={sendDetails}
                          />
                        )}
                        {mi === messages.length - 1 && replies.length > 0 && (
                          <motion.div className="flex flex-wrap gap-2 pt-1" variants={stagger(0.03, 0.1)} initial="hidden" animate="show">
                            {replies.map((r) => (
                              <motion.button
                                key={r}
                                type="button"
                                variants={fade}
                                {...pressable}
                                onClick={() => {
                                  // Replies that need details start a sentence for the customer to finish.
                                  const prefill: Record<string, string> = {
                                    "Change the time": "Change the time to ",
                                    "Change my email": "Change my email to ",
                                    "Choose a different time": "Make it ",
                                    "Move this booking": "Move this booking to ",
                                  };
                                  if (prefill[r]) {
                                    setInput(prefill[r]);
                                    inputRef.current?.focus();
                                  } else void send(r);
                                }}
                                className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
                              >
                                {r}
                              </motion.button>
                            ))}
                          </motion.div>
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
                      exit={{ opacity: 0, transition: { duration: 0.12 } }}
                      transition={enter}
                      className="flex items-center gap-3"
                      aria-label="Assistant is typing"
                    >
                      <div className="hidden sm:block">{last?.parts.length === 0 ? <Mark /> : <span className="block w-7" />}</div>
                      <div className="flex gap-1 py-2">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-fg" />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <form
              className="pb-3 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-control bg-surface p-2 shadow-card transition-[border-color,box-shadow] focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgb(26_23_20/0.08)]">
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
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-6 text-fg outline-none placeholder:text-fg-3 focus-visible:outline-none"
                />
                <motion.button
                  type="submit"
                  {...pressable}
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  // Concentric with the composer: 16px outer radius minus 8px padding.
                  className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-ink text-on-ink transition-colors hover:bg-ink-hover disabled:cursor-not-allowed disabled:bg-hover disabled:text-fg-3"
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={busy ? "busy" : "idle"}
                      className="grid place-items-center"
                      initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                      transition={spring.smooth}
                      aria-hidden
                    >
                      {busy ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-fg-3/30 border-t-fg-3 motion-reduce:animate-none" />
                      ) : (
                        <ArrowUpIcon className="h-5 w-5" />
                      )}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              </div>
              <p className="mx-auto mt-2 max-w-2xl px-1 text-xs leading-relaxed text-fg-3">
                AI prototype for a technical assessment. Prices and availability come from the booking system, and
                the rooms carry some sample bookings.
              </p>
            </form>
          </section>

          {/* Booking, schedule and pricing */}
          <aside
            className={`min-h-0 space-y-4 overflow-y-auto py-6 ${tab === "booking" ? "block" : "hidden"} lg:block`}
            aria-label="Booking and schedule"
          >
            <BookingTicket progress={progress} steps={parts} />
            <Schedule
              schedule={schedule}
              week={week}
              onWeekChange={setWeek}
              focus={focus}
              highlightIds={highlightIds}
              onPick={setPicker}
            />
            <PricingPanel />
          </aside>
        </main>
      </div>
      {picker && (
        <SlotPicker
          key={`${picker.date}-${picker.room}-${picker.start}`}
          request={picker}
          today={schedule?.today ?? studioToday()}
          disabled={busy}
          onClose={() => setPicker(null)}
          onSubmit={(text) => void send(text)}
        />
      )}
    </MotionConfig>
  );
}

function PricingPanel() {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card" aria-labelledby="pricing-heading">
      <h2 id="pricing-heading" className="font-serif text-xl font-semibold text-fg">
        Pricing
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line p-3">
          <div className="text-[13px] font-medium text-fg-2">Under 4 hours</div>
          <div className="num mt-1 font-serif text-2xl font-semibold text-fg">
            $100<span className="font-sans text-sm font-medium text-fg-2">/hour</span>
          </div>
        </div>
        <div className="rounded-xl border border-ok-border bg-ok-soft p-3">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[13px] font-medium text-ok">4 hours or more</span>
            <span className="rounded-full bg-ok px-1.5 py-0.5 text-xs font-semibold leading-none text-on-ink">−15%</span>
          </div>
          <div className="num mt-1 font-serif text-2xl font-semibold text-fg">
            $85<span className="font-sans text-sm font-medium text-fg-2">/hour</span>
          </div>
        </div>
      </div>
      <dl className="num mt-3 grid grid-cols-3 gap-2 text-center text-[13px]">
        {[
          ["3 hours", "$300"],
          ["4 hours", "$340"],
          ["5 hours", "$425"],
        ].map(([h, p]) => (
          <div key={h} className="rounded-lg bg-inset py-2">
            <dt className="text-fg-3">{h}</dt>
            <dd className="font-semibold text-fg">{p}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-fg-2">
        Open 8am–10pm daily, in 30-minute steps with a 1-hour minimum. Prices are calculated by the booking system, not
        the AI, so a quote is always exact.
      </p>
    </section>
  );
}
