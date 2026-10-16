import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { z } from "zod";
import {
  createConversation,
  loadConversation,
  saveConversation,
} from "@/lib/agent/conversations";
import type { AgentEvent } from "@/lib/agent/events";
import { runAgentTurn } from "@/lib/agent/run";
import { getDb } from "@/lib/db";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { ensureDemoSeed } from "@/lib/seed";
import { studioNow } from "@/lib/time";

export const maxDuration = 120;

const MAX_TURNS = 40;

const Body = z.object({
  conversationId: z.string().max(64).nullish(),
  message: z.string().trim().min(1).max(2000),
});

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The assistant isn't configured correctly (API key). Please let the site owner know.";
  }
  if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500)) {
    return "The assistant is busy right now. Please try again in a moment.";
  }
  return "Something went wrong. Please try again.";
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Send a message between 1 and 2000 characters." }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return Response.json(
      { error: "The assistant isn't configured yet (no Claude API key on the server)." },
      { status: 503 },
    );
  }

  const db = await getDb();
  const now = studioNow();
  const ip = clientIp(request);

  const limit = await checkRateLimit(db, ip);
  if (!limit.ok) return Response.json({ error: limit.message }, { status: 429 });

  await ensureDemoSeed(db, now);

  const existing = parsed.data.conversationId
    ? await loadConversation(db, parsed.data.conversationId)
    : null;
  const conversation = existing ?? (await createConversation(db, now, ip));
  if (conversation.userTurns >= MAX_TURNS) {
    return Response.json(
      { error: "This chat has reached its length limit. Start a new chat to keep going." },
      { status: 400 },
    );
  }
  const expectedTurns = conversation.userTurns;

  // The visitor may close the tab mid-turn. The turn still runs to the end, so
  // a booking confirmed a moment earlier is saved and emailed; only the
  // writing to the stream stops.
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false;
    },
  });
  const emit = (event: AgentEvent) => {
    if (!open) return;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      open = false;
    }
  };

  const turn = (async () => {
    emit({ type: "conversation", id: conversation.id });
    try {
      const usage = await runAgentTurn({ db, conversation, userText: parsed.data.message, now, emit });
      if (!(await saveConversation(db, conversation, expectedTurns))) {
        console.warn(`[chat] concurrent update to ${conversation.id}; this turn was not saved`);
      }
      emit({ type: "done", usage });
    } catch (err) {
      console.error("[chat] turn failed", err);
      emit({ type: "error", message: friendlyError(err) });
      emit({ type: "done" });
    } finally {
      if (open) {
        open = false;
        controller.close();
      }
    }
  })();
  // Keeps the function alive until the turn finishes, even after a disconnect.
  after(turn);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
