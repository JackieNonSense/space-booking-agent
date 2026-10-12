import {
  DISCOUNT_PERCENT,
  DISCOUNT_THRESHOLD_MINUTES,
  HOURLY_RATE_CENTS,
} from "./config";

export interface PriceQuote {
  durationMinutes: number;
  durationHours: number;
  hourlyRateCents: number;
  subtotalCents: number;
  discountApplied: boolean;
  discountPercent: number;
  discountCents: number;
  totalCents: number;
  /** Human-readable working, e.g. "4 h × $100.00 × 0.85 = $340.00". */
  breakdown: string;
}

/**
 * Duration-based pricing. All arithmetic is in integer cents so the result
 * never depends on floating-point rounding.
 *   < 4 h  → hours × $100
 *   ≥ 4 h  → hours × $100 × 0.85
 */
export function calculatePrice(durationMinutes: number): PriceQuote {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new RangeError(`durationMinutes must be a positive integer, got ${durationMinutes}`);
  }

  const subtotalCents = Math.round((durationMinutes * HOURLY_RATE_CENTS) / 60);
  const discountApplied = durationMinutes >= DISCOUNT_THRESHOLD_MINUTES;
  const totalCents = discountApplied
    ? Math.round((subtotalCents * (100 - DISCOUNT_PERCENT)) / 100)
    : subtotalCents;
  const durationHours = durationMinutes / 60;

  const base = `${formatHours(durationHours)} × ${formatMoney(HOURLY_RATE_CENTS)}`;
  const breakdown = discountApplied
    ? `${base} × ${(100 - DISCOUNT_PERCENT) / 100} = ${formatMoney(totalCents)} (${DISCOUNT_PERCENT}% discount for bookings of 4 hours or more)`
    : `${base} = ${formatMoney(totalCents)} (standard hourly rate)`;

  return {
    durationMinutes,
    durationHours,
    hourlyRateCents: HOURLY_RATE_CENTS,
    subtotalCents,
    discountApplied,
    discountPercent: discountApplied ? DISCOUNT_PERCENT : 0,
    discountCents: subtotalCents - totalCents,
    totalCents,
    breakdown,
  };
}

/**
 * Because the discount kicks in at 4 h, a slightly shorter booking can cost
 * more than a 4 h one (3.5 h = $350, 4 h = $340). Returns the 4 h option when
 * it is no more expensive, so the agent can point it out.
 */
export function cheaperLongerOption(durationMinutes: number): PriceQuote | null {
  if (durationMinutes >= DISCOUNT_THRESHOLD_MINUTES) return null;
  const current = calculatePrice(durationMinutes);
  const atThreshold = calculatePrice(DISCOUNT_THRESHOLD_MINUTES);
  return atThreshold.totalCents <= current.totalCents ? atThreshold : null;
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} ${rounded === 1 ? "hour" : "hours"}`;
}
