import { describe, expect, it } from "vitest";
import { calculatePrice, cheaperLongerOption, formatMoney } from "@/lib/pricing";

const hours = (h: number) => Math.round(h * 60);

describe("calculatePrice", () => {
  it.each([
    // [hours, total in cents, discount applied]
    [1, 100_00, false],
    [2, 200_00, false],
    [3, 300_00, false], // spec example: 3 × $100 = $300
    [3.5, 350_00, false],
    [4, 340_00, true], // boundary: exactly 4 h gets the discount
    [4.5, 382_50, true],
    [5, 425_00, true], // spec example: 5 × $100 × 0.85 = $425
    [8, 680_00, true],
    [14, 1190_00, true],
  ])("%s h → %s cents (discount: %s)", (h, total, discounted) => {
    const quote = calculatePrice(hours(h));
    expect(quote.totalCents).toBe(total);
    expect(quote.discountApplied).toBe(discounted);
    expect(quote.subtotalCents - quote.discountCents).toBe(total);
  });

  it("applies no discount one slot below the threshold", () => {
    expect(calculatePrice(239).discountApplied).toBe(false);
    expect(calculatePrice(240).discountApplied).toBe(true);
  });

  it("explains its working", () => {
    expect(calculatePrice(hours(5)).breakdown).toContain("$425.00");
    expect(calculatePrice(hours(5)).breakdown).toContain("15%");
    expect(calculatePrice(hours(3)).breakdown).toContain("standard hourly rate");
  });

  it.each([0, -60, 90.5, Number.NaN])("rejects invalid duration %s", (m) => {
    expect(() => calculatePrice(m)).toThrow(RangeError);
  });
});

describe("cheaperLongerOption", () => {
  it("suggests 4 h when 3.5 h costs more", () => {
    expect(cheaperLongerOption(hours(3.5))?.totalCents).toBe(340_00);
  });

  it("stays quiet when the longer booking costs more", () => {
    expect(cheaperLongerOption(hours(3))).toBeNull();
    expect(cheaperLongerOption(hours(1))).toBeNull();
  });

  it("stays quiet once the discount already applies", () => {
    expect(cheaperLongerOption(hours(4))).toBeNull();
    expect(cheaperLongerOption(hours(6))).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats cents as dollars", () => {
    expect(formatMoney(382_50)).toBe("$382.50");
    expect(formatMoney(340_00)).toBe("$340.00");
  });
});
