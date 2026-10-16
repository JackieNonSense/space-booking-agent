import { busyByRoom } from "@/lib/bookings";
import { CLOSE_MINUTE, OPEN_MINUTE, ROOM_IDS } from "@/lib/config";
import { getDb } from "@/lib/db";
import { BookingError } from "@/lib/errors";
import { ensureDemoSeed } from "@/lib/seed";
import { assertBookableDate, clock, dateLabel, studioNow } from "@/lib/time";

/**
 * Busy time per room for one day, for the slot picker. Time blocks only, no
 * customer details. Prices and the actual booking still go through the agent.
 */
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  const now = studioNow();
  try {
    assertBookableDate(date, now);
  } catch (err) {
    if (err instanceof BookingError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const db = await getDb();
  await ensureDemoSeed(db, now);
  const busy = await busyByRoom(db, date);

  return Response.json(
    {
      date,
      label: dateLabel(date),
      openMinute: OPEN_MINUTE,
      closeMinute: CLOSE_MINUTE,
      // Minutes after midnight in studio time, or null when the day hasn't started.
      nowMinute: date === now.toISODate() ? now.hour * 60 + now.minute : null,
      rooms: Object.fromEntries(
        ROOM_IDS.map((room) => [
          room,
          busy[room].map((b) => ({ start: clock(b.startMinute), end: clock(b.endMinute) })),
        ]),
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
