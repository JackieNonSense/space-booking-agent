// Applies the schema to the Postgres database in DATABASE_URL and seeds the
// rolling demo bookings. Safe to run repeatedly.
//   npm run db:setup
import { config } from "dotenv";
import { neonDb, splitStatements } from "../lib/db";
import { SCHEMA_SQL } from "../lib/schema";
import { seedDemoBookings } from "../lib/seed";
import { studioNow } from "../lib/time";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (in .env.local or the environment) first.");
  const db = neonDb(url);
  for (const statement of splitStatements(SCHEMA_SQL)) {
    await db.query(statement);
  }
  await seedDemoBookings(db, studioNow());
  const [{ count }] = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM bookings`);
  console.log(`Schema ready. ${count} bookings in the database.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
