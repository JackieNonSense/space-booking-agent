"use client";

import NumberFlow from "@number-flow/react";
import { amount } from "./motion";

const AUD = { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/**
 * A price whose digits roll when it changes ($400.00 → $340.00) instead of
 * being swapped. NumberFlow labels itself for screen readers and stays still
 * for anyone who prefers reduced motion. Anything that isn't an amount, like
 * the "$—" placeholder, is shown as plain text.
 */
export function Money({ value, className }: { value: string | number | null | undefined; className?: string }) {
  const n = typeof value === "number" ? value : amount(value);
  if (n == null) return <span className={className}>{typeof value === "string" ? value : "$—"}</span>;
  return <NumberFlow value={n} locales="en-AU" format={AUD} className={className} />;
}
