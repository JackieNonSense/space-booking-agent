// Sends one real confirmation email through Resend, using the app's own
// booking and email code on a throwaway in-memory database.
//   npm run email:test -- you@example.com
import { config } from "dotenv";
import { confirmDraft, createDraft } from "../lib/bookings";
import { pgliteDb } from "../lib/db";
import { sendConfirmationEmail } from "../lib/email";
import { studioNow } from "../lib/time";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const to = process.argv[2];
  if (!to) throw new Error("Usage: npm run email:test -- you@example.com");
  if (!process.env.RESEND_API_KEY) throw new Error("Set RESEND_API_KEY in .env.local first.");

  const now = studioNow();
  const db = await pgliteDb();
  const ctx = (userTurn: number) => ({ conversationId: "cv_email_test", userTurn, now });
  const draft = await createDraft(
    db,
    {
      room: "B",
      date: now.plus({ days: 2 }).toISODate()!,
      start_time: "14:00",
      end_time: "18:00",
      customer_name: "Email Test",
      customer_email: to,
    },
    ctx(1),
  );
  const { booking } = await confirmDraft(db, draft.draftId, ctx(2));

  console.log(`From:    ${process.env.EMAIL_FROM ?? "(Resend test sender)"}`);
  console.log(`To:      ${to}`);
  console.log(`Booking: ${booking.refCode}, ${booking.roomName}, ${booking.when}, ${booking.total}`);
  const result = await sendConfirmationEmail(db, booking.id);
  console.log(`Result:  ${result.status}${result.error ? ` (${result.error})` : ""}`);
  process.exitCode = result.status === "sent" ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
