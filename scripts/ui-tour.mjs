// Walks the newer features end to end and saves screenshots: the slot picker,
// a booking made from it, moving it, cancelling it, and the studio view.
//   node scripts/ui-tour.mjs <outDir> [baseUrl]
// Uses the locally installed Chrome (muted) and the real Claude API (a few cents).
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const outDir = process.argv[2] ?? "./.shots";
const base = process.argv[3] ?? "http://localhost:3124";
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const idle = (page) =>
  page.waitForFunction(() => !document.querySelector('[aria-label="Assistant is typing"]'), null, { timeout: 120_000 });
async function send(page, text) {
  const box = page.getByLabel("Message");
  await box.fill(text);
  await box.press("Enter");
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: "networkidle" });

  // 1. Slot picker
  await page.getByRole("button", { name: "Pick a time on the schedule" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByRole("group", { name: "Day" }).getByRole("button").nth(4).click();
  await dialog.getByRole("button", { name: /^Room B/ }).click();
  await dialog.getByRole("group", { name: "Afternoon start times" }).getByRole("button").first().click();
  await dialog.getByRole("button", { name: /^3\.5 h/ }).click();
  await page.waitForTimeout(500);
  await shot(page, "11-picker");

  // 2. Quote from the picker
  await dialog.getByRole("button", { name: "Get a quote" }).click();
  await idle(page);
  await page.waitForTimeout(500);
  if (!(await page.getByRole("button", { name: /^Confirm and book/ }).count())) {
    await send(page, "Jane Citizen, jane@example.com");
  }
  await page.getByRole("button", { name: /^Confirm and book/ }).waitFor({ timeout: 120_000 });
  await idle(page);
  await page.waitForTimeout(800);
  await shot(page, "12-picker-quote");

  // 3. Book it
  await page.getByRole("button", { name: /^Confirm and book/ }).click();
  await page.getByText("Booking confirmed").waitFor({ timeout: 120_000 });
  await idle(page);
  await page.waitForTimeout(1000);
  await shot(page, "13-booked");

  // 4. Move it
  await page.getByRole("button", { name: "Move this booking" }).click();
  await page.keyboard.type("6pm to 10pm the same day");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Confirm change/ }).waitFor({ timeout: 120_000 });
  await idle(page);
  await page.waitForTimeout(800);
  await shot(page, "14-move-quote");
  await page.getByRole("button", { name: /^Confirm change/ }).click();
  await page.getByText("Booking moved").waitFor({ timeout: 120_000 });
  await idle(page);
  await page.waitForTimeout(1000);
  await shot(page, "15-moved");

  // 5. Cancel it
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).first().waitFor({ timeout: 120_000 });
  await idle(page);
  await page.waitForTimeout(800);
  await shot(page, "16-cancel-request");
  await page.getByRole("button", { name: "Yes, cancel it" }).first().click();
  await page.getByText("Booking cancelled").waitFor({ timeout: 120_000 });
  await idle(page);
  await page.waitForTimeout(1200);
  await shot(page, "17-cancelled");
  await page.locator("aside").screenshot({ path: join(outDir, "17b-panel.png") });

  // 6. Studio view
  await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
  await page.getByText("Studio overview").waitFor();
  await page.waitForTimeout(1200);
  await shot(page, "18-studio");
  await page.screenshot({ path: join(outDir, "18b-studio-full.png"), fullPage: true });
  await page.locator("ul button").first().click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(1200);
  await shot(page, "19-transcript");

  // 7. Mobile picker
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: "Pick a time on the schedule" }).click();
  await mobile.getByRole("dialog").waitFor();
  await mobile.getByRole("dialog").getByRole("group", { name: "Afternoon start times" }).getByRole("button").first().click();
  await mobile.getByRole("dialog").getByRole("button", { name: /^4 h/ }).click();
  await mobile.waitForTimeout(500);
  await shot(mobile, "20-mobile-picker");
  console.log(`saved to ${outDir}`);
} catch (err) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  await Promise.all(pages.map((p, i) => shot(p, `error-${i}`).catch(() => {})));
  throw err;
} finally {
  await browser.close();
}
