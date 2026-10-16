import { DateTime } from "luxon";
import { Resend } from "resend";
import { getBooking, type BookingView } from "./bookings";
import { STUDIO_NAME } from "./config";
import type { Db } from "./db";
import { BookingError } from "./errors";
import { siteUrl } from "./site";
import { atMinute, parseClock } from "./time";

export type EmailKind = "confirmed" | "updated" | "cancelled";

export interface EmailResult {
  status: "sent" | "dry_run" | "already_sent" | "failed";
  kind: EmailKind;
  to: string;
  subject: string;
  bookingRef: string;
  bookingId: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Content

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const HEADINGS: Record<EmailKind, string> = {
  confirmed: "Your booking is confirmed",
  updated: "Your booking has been updated",
  cancelled: "Your booking is cancelled",
};

/**
 * One template for every booking email. `previous` is the booking an update
 * replaced, shown so the customer can see what changed.
 */
export function renderBookingEmail(b: BookingView, kind: EmailKind = "confirmed", previous: BookingView | null = null) {
  const subject = {
    confirmed: `Booking confirmed: ${b.roomName}, ${b.when} (${b.refCode})`,
    updated: `Booking updated: ${b.roomName}, ${b.when} (${b.refCode})`,
    cancelled: `Booking cancelled: ${b.roomName}, ${b.when} (${b.refCode})`,
  }[kind];

  const rows: Array<[string, string]> =
    kind === "cancelled"
      ? [
          ["Customer name", b.customerName],
          ["Room", b.roomName],
          ["Date & time", b.when],
          ["Booking reference", b.refCode],
        ]
      : [
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
          ...(previous
            ? ([["Replaces", `${previous.roomName}, ${previous.when} (${previous.refCode}, now cancelled)`]] as Array<
                [string, string]
              >)
            : []),
        ];

  const intro = {
    confirmed: `Your booking at ${STUDIO_NAME} is confirmed.`,
    updated: `Your booking at ${STUDIO_NAME} has been moved. Here are the new details.`,
    cancelled: `Your booking at ${STUDIO_NAME} has been cancelled and the time has been released.`,
  }[kind];
  const manage =
    kind === "cancelled"
      ? `Want to book another time? Visit ${siteUrl()}.`
      : `Need to change or cancel? Open ${siteUrl()} and give the assistant your reference ${b.refCode} and this email address.`;
  const calendarNote =
    kind === "cancelled" ? "The attached file removes the event from your calendar." : "A calendar invite is attached.";

  const text = [
    `Hi ${b.customerName},`,
    "",
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    calendarNote,
    manage,
    "",
    `— ${STUDIO_NAME} booking assistant`,
  ].join("\n");

  const tableRows = rows
    .map(([k, v], i) => {
      const isTotal = k === "Total price";
      const border = i ? "border-top:1px solid #e4e0d8;" : "";
      return `<tr>
        <td style="padding:10px 0;color:#4a433b;font-size:14px;${border}">${escapeHtml(k)}</td>
        <td style="padding:10px 0;text-align:right;color:#1a1714;font-size:${isTotal ? "18px" : "14px"};font-weight:${isTotal ? 700 : 500};${border}">${escapeHtml(v)}</td>
      </tr>`;
    })
    .join("");
  const accent = kind === "cancelled" ? "#b42318" : "#7a5320";

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#f7f6f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e4e0d8;">
    <tr><td style="padding:28px 28px 8px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${accent};font-weight:600;">${escapeHtml(STUDIO_NAME)}</div>
      <h1 style="margin:8px 0 4px;font-size:22px;color:#1a1714;">${HEADINGS[kind]}</h1>
      <p style="margin:0;color:#4a433b;font-size:14px;">Hi ${escapeHtml(b.customerName)}, ${escapeHtml(intro.charAt(0).toLowerCase() + intro.slice(1))}</p>
    </td></tr>
    <tr><td style="padding:8px 28px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tableRows}</table>
    </td></tr>
    <tr><td style="padding:0 28px 28px;color:#4a433b;font-size:13px;line-height:1.5;">
      ${escapeHtml(calendarNote)}<br>${escapeHtml(manage)}
    </td></tr>
  </table>
  <p style="max-width:520px;margin:16px auto 0;color:#6e655a;font-size:12px;text-align:center;">
    Sent by the AI booking assistant prototype for ${escapeHtml(STUDIO_NAME)}.
  </p>
</body></html>`;

  return { subject, html, text };
}

/** Kept for callers that only send confirmations. */
export const renderConfirmationEmail = (b: BookingView) => renderBookingEmail(b, "confirmed");

const icsText = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
const icsTime = (dt: DateTime) => dt.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");

/** Calendar invite; with `cancel`, a CANCEL for the same event so calendars remove it. */
export function buildIcs(b: BookingView, now: DateTime = DateTime.now(), cancel = false): string {
  const start = atMinute(b.date, parseClock(b.start));
  const end = atMinute(b.date, parseClock(b.end));
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Space Booking Agent//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancel ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${b.id}@space-booking-agent`,
    `SEQUENCE:${cancel ? 1 : 0}`,
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
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

export async function previousOf(db: Db, bookingId: string): Promise<BookingView | null> {
  const [row] = await db.query<{ id: string }>(`SELECT id FROM bookings WHERE replaced_by = $1`, [bookingId]);
  return row ? getBooking(db, row.id) : null;
}

/**
 * Sends one email of a given kind for a booking, at most once. The content is
 * built from the stored booking, so the model can't put a different price in it.
 * Without `kind`, the booking's state decides: cancelled, a replacement, or new.
 */
export async function sendBookingEmail(db: Db, bookingId: string, kind?: EmailKind): Promise<EmailResult> {
  const booking = await getBooking(db, bookingId);
  if (!booking) {
    throw new BookingError("BOOKING_NOT_FOUND", `No booking with id ${bookingId}.`);
  }
  const previous = booking.status === "confirmed" ? await previousOf(db, booking.id) : null;
  const resolvedKind: EmailKind = kind ?? (booking.status === "cancelled" ? "cancelled" : previous ? "updated" : "confirmed");
  const { subject, html, text } = renderBookingEmail(booking, resolvedKind, previous);
  const base = { kind: resolvedKind, to: booking.customerEmail, subject, bookingRef: booking.refCode, bookingId: booking.id };

  const [claimed] = await db.query<{ attempts: number }>(
    `INSERT INTO email_log (booking_id, kind, to_email, subject, status, attempts)
     VALUES ($1, $2, $3, $4, 'pending', 1)
     ON CONFLICT (booking_id, kind) DO UPDATE
       SET attempts = email_log.attempts + 1, status = 'pending', error = NULL
       WHERE email_log.status = 'failed'
     RETURNING attempts`,
    [booking.id, resolvedKind, booking.customerEmail, subject],
  );
  if (!claimed) return { ...base, status: "already_sent" };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info(`[email:dry-run] ${resolvedKind} to=${booking.customerEmail}\n${text}`);
    await markEmail(db, booking.id, resolvedKind, "dry_run");
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
        attachments: [
          {
            filename: resolvedKind === "cancelled" ? "cancellation.ics" : "booking.ics",
            content: Buffer.from(buildIcs(booking, DateTime.now(), resolvedKind === "cancelled")),
          },
        ],
      },
      { idempotencyKey: `booking-${resolvedKind}/${booking.id}` },
    );
    if (error) throw new Error(error.message);
    await markEmail(db, booking.id, resolvedKind, "sent", data?.id);
    return { ...base, status: "sent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] ${resolvedKind} failed for ${booking.id}: ${message}`);
    await markEmail(db, booking.id, resolvedKind, "failed", null, message);
    return { ...base, status: "failed", error: message };
  }
}

/** The tool-facing name: sends whichever email the booking's state calls for. */
export const sendConfirmationEmail = (db: Db, bookingId: string) => sendBookingEmail(db, bookingId);

async function markEmail(
  db: Db,
  bookingId: string,
  kind: EmailKind,
  status: "sent" | "dry_run" | "failed",
  providerId: string | null = null,
  error: string | null = null,
) {
  await db.query(
    `UPDATE email_log
        SET status = $3, provider_id = $4, error = $5,
            sent_at = CASE WHEN $3 IN ('sent', 'dry_run') THEN now() ELSE sent_at END
      WHERE booking_id = $1 AND kind = $2`,
    [bookingId, kind, status, providerId, error],
  );
}

/**
 * Emails this conversation owes but never attempted: a confirmation or update
 * for each live booking it made, and a notice for each cancellation it made.
 */
export async function unsentEmails(db: Db, conversationId: string): Promise<Array<{ bookingId: string; kind: EmailKind }>> {
  const live = await db.query<{ id: string; replaced: boolean }>(
    `SELECT b.id, EXISTS (SELECT 1 FROM bookings p WHERE p.replaced_by = b.id) AS replaced
       FROM bookings b
       LEFT JOIN email_log e ON e.booking_id = b.id AND e.kind IN ('confirmed', 'updated')
      WHERE b.conversation_id = $1 AND b.status = 'confirmed' AND e.booking_id IS NULL`,
    [conversationId],
  );
  const cancelled = await db.query<{ booking_id: string }>(
    `SELECT pc.booking_id
       FROM pending_cancellations pc
       LEFT JOIN email_log e ON e.booking_id = pc.booking_id AND e.kind = 'cancelled'
      WHERE pc.conversation_id = $1 AND pc.confirmed_at IS NOT NULL AND e.booking_id IS NULL`,
    [conversationId],
  );
  return [
    ...live.map((r) => ({ bookingId: r.id, kind: (r.replaced ? "updated" : "confirmed") as EmailKind })),
    ...cancelled.map((r) => ({ bookingId: r.booking_id, kind: "cancelled" as EmailKind })),
  ];
}

/** Bookings from this conversation whose confirmation was never attempted. */
export async function unsentBookingIds(db: Db, conversationId: string): Promise<string[]> {
  return (await unsentEmails(db, conversationId)).filter((e) => e.kind !== "cancelled").map((e) => e.bookingId);
}
