// Drives the running app through a real booking and saves screenshots.
//   node scripts/ui-shots.mjs <outDir> [baseUrl]
// Uses the locally installed Chrome (muted). Each run costs a few cents of API usage.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const outDir = process.argv[2] ?? "./.shots";
const base = process.argv[3] ?? "http://localhost:3123";
const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });

async function send(page, text) {
  const box = page.getByLabel("Message");
  await box.fill(text);
  await box.press("Enter");
}

try {
  // Desktop: full booking flow.
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(base, { waitUntil: "networkidle" });
  await desktop.getByText("Room schedule").waitFor();
  await desktop.waitForTimeout(600);
  await shot(desktop, "01-empty");

  await send(desktop, "Hi, I'd like to book Room B this Friday from 2pm to 6pm. I'm Jane Citizen, jane@example.com");
  const confirm = desktop.getByRole("button", { name: /^Confirm/ });
  await confirm.waitFor({ timeout: 90_000 });
  await desktop.waitForFunction(() => !document.querySelector('[aria-label="Assistant is typing"]'), null, { timeout: 90_000 });
  await desktop.waitForTimeout(1200);
  await shot(desktop, "02-quote");

  await confirm.click();
  await desktop.getByText("Booking confirmed").waitFor({ timeout: 90_000 });
  await desktop.waitForFunction(() => !document.querySelector('[aria-label="Assistant is typing"]'), null, { timeout: 90_000 });
  await desktop.waitForTimeout(1500);
  await shot(desktop, "03-confirmed");

  // Expand the first step to show the layered trace.
  await desktop.getByRole("button", { name: /Checked availability/ }).first().click();
  await desktop.waitForTimeout(400);
  await desktop.getByRole("button", { name: /Checked availability/ }).first().scrollIntoViewIfNeeded();
  await shot(desktop, "04-step-detail");
  await desktop.locator("aside").screenshot({ path: join(outDir, "04b-panel.png") });

  // Mobile: conflict handling and the schedule tab.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(600);
  await shot(mobile, "05-mobile-empty");

  await send(mobile, "Is Room A free this Friday from 2pm to 6pm?");
  await mobile.getByText(/Available instead|Booked/).first().waitFor({ timeout: 90_000 });
  await mobile.waitForFunction(() => !document.querySelector('[aria-label="Assistant is typing"]'), null, { timeout: 90_000 });
  await mobile.waitForTimeout(1200);
  await shot(mobile, "06-mobile-conflict");

  await mobile.getByRole("button", { name: /Booking & schedule/ }).click();
  await mobile.waitForTimeout(600);
  await shot(mobile, "07-mobile-schedule");
  console.log(`saved to ${outDir}`);
} catch (err) {
  // Keep a picture of whatever state the failure left behind.
  const pages = browser.contexts().flatMap((c) => c.pages());
  await Promise.all(pages.map((p, i) => shot(p, `error-${i}`).catch(() => {})));
  throw err;
} finally {
  await browser.close();
}
