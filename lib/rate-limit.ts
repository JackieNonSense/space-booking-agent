import type { Db } from "./db";

const PER_IP_PER_HOUR = Number(process.env.RATE_LIMIT_PER_HOUR || 120);
// High enough that a burst of other visitors can't lock reviewers out; the
// Anthropic console's monthly spend limit is the real cost cap.
const TOTAL_PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY || 1000);

export type RateLimitResult = { ok: true } | { ok: false; message: string };

/** Keeps a public demo link from running up the API bill. */
export async function checkRateLimit(db: Db, ip: string): Promise<RateLimitResult> {
  const [row] = await db.query<{ ip_count: number; total: number }>(
    `SELECT count(*) FILTER (WHERE ip = $1 AND created_at > now() - interval '1 hour')::int AS ip_count,
            count(*)::int AS total
       FROM request_log
      WHERE created_at > now() - interval '1 day'`,
    [ip],
  );
  if (row.ip_count >= PER_IP_PER_HOUR) {
    return { ok: false, message: "You're sending messages very quickly. Please wait a few minutes and try again." };
  }
  if (row.total >= TOTAL_PER_DAY) {
    return { ok: false, message: "The demo has reached its daily limit. Please try again tomorrow." };
  }
  await db.query(`INSERT INTO request_log (ip) VALUES ($1)`, [ip]);
  return { ok: true };
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
