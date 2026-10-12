// Business rules for the studio. Everything the agent quotes comes from here,
// never from the model.

export const STUDIO_NAME = "Eastern Essence Studio";
export const TIMEZONE = "Australia/Sydney";

export const ROOMS = {
  A: { id: "A", name: "Room A" },
  B: { id: "B", name: "Room B" },
} as const;
export type RoomId = keyof typeof ROOMS;
export const ROOM_IDS = Object.keys(ROOMS) as RoomId[];

export const OPEN_MINUTE = 8 * 60; // 08:00
export const CLOSE_MINUTE = 22 * 60; // 22:00
export const SLOT_MINUTES = 30;
export const MIN_BOOKING_MINUTES = 60;
export const MAX_ADVANCE_DAYS = 180;

export const HOURLY_RATE_CENTS = 100_00;
export const DISCOUNT_THRESHOLD_MINUTES = 4 * 60;
export const DISCOUNT_PERCENT = 15;

export const DRAFT_TTL_MINUTES = 15;
