import { DateTime } from "luxon";
import { Resend } from "resend";
import { getBooking, type BookingView } from "./bookings";
import { STUDIO_NAME } from "./config";
import type { Db } from "./db";
import { BookingError } from "./errors";
import { atMinute, parseClock } from "./time";

export interface EmailResult {
  status: "sent" | "dry_run" | "already_sent" | "failed";
  to: string;
  subject: string;
  bookingRef: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Content

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderConfirmationEmail(b: BookingView) {
  const subject = `Booking confirmed: ${b.roomName}, ${b.when} (${b.refCode})`;
  const rows: Array<[string, string]> = [
    ["Customer name", b.customerName],
    ["Room", b.roomName],
    ["Date & time", b.when],
    ["Duration", b.duration],
    ...(b.discountApplied
      ? ([
          ["Subtotal", b.subtotal],
          ["4+ hour discount (15%)", `−${b.discount}`],
        ] as Array<[string, string]>)
      : []),
    ["Total price", b.total],
    ["Booking reference", b.refCode],
  ];

  const text = [
    `Hi ${b.customerName},`,
    "",
    `Your booking at ${STUDIO_NAME} is confirmed.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "A calendar invite is attached. Reply to this email if you need to change anything.",
    "",
    `— ${STUDIO_NAME} booking assistant`,
  ].join("\n");

  const tableRows = rows
    .map(([k, v], i) => {
      const isTotal = k === "Total price";
      return `<tr>
        <td style="padding:10px 0;color:#6b6257;font-size:14px;${i ? "border-top:1px solid #eee7dd;" : ""}">${escapeHtml(k)}</td>
        <td style="padding:10px 0;text-align:right;color:#2b2622;font-size:${isTotal ? "18px" : "14px"};font-weight:${isTotal ? 700 : 500};${i ? "border-top:1px solid #eee7dd;" : ""}">${escapeHtml(v)}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#f6f2ec;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #eee7dd;">
    <tr><td style="padding:28px 28px 8px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8a6d4b;font-weight:600;">${escapeHtml(STUDIO_NAME)}</div>
      <h1 style="margin:8px 0 4px;font-size:22px;color:#2b2622;">Your booking is confirmed</h1>
      <p style="margin:0;color:#6b6257;font-size:14px;">Hi ${escapeHtml(b.customerName)}, here are your booking details.</p>
    </td></tr>
    <tr><td style="padding:8px 28px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tableRows}</table>
    </td></tr>
    <tr><td style="padding:0 28px 28px;color:#6b6257;font-size:13px;line-height:1.5;">
      A calendar invite is attached. Reply to this email if you need to change anything.
    </td></tr>
  </table>
  <p style="max-width:520px;margin:16px auto 0;color:#a39a8f;font-size:11px;text-align:center;">
    Sent by the AI booking assistant prototype for ${escapeHtml(STUDIO_NAME)}.
  </p>
</body></html>`;

  return { subject, html, text };
}

const icsText = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
const icsTime = (dt: DateTime) => dt.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");

export function buildIcs(b: BookingView, now: DateTime = DateTime.now()): string {
  const start = atMinute(b.date, parseClock(b.start));
  const end = atMinute(b.date, parseClock(b.end));
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Space Booking Agent//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.id}@space-booking-agent`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(`${b.roomName} booking – ${STUDIO_NAME}`)}`,
    `LOCATION:${icsText(`${STUDIO_NAME} – ${b.roomName}`)}`,
    `DESCRIPTION:${icsText(`Booking ${b.refCode}\nDuration: ${b.duration}\nTotal: ${b.total}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

// ---------------------------------------------------------------------------
// Delivery

/**
 * Sends the confirmation for a booking at most once. The content is built
 * from the stored booking, so the model can't put a different price in it.
 */
export async function sendConfirmationEmail(db: Db, bookingId: string): Promise<EmailResult> {
  const booking = await getBooking(db, bookingId);
  if (!booking) {
    throw new BookingError("BOOKING_NOT_FOUND", `No booking with id ${bookingId}.`);
  }
  const { subject, html, text } = renderConfirmationEmail(booking);
  const base = { to: booking.customerEmail, subject, bookingRef: booking.refCode };

  const [claimed] = await db.query<{ attempts: number }>(
    `INSERT INTO email_log (booking_id, to_email, subject, status, attempts)
     VALUES ($1, $2, $3, 'pending', 1)
     ON CONFLICT (booking_id) DO UPDATE
       SET attempts = email_log.attempts + 1, status = 'pending', error = NULL
       WHERE email_log.status = 'failed'
     RETURNING attempts`,
    [booking.id, booking.customerEmail, subject],
  );
  if (!claimed) return { ...base, status: "already_sent" };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(`[email:dry-run] to=${booking.customerEmail}\n${text}`);
    await markEmail(db, booking.id, "dry_run");
    return { ...base, status: "dry_run" };
  }

  if (!process.env.EMAIL_FROM) {
    // Resend's shared test sender only delivers to the account owner, so
    // customers would silently never receive anything.
    console.warn("[email] EMAIL_FROM is not set; using Resend's test sender, which only reaches the account owner");
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send(
      {
        from: process.env.EMAIL_FROM ?? "Booking Assistant <onboarding@resend.dev>",
        to: booking.customerEmail,
        bcc: process.env.EMAIL_BCC || undefined,
        replyTo: process.env.EMAIL_REPLY_TO || undefined,
        subject,
        html,
        text,
        attachments: [{ filename: "booking.ics", content: Buffer.from(buildIcs(booking)) }],
      },
      { idempotencyKey: `booking-confirmation/${booking.id}` },
    );
    if (error) throw new Error(error.message);
    await markEmail(db, booking.id, "sent", data?.id);
    return { ...base, status: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] failed for ${booking.id}: ${message}`);
    await markEmail(db, booking.id, "failed", null, message);
    return { ...base, status: "failed", error: message };
  }
}

async function markEmail(
  db: Db,
  bookingId: string,
  status: "sent" | "dry_run" | "failed",
  providerId: string | null = null,
  error: string | null = null,
) {
  await db.query(
    `UPDATE email_log
        SET status = $2, provider_id = $3, error = $4,
            sent_at = CASE WHEN $2 IN ('sent', 'dry_run') THEN now() ELSE sent_at END
      WHERE booking_id = $1`,
    [bookingId, status, providerId, error],
  );
}

/** Bookings from this conversation whose confirmation was never attempted. */
export async function unsentBookingIds(db: Db, conversationId: string): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `SELECT b.id FROM bookings b
       LEFT JOIN email_log e ON e.booking_id = b.id
      WHERE b.conversation_id = $1 AND e.booking_id IS NULL`,
    [conversationId],
  );
  return rows.map((r) => r.id);
}
