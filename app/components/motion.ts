import type { Transition, Variants } from "motion/react";

// One motion vocabulary for the whole app: short, eased, no loops.
// Reduced-motion users get these without movement via <MotionConfig reducedMotion="user">.

export const EASE = [0.22, 1, 0.36, 1] as const;

export const enter: Transition = { duration: 0.32, ease: EASE };
export const quick: Transition = { duration: 0.12, ease: "easeOut" };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: enter },
};

export const popIn: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: enter },
};

export const stagger = (gap = 0.05, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

/** Hover and press feedback for buttons and chips. */
export const pressable = {
  whileHover: { y: -1 },
  whileTap: { scale: 0.97 },
  transition: quick,
} as const;
