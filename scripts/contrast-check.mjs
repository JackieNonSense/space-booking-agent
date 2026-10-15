// Checks the design tokens in app/globals.css against WCAG 2.2 contrast.
//   node scripts/contrast-check.mjs
// Text needs 4.5:1, graphics and component boundaries need 3:1.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("@theme"));
const tokens = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [l1, l2] = [luminance(tokens[a]), luminance(tokens[b])].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TEXT = 4.5;
const GRAPHIC = 3;
const checks = [
  // Text on every surface it can sit on
  ...["fg", "fg-2", "fg-3"].flatMap((fg) =>
    ["surface", "canvas", "inset", "hover", "brand-soft"].map((bg) => [fg, bg, TEXT]),
  ),
  ["brand", "surface", TEXT],
  ["brand", "canvas", TEXT],
  ["brand-strong", "brand-soft", TEXT],
  ["ok", "surface", TEXT],
  ["ok", "ok-soft", TEXT],
  ["danger", "surface", TEXT],
  ["danger", "danger-soft", TEXT],
  ["on-ink", "ink", TEXT],
  ["on-ink", "ink-hover", TEXT],
  ["on-ink", "brand", TEXT],
  ["on-booked", "booked", TEXT],
  // Graphics: schedule blocks, outlines and focus rings against their ground
  ["booked", "surface", GRAPHIC],
  ["booked", "canvas", GRAPHIC],
  ["brand", "brand-soft", GRAPHIC],
  ["danger", "danger-soft", GRAPHIC],
  ["ink", "surface", GRAPHIC],
  ["ink", "canvas", GRAPHIC],
  ["ok", "canvas", GRAPHIC],
  ["border-control", "surface", GRAPHIC],
  ["border-control", "canvas", GRAPHIC],
];

let failed = 0;
for (const [fg, bg, min] of checks) {
  if (!tokens[fg] || !tokens[bg]) {
    console.log(`MISSING  --${fg} or --${bg}`);
    failed++;
    continue;
  }
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (needs ${min})  --${fg} on --${bg}`);
}
console.log(failed ? `\n${failed} pair(s) below WCAG AA` : `\nAll ${checks.length} pairs meet WCAG AA`);
process.exitCode = failed ? 1 : 0;
