import { scheduleBetween } from "@/lib/bookings";
import { CLOSE_MINUTE, MAX_ADVANCE_DAYS, OPEN_MINUTE, TIMEZONE } from "@/lib/config";
import { getDb } from "@/lib/db";
import { ensureDemoSeed } from "@/lib/seed";
import { studioNow } from "@/lib/time";

const DAYS = 7;

/** Public week view for the timeline: time blocks only, no customer details. */
export async function GET(request: Request) {
  const offset = Math.min(Math.max(Number(new URL(request.url).searchParams.get("week") ?? 0) || 0, 0), 25);
  const db = await getDb();
  const now = studioNow();
  await ensureDemoSeed(db, now);

  const from = now.startOf("day").plus({ weeks: offset });
  const bookings = await scheduleBetween(db, from, DAYS);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = from.plus({ days: i });
    return { date: d.toISODate()!, weekday: d.toFormat("ccc"), label: d.toFormat("d LLL") };
  });

  return Response.json(
    {
      timezone: TIMEZONE,
      now: now.toISO(),
      today: now.toISODate(),
      lastBookableDate: now.startOf("day").plus({ days: MAX_ADVANCE_DAYS }).toISODate(),
      openMinute: OPEN_MINUTE,
      closeMinute: CLOSE_MINUTE,
      days,
      bookings,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
