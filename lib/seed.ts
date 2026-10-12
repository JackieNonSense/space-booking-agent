import type { DateTime } from "luxon";
import type { RoomId } from "./config";
import type { Db } from "./db";
import { calculatePrice } from "./pricing";
import { atMinute, parseClock } from "./time";

// A rolling week of "existing" bookings so availability checks have something
// to say from the first message. Keyed by ISO weekday (1 = Monday).
const WEEKLY_PATTERN: Record<number, Array<[RoomId, string, string]>> = {
  1: [["A", "09:00", "12:00"], ["B", "13:00", "17:00"]],
  2: [["A", "14:00", "18:00"]],
  3: [["B", "10:00", "12:00"], ["A", "18:00", "21:00"]],
  4: [["A", "10:00", "16:00"]],
  5: [["A", "14:00", "16:00"], ["B", "09:00", "13:00"], ["B", "18:00", "22:00"]],
  6: [["A", "10:00", "14:00"], ["B", "10:00", "14:00"]],
  7: [["B", "15:00", "18:00"]],
};

const SEED_DAYS = 21;

export async function seedDemoBookings(db: Db, now: DateTime, days = SEED_DAYS): Promise<void> {
  const values: unknown[] = [];
  const rows: string[] = [];
  for (let i = 0; i < days; i++) {
    const day = now.startOf("day").plus({ days: i });
    const date = day.toISODate()!;
    WEEKLY_PATTERN[day.weekday].forEach(([room, from, to], n) => {
      const startMinute = parseClock(from);
      const endMinute = parseClock(to);
      const price = calculatePrice(endMinute - startMinute);
      const key = `${date.replaceAll("-", "")}-${room}${n}`;
      const p = values.length;
      rows.push(
        `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, 'Existing booking (demo)', 'demo@example.com', $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, 'seed')`,
      );
      values.push(
        `seed_${key}`,
        `DEMO-${key}`,
        room,
        atMinute(date, startMinute).toISO(),
        atMinute(date, endMinute).toISO(),
        endMinute - startMinute,
        price.subtotalCents,
        price.discountCents,
        price.totalCents,
      );
    });
  }
  // DO NOTHING also skips rows that would overlap a real customer's booking.
  await db.query(
    `INSERT INTO bookings
       (id, ref_code, room, starts_at, ends_at, customer_name, customer_email,
        duration_minutes, subtotal_cents, discount_cents, total_cents, source)
     VALUES ${rows.join(",\n")}
     ON CONFLICT DO NOTHING`,
    values,
  );
}

const globalForSeed = globalThis as unknown as { __seededFor?: string };

/** Seeds at most once per studio day per server instance. */
export async function ensureDemoSeed(db: Db, now: DateTime): Promise<void> {
  const today = now.toISODate()!;
  if (globalForSeed.__seededFor === today) return;
  await seedDemoBookings(db, now);
  globalForSeed.__seededFor = today;
}
