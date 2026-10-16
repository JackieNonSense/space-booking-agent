import { getBooking } from "@/lib/bookings";
import { getDb } from "@/lib/db";
import { previousOf, renderBookingEmail } from "@/lib/email";

/**
 * Renders the latest email for a booking (confirmation, update or cancellation)
 * so it can be checked even if the real one lands in spam. Booking ids are
 * random 16-character tokens and reference codes are not accepted here, so the
 * id acts as the capability.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/bookings/[id]/email">) {
  const { id } = await ctx.params;
  if (!/^bk_[a-z0-9]{16}$/.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const booking = await getBooking(db, id);
  if (!booking || booking.id !== id) return new Response("Not found", { status: 404 });

  const previous = booking.status === "confirmed" ? await previousOf(db, booking.id) : null;
  const kind = booking.status === "cancelled" ? "cancelled" : previous ? "updated" : "confirmed";
  const { html } = renderBookingEmail(booking, kind, previous);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
