export type Part =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      automatic?: boolean;
      /** Client clock when the call was announced, for the activity log. */
      at: number;
      result?: { ok: boolean; data: Record<string, unknown>; ms: number };
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; steps: number };
}

export interface ScheduleBlock {
  id: string;
  room: "A" | "B";
  date: string;
  start: string;
  end: string;
  demo: boolean;
}

export interface Schedule {
  timezone: string;
  now: string;
  today: string;
  openMinute: number;
  closeMinute: number;
  days: Array<{ date: string; weekday: string; label: string }>;
  bookings: ScheduleBlock[];
}

/** A slot the conversation is currently about, drawn on the timeline. */
export interface FocusSlot {
  date: string;
  start?: string;
  end?: string;
  room?: "A" | "B" | null;
}

export interface Alternative {
  room: "A" | "B";
  roomName: string;
  date: string;
  start: string;
  end: string;
  label: string;
  duration: string;
  total: string;
}
