import type { Transition, Variants } from "motion/react";

// One motion vocabulary for the whole app. Quiet by default: frequent
// interactions barely move, things appear from what caused them, and only the
// confirmation gets a moment of its own. Reduced-motion users get these without
// movement via <MotionConfig reducedMotion="user">.

/** Strong ease-out for things entering or settling in place. */
export const EASE = [0.22, 1, 0.36, 1] as const;
/** For movement between two on-screen positions (Material 3 "standard"). */
export const EASE_MOVE = [0.2, 0, 0, 1] as const;
/** For sheets sliding up from the bottom edge (iOS / Vaul). */
export const EASE_SHEET = [0.32, 0.72, 0, 1] as const;

export const DURATION = { press: 0.12, hover: 0.15, exit: 0.15, quick: 0.2, enter: 0.26, emphasis: 0.4 } as const;

/**
 * Springs by visual duration and bounce. Motion's own default spring bounces
 * noticeably, so every layout or spring animation should name one of these.
 * Only `impact`, for the rubber stamp, overshoots visibly.
 */
export const spring = {
  snap: { type: "spring", visualDuration: 0.2, bounce: 0 },
  smooth: { type: "spring", visualDuration: 0.3, bounce: 0 },
  settle: { type: "spring", visualDuration: 0.35, bounce: 0.15 },
  impact: { type: "spring", visualDuration: 0.28, bounce: 0.25 },
} as const satisfies Record<string, Transition>;

export const enter: Transition = { duration: DURATION.enter, ease: EASE };
export const exit: Transition = { duration: DURATION.exit, ease: EASE };
export const quick: Transition = { duration: DURATION.press, ease: EASE };

/** Default for anything that doesn't name its own transition. */
export const defaultTransition: Transition = { ...enter, layout: spring.smooth };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: enter },
  exit: { opacity: 0, y: -4, transition: exit },
};

/** Opacity only, for things that appear often (quick replies): no movement to get used to. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DURATION.exit, ease: EASE } },
};

export const popIn: Variants = {
  hidden: { opacity: 0, y: 6, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: enter },
};

/** Staggered children; keep the total under ~300ms. */
export const stagger = (gap = 0.04, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

/** Press feedback for buttons and chips. No hover lift: hover only changes colour. */
export const pressable = {
  whileTap: { scale: 0.97 },
  transition: quick,
} as const;

/** "$1,190.00" → 1190; null for anything that isn't an amount. */
export function amount(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const n = Number(text.replace(/[^0-9.-]/g, ""));
  return text.trim() && Number.isFinite(n) ? n : null;
}
