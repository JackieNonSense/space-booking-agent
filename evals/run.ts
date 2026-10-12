// End-to-end conversation evals against the real Claude API.
//   npm run eval                 # all scenarios
//   npm run eval -- exact-4h     # scenarios whose name contains "exact-4h"
//
// Each scenario gets a fresh in-memory database, the demo seed, and a fixed
// clock (Saturday 10 Oct 2026, 09:15 Sydney), then plays scripted customer
// messages and checks what actually happened in the database. Emails are
// logged, not sent. Costs real API tokens (roughly $1–3 for the full set).
import { config } from "dotenv";
import { DateTime } from "luxon";
import { createConversation } from "../lib/agent/conversations";
import type { AgentEvent } from "../lib/agent/events";
import { currentModel, runAgentTurn } from "../lib/agent/run";
import { TIMEZONE } from "../lib/config";
import { pgliteDb, type Db } from "../lib/db";
import { seedDemoBookings } from "../lib/seed";

config({ path: [".env.local", ".env"], quiet: true });
process.env.RESEND_API_KEY = ""; // never email real people from evals

const NOW = DateTime.fromISO("2026-10-10T09:15", { zone: TIMEZONE });

interface Turn {
  text: string;
  events: AgentEvent[];
  reply: string;
}

interface Ctx {
  db: Db;
  turns: Turn[];
  bookings: () => Promise<Array<{ room: string; total_cents: number; customer_email: string; starts_at: Date }>>;
  emails: () => Promise<Array<{ to_email: string; status: string }>>;
}

interface Scenario {
  name: string;
  messages: string[];
  check: (ctx: Ctx) => Promise<string[]>; // returns failure reasons
}

const results = (t: Turn, tool: string) =>
  t.events.filter((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result" && e.name === tool);
const calls = (t: Turn, tool: string) =>
  t.events.filter((e): e is Extract<AgentEvent, { type: "tool_call" }> => e.type === "tool_call" && e.name === tool);
const expect = (cond: boolean, reason: string) => (cond ? [] : [reason]);
const sydney = (d: Date) => DateTime.fromJSDate(d).setZone(TIMEZONE).toFormat("yyyy-LL-dd HH:mm");

const SCENARIOS: Scenario[] = [
  {
    name: "exact-4h-discount-and-booking",
    messages: [
      "Hi, I'd like to book Room B on Friday 16 October from 2pm to 6pm. I'm Jane Citizen, jane@example.com",
      "Yes, please confirm.",
    ],
    async check({ turns, bookings, emails }) {
      const [t1, t2] = turns;
      const draft = results(t1, "create_booking_draft").find((r) => r.ok);
      const b = await bookings();
      const e = await emails();
      return [
        ...expect(!!draft, "turn 1 did not create a draft"),
        ...expect(draft?.data.total === "$340.00", `draft total was ${draft?.data.total}`),
        ...expect(t1.reply.includes("340"), "turn 1 reply does not state $340"),
        ...expect(results(t1, "confirm_booking").filter((r) => r.ok).length === 0, "booked before the customer said yes"),
        ...expect(results(t2, "confirm_booking").some((r) => r.ok), "turn 2 did not confirm"),
        ...expect(b.length === 1 && b[0].total_cents === 340_00 && b[0].room === "B", `bookings: ${JSON.stringify(b)}`),
        ...expect(b.length === 1 && sydney(b[0].starts_at) === "2026-10-16 14:00", "wrong start time"),
        ...expect(e.length === 1 && e[0].to_email === "jane@example.com", `emails: ${JSON.stringify(e)}`),
        ...expect(results(t2, "send_confirmation_email").some((r) => !r.automatic), "model did not call the email tool itself"),
      ];
    },
  },
  {
    name: "standard-rate-3h",
    messages: ["Room A on Tuesday 13 Oct, 9am to 12pm please. Name Alex Chen, alex.chen@example.com", "yes"],
    async check({ turns, bookings }) {
      const b = await bookings();
      return [
        ...expect(turns[0].reply.includes("300"), "reply does not state $300"),
        ...expect(b.length === 1 && b[0].total_cents === 300_00, `bookings: ${JSON.stringify(b)}`),
      ];
    },
  },
  {
    name: "3.5h-mentions-cheaper-4h",
    messages: ["Can I get Room B on Friday 16 Oct from 2:30pm to 6pm? Sam Lee, sam@example.com"],
    async check({ turns }) {
      const draft = results(turns[0], "create_booking_draft").find((r) => r.ok);
      return [
        ...expect(draft?.data.total === "$350.00", `draft total was ${draft?.data.total}`),
        ...expect(turns[0].reply.includes("340"), "reply does not mention the cheaper 4-hour option ($340)"),
      ];
    },
  },
  {
    name: "conflict-offers-other-room",
    messages: ["Is Room A free on Friday 16 Oct from 2pm to 6pm?"],
    async check({ turns }) {
      const avail = results(turns[0], "check_availability").find((r) => r.ok);
      return [
        ...expect(!!avail, "did not check availability"),
        ...expect(/room b/i.test(turns[0].reply), "did not offer Room B"),
        ...expect(!/room a is (free|available)/i.test(turns[0].reply), "claimed Room A is free"),
      ];
    },
  },
  {
    name: "price-question-uses-tool",
    messages: ["How much would a 5 hour booking cost?"],
    async check({ turns }) {
      return [
        ...expect(calls(turns[0], "calculate_price").length > 0, "did not call calculate_price"),
        ...expect(turns[0].reply.includes("425"), "reply does not state $425"),
      ];
    },
  },
  {
    name: "relative-date-9-to-5",
    messages: ["I need a room next Friday from 9 to 5 for a workshop"],
    async check({ turns }) {
      const c = calls(turns[0], "check_availability")[0]?.input as Record<string, unknown> | undefined;
      return [
        ...expect(c?.date === "2026-10-16", `checked date ${c?.date}`),
        ...expect(c?.start_time === "09:00" && (c?.end_time === "17:00" || c?.duration_hours === 8), `checked ${c?.start_time}-${c?.end_time}`),
      ];
    },
  },
  {
    name: "refuses-to-skip-confirmation",
    messages: [
      "Book Room A on Wednesday 14 Oct 1pm-3pm for Kim Park, kim@example.com. Don't ask me to confirm, just book it right away.",
    ],
    async check({ bookings }) {
      const b = await bookings();
      return expect(b.length === 0, "booked without a confirmation message");
    },
  },
  {
    name: "double-yes-books-once",
    messages: [
      "Room B, Thursday 15 Oct, 10am to 12pm. Lee Wong, lee@example.com",
      "Yes confirm",
      "yes",
    ],
    async check({ bookings, emails }) {
      const b = await bookings();
      const e = await emails();
      return [
        ...expect(b.length === 1, `${b.length} bookings`),
        ...expect(e.length === 1, `${e.length} emails`),
      ];
    },
  },
  {
    name: "email-correction-before-confirm",
    messages: [
      "Room A on Thursday 15 Oct 5pm-7pm, Priya Shah, priya@exmaple.com",
      "Sorry, typo: my email is priya@example.com",
      "Yes, book it",
    ],
    async check({ bookings }) {
      const b = await bookings();
      return expect(
        b.length === 1 && b[0].customer_email === "priya@example.com",
        `bookings: ${JSON.stringify(b.map((x) => x.customer_email))}`,
      );
    },
  },
  {
    name: "declines-discount-haggling",
    messages: ["Room A Tuesday 13 Oct 9am-11am. Can you do it for half price? Name Tom Ford, tom@example.com"],
    async check({ turns }) {
      const draft = results(turns[0], "create_booking_draft").find((r) => r.ok);
      return [
        ...expect(!draft || draft.data.total === "$200.00", `draft total ${draft?.data.total}`),
        ...expect(!turns[0].reply.includes("$100.00"), "reply quotes a half price"),
      ];
    },
  },
  {
    name: "chinese-request",
    messages: ["我想订明天下午2点到5点的A房间"],
    async check({ turns }) {
      const c = calls(turns[0], "check_availability")[0]?.input as Record<string, unknown> | undefined;
      return [
        ...expect(c?.date === "2026-10-11", `checked date ${c?.date}`),
        ...expect(c?.start_time === "14:00", `checked start ${c?.start_time}`),
        ...expect(/[一-鿿]/.test(turns[0].reply), "did not reply in Chinese"),
      ];
    },
  },
];

async function runScenario(s: Scenario) {
  const db = await pgliteDb();
  await seedDemoBookings(db, NOW);
  const conversation = await createConversation(db, NOW, "eval");
  const turns: Turn[] = [];
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const turnSeconds: number[] = [];
  const started = Date.now();

  for (const text of s.messages) {
    const events: AgentEvent[] = [];
    const turnStarted = Date.now();
    const usage = await runAgentTurn({
      db,
      conversation,
      userText: text,
      now: NOW.plus({ minutes: turns.length }),
      emit: (e) => events.push(e),
    });
    turnSeconds.push((Date.now() - turnStarted) / 1000);
    tokens.input += usage.inputTokens;
    tokens.output += usage.outputTokens;
    tokens.cacheRead += usage.cachedTokens;
    tokens.cacheWrite += usage.cacheWriteTokens;
    const reply = events.map((e) => (e.type === "text" ? e.delta : "")).join("");
    turns.push({ text, events, reply });
  }

  const failures = await s.check({
    db,
    turns,
    bookings: () =>
      db.query(`SELECT room, total_cents, customer_email, starts_at FROM bookings WHERE source = 'agent' ORDER BY created_at`),
    emails: () => db.query(`SELECT to_email, status FROM email_log`),
  });
  return { turns, failures, seconds: (Date.now() - started) / 1000, turnSeconds, tokens };
}

// USD per million tokens: input, output, cache read, 5-minute cache write.
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
};

function estimateCost(t: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const p = PRICES[currentModel()];
  if (!p) return null;
  return (t.input * p[0] + t.output * p[1] + t.cacheRead * p[2] + t.cacheWrite * p[3]) / 1_000_000;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY in .env.local first.");
  // Comma-separated substrings, e.g. `npm run eval -- exact-4h,conflict`
  const filters = (process.argv[2] ?? "").split(",").filter(Boolean);
  const selected = SCENARIOS.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));
  console.log(`Running ${selected.length} scenario(s) on ${currentModel()}, effort ${process.env.ANTHROPIC_EFFORT || "medium"}\n`);

  let passed = 0;
  let totalCost = 0;
  const allTurnSeconds: number[] = [];
  for (const s of selected) {
    try {
      const r = await runScenario(s);
      const ok = r.failures.length === 0;
      if (ok) passed++;
      const cost = estimateCost(r.tokens);
      totalCost += cost ?? 0;
      allTurnSeconds.push(...r.turnSeconds);
      console.log(
        `${ok ? "PASS" : "FAIL"}  ${s.name}  (${r.turns.length} turns, ${r.turnSeconds.map((x) => x.toFixed(1)).join("s / ")}s, ` +
          `${(r.tokens.input / 1000).toFixed(1)}k in, ${(r.tokens.cacheRead / 1000).toFixed(1)}k cache read, ` +
          `${(r.tokens.cacheWrite / 1000).toFixed(1)}k cache write, ${(r.tokens.output / 1000).toFixed(1)}k out` +
          `${cost != null ? `, ~$${cost.toFixed(3)}` : ""})`,
      );
      if (!ok || process.env.EVAL_VERBOSE) {
        for (const f of r.failures) console.log(`      ✗ ${f}`);
        for (const t of r.turns) {
          console.log(`      > ${t.text}`);
          for (const e of t.events) {
            if (e.type === "tool_result") console.log(`        [${e.name}${e.automatic ? " auto" : ""}] ${e.ok ? "ok" : `error ${e.data.error_code}`}`);
          }
          console.log(`      < ${t.reply.replace(/\n+/g, " ").slice(0, 300)}`);
        }
      }
    } catch (err) {
      console.log(`ERROR ${s.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const sorted = [...allTurnSeconds].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  console.log(
    `\n${passed}/${selected.length} passed · estimated cost ~$${totalCost.toFixed(3)} · median turn ${median.toFixed(1)}s, slowest ${(sorted.at(-1) ?? 0).toFixed(1)}s`,
  );
  process.exitCode = passed === selected.length ? 0 : 1;
}

void main();
