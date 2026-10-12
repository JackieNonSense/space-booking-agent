export type BookingErrorCode =
  | "INVALID_DATE"
  | "INVALID_TIME"
  | "INVALID_DURATION"
  | "MISSING_END"
  | "CONFLICTING_END"
  | "END_BEFORE_START"
  | "CROSSES_MIDNIGHT"
  | "OUTSIDE_HOURS"
  | "NOT_ON_GRID"
  | "TOO_SHORT"
  | "IN_PAST"
  | "TOO_FAR_AHEAD"
  | "INVALID_NAME"
  | "INVALID_EMAIL"
  | "ROOM_UNAVAILABLE"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_EXPIRED"
  | "NEEDS_USER_CONFIRMATION"
  | "BOOKING_NOT_FOUND"
  | "EMAIL_FAILED";

/**
 * A rule violation the agent should explain to the customer. Tools turn these
 * into structured `is_error` results instead of letting them crash the loop.
 */
export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BookingError";
  }
}
