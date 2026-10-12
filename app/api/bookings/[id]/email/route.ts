import { getBooking } from "@/lib/bookings";
import { getDb } from "@/lib/db";
import { renderConfirmationEmail } from "@/lib/email";

/**
 * Renders the confirmation email for a booking, so it can be checked even if
 * the real one lands in spam. Booking ids are random 16-character tokens and
 * reference codes are not accepted here, so the id acts as the capability.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/bookings/[id]/email">) {
  const { id } = await ctx.params;
  if (!/^bk_[a-z0-9]{16}$/.test(id)) return new Response("Not found", { status: 404 });
  const booking = await getBooking(await getDb(), id);
  if (!booking || booking.id !== id) return new Response("Not found", { status: 404 });
  const { html } = renderConfirmationEmail(booking);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
