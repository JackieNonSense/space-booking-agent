import type Anthropic from "@anthropic-ai/sdk";
import type { DateTime } from "luxon";
import type { Db } from "../db";
import { newId } from "../ids";
import { buildSystemPrompt } from "./prompt";

export interface Conversation {
  id: string;
  systemPrompt: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  userTurns: number;
}

interface ConversationRow {
  id: string;
  system_prompt: string;
  messages: string;
  user_turns: number;
}

export async function createConversation(db: Db, now: DateTime, ip: string | null): Promise<Conversation> {
  const conversation: Conversation = {
    id: newId("cv"),
    systemPrompt: buildSystemPrompt(now),
    messages: [],
    userTurns: 0,
  };
  await db.query(
    `INSERT INTO conversations (id, system_prompt, messages, user_turns, ip) VALUES ($1, $2, '[]', 0, $3)`,
    [conversation.id, conversation.systemPrompt, ip],
  );
  return conversation;
}

export async function loadConversation(db: Db, id: string): Promise<Conversation | null> {
  const [row] = await db.query<ConversationRow>(
    `SELECT id, system_prompt, messages, user_turns FROM conversations WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    systemPrompt: row.system_prompt,
    messages: JSON.parse(row.messages),
    userTurns: row.user_turns,
  };
}

/**
 * Saves the transcript only if nobody else advanced it meanwhile (two tabs
 * sending at once). Returns false when the write lost that race.
 */
export async function saveConversation(db: Db, c: Conversation, expectedTurns: number): Promise<boolean> {
  const rows = await db.query(
    `UPDATE conversations SET messages = $2, user_turns = $3, updated_at = now()
      WHERE id = $1 AND user_turns = $4 RETURNING id`,
    [c.id, JSON.stringify(c.messages), c.userTurns, expectedTurns],
  );
  return rows.length === 1;
}
