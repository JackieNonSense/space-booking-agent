import type { DateTime } from "luxon";
import { toStudioTime } from "./bookings";
import { CLOSE_MINUTE, OPEN_MINUTE, ROOM_IDS, ROOMS, type RoomId } from "./config";
import type { Db } from "./db";
import { formatMoney } from "./pricing";
import { clockLabel } from "./time";

// The studio's side of the demo: what the assistant booked, how conversations
// convert, and what each conversation looked like. Everything personal is
// masked because the demo page is public.

// ---------------------------------------------------------------------------
// Masking

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export const maskEmail = (email: string) => email.replace(EMAIL, "$1***@$2");

export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

const REF = /\bEE-([A-Z0-9]{2})[A-Z0-9]{4}\b/g;

/**
 * "EE-7K3Q9M" becomes "EE-7K••••": enough to tell bookings apart, not enough
 * to look one up (the assistant also needs the full email for that).
 */
export const maskRef = (text: string) => text.replace(REF, "EE-$1••••");

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Masks emails, booking references and the given customer names inside free text. */
export function maskText(text: string, names: string[] = []): string {
  let out = maskRef(maskEmail(text));
  for (const name of names) {
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const full = parts.map(escapeRegExp).join("\\s+");
    out = out.replace(new RegExp(full, "giu"), maskName(name));
    // The surname on its own too, e.g. "Ms Citizen".
    const surname = parts[parts.length - 1];
    if (surname.length >= 3) {
      out = out.replace(new RegExp(`(?<!\\p{L})${escapeRegExp(surname)}(?!\\p{L})`, "giu"), `${surname[0]}.`);
    }
  }
  return out;
}

/** Keys holding internal ids. A booking id opens its email preview, so none are shown. */
const ID_KEY = /^id$|_id$|Id$/;

/** Masks personal details recursively through objects and arrays. */
export function maskDeep<T>(value: T, names: string[] = []): T {
  if (typeof value === "string") return maskText(value, names) as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, names)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        typeof v === "string" && ID_KEY.test(k)
          ? "•••"
          : /name$/i.test(k) && typeof v === "string" && !/room/i.test(k)
            ? maskName(v)
            : maskDeep(v, names),
      ]),
    ) as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Overview

interface Row {
  id: string;
  ref_code: string;
  room: RoomId;
  starts_at: Date | string;
  ends_at: Date | string;
  customer_name: string;
  customer_email: string;
  duration_minutes: number;
  discount_cents: number;
  total_cents: number;
  status: "confirmed" | "cancelled";
  source: string;
  replaces: string | null;
  replaced_by: string | null;
  conversation_id: string | null;
  created_at: Date | string;
}

/** The opening customer message, read from the start of a stored transcript. */
function firstUserMessage(head: string): string {
  const match = /^\[\{"role":"user","content":"((?:[^"\\]|\\.)*)"/.exec(head);
  if (!match) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return "";
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function when(row: Pick<Row, "starts_at" | "ends_at">) {
  const s = toStudioTime(row.starts_at);
  const e = toStudioTime(row.ends_at);
  return {
    date: s.toISODate()!,
    label: `${s.toFormat("ccc d LLL")}, ${clockLabel(s.hour * 60 + s.minute)} – ${clockLabel(e.hour * 60 + e.minute)}`,
  };
}

export async function studioOverview(db: Db, now: DateTime) {
  const from = now.startOf("day");
  const days = 7;
  const to = from.plus({ days });
  const weekAgo = now.minus({ days: 7 });

  const [window, agentRows, conversations, drafts] = await Promise.all([
    db.query<Row>(
      `SELECT * FROM bookings WHERE status = 'confirmed' AND starts_at < $2 AND ends_at > $1`,
      [from.toISO(), to.toISO()],
    ),
    db.query<Row>(`SELECT * FROM bookings WHERE source = 'agent' ORDER BY created_at DESC`),
    db.query<{ id: string; created_at: Date | string; user_turns: number; checked: boolean; head: string }>(
      `SELECT id, created_at, user_turns,
              position('"name":"check_availability"' in messages) > 0 AS checked,
              left(messages, 2000) AS head
         FROM conversations
        WHERE user_turns > 0 AND created_at > $1
        ORDER BY created_at DESC`,
      [weekAgo.toISO()],
    ),
    db.query<{ conversation_id: string; customer_name: string }>(
      `SELECT DISTINCT conversation_id, customer_name FROM booking_drafts WHERE created_at > $1`,
      [weekAgo.toISO()],
    ),
  ]);

  // Names customers gave in each conversation, so they can be masked in its text.
  const namesIn = new Map<string, string[]>();
  for (const { conversation_id, customer_name } of [
    ...drafts,
    ...agentRows.map((r) => ({ conversation_id: r.conversation_id, customer_name: r.customer_name })),
  ]) {
    if (!conversation_id) continue;
    namesIn.set(conversation_id, [...(namesIn.get(conversation_id) ?? []), customer_name]);
  }

  // Utilisation: booked minutes per room per day against opening hours.
  const open = CLOSE_MINUTE - OPEN_MINUTE;
  const heatmap = Array.from({ length: days }, (_, i) => {
    const day = from.plus({ days: i });
    const date = day.toISODate()!;
    const rooms = Object.fromEntries(
      ROOM_IDS.map((room) => {
        const minutes = window
          .filter((r) => r.room === room && when(r).date === date)
          .reduce((sum, r) => sum + r.duration_minutes, 0);
        return [room, Math.round((minutes / open) * 100)];
      }),
    ) as Record<RoomId, number>;
    return { date, weekday: day.toFormat("ccc"), label: day.toFormat("d LLL"), rooms };
  });
  const bookedMinutes = window.reduce((sum, r) => sum + r.duration_minutes, 0);

  const live = agentRows.filter((r) => r.status === "confirmed");
  const cancellations = agentRows.filter((r) => r.status === "cancelled" && !r.replaced_by).length;
  const moves = agentRows.filter((r) => r.replaces).length;

  // Funnel over the last 7 days of conversations.
  const conversationIds = new Set(conversations.map((c) => c.id));
  const quoted = new Set(drafts.map((d) => d.conversation_id).filter((id) => conversationIds.has(id)));
  const booked = new Set(agentRows.map((r) => r.conversation_id).filter((id): id is string => !!id && conversationIds.has(id)));
  const started = new Map(conversations.map((c) => [c.id, new Date(c.created_at).getTime()]));
  const timeToBook = median(
    agentRows
      .filter((r) => r.conversation_id && started.has(r.conversation_id) && !r.replaces)
      .map((r) => (new Date(r.created_at).getTime() - started.get(r.conversation_id!)!) / 1000),
  );

  return {
    generatedAt: now.toISO(),
    kpis: {
      liveBookings: live.length,
      revenue: formatMoney(live.reduce((sum, r) => sum + r.total_cents, 0)),
      discounted: live.filter((r) => r.discount_cents > 0).length,
      utilisation: Math.round((bookedMinutes / (open * days * ROOM_IDS.length)) * 100),
      conversion: conversations.length ? Math.round((booked.size / conversations.length) * 100) : null,
      medianSecondsToBook: timeToBook == null ? null : Math.round(timeToBook),
      moves,
      cancellations,
    },
    funnel: [
      { label: "Conversations", value: conversations.length },
      { label: "Checked availability", value: conversations.filter((c) => c.checked).length },
      { label: "Received a quote", value: quoted.size },
      { label: "Booked", value: booked.size },
    ],
    heatmap,
    // No booking ids: one is enough to open that booking's email preview.
    bookings: agentRows.slice(0, 30).map((r) => ({
      ref: maskRef(r.ref_code),
      room: ROOMS[r.room].name,
      when: when(r).label,
      customer: maskName(r.customer_name),
      email: maskEmail(r.customer_email),
      total: formatMoney(r.total_cents),
      status: r.status === "confirmed" ? (r.replaces ? "moved" : "confirmed") : r.replaced_by ? "replaced" : "cancelled",
      conversationId: r.conversation_id,
      createdAt: toStudioTime(r.created_at).toISO(),
    })),
    conversations: conversations.slice(0, 20).map((c) => ({
      id: c.id,
      startedAt: toStudioTime(c.created_at).toISO(),
      turns: c.user_turns,
      outcome: booked.has(c.id) ? "booked" : quoted.has(c.id) ? "quoted" : "browsing",
      firstMessage: maskText(firstUserMessage(c.head), namesIn.get(c.id)).slice(0, 120),
    })),
  };
}

// ---------------------------------------------------------------------------
// Transcript

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; ok: boolean; data: Record<string, unknown> };

type Block = { type: string; [k: string]: unknown };

/** A stored API transcript as the studio reads it: words and tool steps, no system notes. */
export async function conversationTranscript(db: Db, id: string) {
  const [row] = await db.query<{ messages: string; created_at: Date | string }>(
    `SELECT messages, created_at FROM conversations WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  const messages = JSON.parse(row.messages) as Array<{ role: string; content: string | Block[] }>;

  const results = new Map<string, { ok: boolean; data: Record<string, unknown> }>();
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(String(b.content));
      } catch {
        data = { text: String(b.content) };
      }
      results.set(String(b.tool_use_id), { ok: !b.is_error, data });
    }
  }

  const items: TranscriptItem[] = [];
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") items.push({ kind: "user", text: m.content });
    if (m.role !== "assistant") continue;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === "text" && String(b.text).trim()) items.push({ kind: "assistant", text: String(b.text) });
      if (b.type === "tool_use") {
        const result = results.get(String(b.id));
        items.push({
          kind: "tool",
          id: String(b.id),
          name: String(b.name),
          input: b.input,
          ok: result?.ok ?? false,
          data: result?.data ?? {},
        });
      }
    }
  }
  // Names the customer gave, so they can be masked wherever they were typed.
  const stored = await db.query<{ customer_name: string }>(
    `SELECT customer_name FROM booking_drafts WHERE conversation_id = $1
     UNION SELECT customer_name FROM bookings WHERE conversation_id = $1`,
    [id],
  );
  const names = new Set(stored.map((r) => r.customer_name));
  for (const item of items) {
    if (item.kind !== "tool") continue;
    for (const source of [item.input as Record<string, unknown> | null, item.data]) {
      for (const key of ["customer_name", "customerName"]) {
        if (typeof source?.[key] === "string") names.add(source[key] as string);
      }
    }
  }
  const known = [...names];
  const masked: TranscriptItem[] = items.map((item) =>
    item.kind === "tool"
      ? { ...item, input: maskDeep(item.input, known), data: maskDeep(item.data, known) }
      : { ...item, text: maskText(item.text, known) },
  );
  return { id, startedAt: toStudioTime(row.created_at).toISO(), items: masked };
}
