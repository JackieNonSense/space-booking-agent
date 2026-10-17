// UI edge cases in a real (muted, headless) Chrome against a running server.
//   node scripts/ui-edge.mjs [baseUrl] [outDir]
// Most checks fake /api/chat, so they cost nothing; the last section books
// through the real assistant once (a few cents). Run it against a server with
// a throwaway database and email switched off.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3124";
const outDir = process.argv[3] ?? "./.shots/edge";
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
const results = [];

/** Runs one named check in a fresh page; console errors fail it unless expected. */
async function check(name, fn, { viewport = { width: 1440, height: 900 }, mobile = false, reducedMotion, expectErrors = [] } = {}) {
  // ONLY=<text> runs just the checks whose name contains it; SKIP=<text> leaves them out
  // (e.g. SKIP="real booking" against production, so nothing is booked or emailed).
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  if (process.env.SKIP && name.includes(process.env.SKIP)) return;
  const context = await browser.newContext({
    viewport,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    ...(reducedMotion ? { reducedMotion } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await fn(page);
    const unexpected = errors.filter((e) => !expectErrors.some((x) => e.includes(x)));
    if (unexpected.length) throw new Error(`console errors: ${unexpected.join(" | ")}`);
    results.push([true, name]);
    console.log(`ok    ${name}`);
  } catch (err) {
    results.push([false, name, err.message]);
    console.log(`FAIL  ${name}\n      ${err.message.split("\n")[0]}`);
    await page.screenshot({ path: join(outDir, `fail-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const noOverflow = async (page, where) => {
  // Not window.innerWidth: phone emulation widens the layout viewport to fit
  // oversized content, which would hide the very overflow being checked.
  const width = page.viewportSize().width;
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert(scroll <= width && inner <= width, `${where}: page is ${Math.max(scroll, inner)}px wide on a ${width}px screen`);
};
/** Text that runs past the edge of its box and gets cut off, unless it ends in "…" on purpose. */
const noClippedText = async (page, where, root = "main") => {
  const clipped = await page.evaluate((root) => {
    const out = [];
    for (const el of document.querySelectorAll(`${root} *`)) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      // Screen-reader-only text is a deliberately clipped 1px box.
      if (!own || el.clientWidth <= 1) continue;
      const style = getComputedStyle(el);
      if (style.textOverflow === "ellipsis" || style.overflowX === "auto" || style.overflowX === "scroll") continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(el.textContent.trim().slice(0, 60));
    }
    return out;
  }, root);
  assert(!clipped.length, `${where}: text cut off: ${clipped.map((t) => JSON.stringify(t)).join(", ")}`);
};
const ndjson = (events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const fakeReply = (text) =>
  ndjson([{ type: "conversation", id: "cv_fake0000000000" }, { type: "text", delta: text }, { type: "done" }]);
/** Answers /api/chat with `body` and counts the requests. */
async function fakeChat(page, body, { status = 200, delayMs = 0 } = {}) {
  const hits = { count: 0 };
  await page.route("**/api/chat", async (route) => {
    hits.count++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status,
      contentType: status === 200 ? "application/x-ndjson" : "application/json",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  });
  return hits;
}
async function send(page, text) {
  await page.getByLabel("Message").fill(text);
  await page.getByLabel("Message").press("Enter");
}
/** A room card on the welcome screen. */
const roomCard = (page, room) => page.getByRole("group", { name: new RegExp(`^Room ${room},`) });
const openPicker = async (page) => {
  await roomCard(page, "A").getByRole("button", { name: /^(Other times|Pick another day)$/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByRole("group", { name: /start times$/ }).first().waitFor();
  return dialog;
};
/** A day chip in the picker for the next given weekday (not today). */
const chipFor = (dialog, weekday) => dialog.getByRole("group", { name: "Day" }).getByRole("button").filter({ hasText: weekday }).first();

try {
  // ---- composer ----------------------------------------------------------------
  await check("welcome screen loads cleanly", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByText("What are you planning?").waitFor();
    assert(await page.getByRole("button", { name: "New chat" }).isDisabled(), "New chat is enabled with no chat");
  });

  await check("blank messages can't be sent", async (page) => {
    const hits = await fakeChat(page, fakeReply("hi"));
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByLabel("Message").fill("   \n  ");
    assert(await page.getByRole("button", { name: "Send" }).isDisabled(), "Send is enabled for whitespace");
    await page.getByLabel("Message").press("Enter");
    await page.waitForTimeout(300);
    assert(hits.count === 0, "whitespace was sent");
  });

  await check("Shift+Enter adds a line, Enter sends", async (page) => {
    const hits = await fakeChat(page, fakeReply("Got it."));
    await page.goto(base, { waitUntil: "networkidle" });
    const box = page.getByLabel("Message");
    await box.click();
    await page.keyboard.type("line one");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line two");
    assert((await box.inputValue()) === "line one\nline two", `value was ${JSON.stringify(await box.inputValue())}`);
    assert(hits.count === 0, "Shift+Enter sent the message");
    await page.keyboard.press("Enter");
    await page.getByText("Got it.").waitFor();
    assert(hits.count === 1, `${hits.count} requests`);
  });

  await check("messages are capped at 2000 characters", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByLabel("Message").fill("x".repeat(2500));
    const length = (await page.getByLabel("Message").inputValue()).length;
    assert(length === 2000, `length ${length}`);
  });

  await check("a double Enter sends once", async (page) => {
    const hits = await fakeChat(page, fakeReply("Only once."), { delayMs: 600 });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByLabel("Message").fill("hello");
    await page.getByLabel("Message").press("Enter");
    await page.getByLabel("Message").fill("hello again");
    await page.getByLabel("Message").press("Enter");
    await page.getByText("Only once.").waitFor();
    await page.waitForTimeout(300);
    assert(hits.count === 1, `${hits.count} requests`);
  });

  // ---- failures ------------------------------------------------------------------
  await check(
    "server error shows a retry that works",
    async (page) => {
      await fakeChat(page, { error: "The assistant is busy right now. Please try again in a moment." }, { status: 500 });
      await page.goto(base, { waitUntil: "networkidle" });
      await send(page, "Is Room A free on Friday?");
      // Scoped to the chat: Next.js has its own role="alert" route announcer.
      const alert = page.getByRole("log").getByRole("alert");
      await alert.waitFor();
      const text = await alert.innerText();
      assert(/busy right now/.test(text) && /Nothing was booked/.test(text), `alert said: ${text}`);
      await page.unroute("**/api/chat");
      await fakeChat(page, fakeReply("Room A is free."));
      await page.getByRole("button", { name: "Try again" }).click();
      await page.getByText("Room A is free.").waitFor();
      const asked = await page.locator("text=Is Room A free on Friday?").count();
      assert(asked === 2, `the question appears ${asked} times`);
    },
    { expectErrors: ["status of 500"] },
  );

  await check(
    "rate limit message is shown",
    async (page) => {
      await fakeChat(page, { error: "Too many messages from this connection. Please wait a little." }, { status: 429 });
      await page.goto(base, { waitUntil: "networkidle" });
      await send(page, "hello");
      await page.getByRole("alert").getByText(/Too many messages/).waitFor();
    },
    { expectErrors: ["status of 429"] },
  );

  await check("a reply cut off mid-stream doesn't claim nothing was booked", async (page) => {
    await fakeChat(page, ndjson([{ type: "conversation", id: "cv_fake0000000000" }, { type: "text", delta: "Checking Room B" }]));
    await page.goto(base, { waitUntil: "networkidle" });
    await send(page, "Yes, book it");
    const alert = page.getByRole("log").getByRole("alert");
    await alert.waitFor();
    const text = await alert.innerText();
    assert(/connection dropped/.test(text), `alert said: ${text}`);
    assert(/may still have gone through/.test(text) && !/Nothing was booked/.test(text), `alert said: ${text}`);
    // The typing dots fade out rather than vanish.
    await page.getByLabel("Assistant is typing").waitFor({ state: "detached", timeout: 3000 });
    await page.getByLabel("Message").fill("still usable");
    assert(!(await page.getByRole("button", { name: "Send" }).isDisabled()), "composer stays locked after the drop");
  });

  await check("an error event from the server is shown", async (page) => {
    await fakeChat(
      page,
      ndjson([
        { type: "conversation", id: "cv_fake0000000000" },
        { type: "error", message: "Something went wrong. Please try again." },
        { type: "done" },
      ]),
    );
    await page.goto(base, { waitUntil: "networkidle" });
    await send(page, "hello");
    await page.getByRole("alert").getByText(/Something went wrong/).waitFor();
  });

  await check("New chat clears the conversation", async (page) => {
    await fakeChat(page, fakeReply("Hello there."));
    await page.goto(base, { waitUntil: "networkidle" });
    await send(page, "hi");
    await page.getByText("Hello there.").waitFor();
    await page.getByRole("button", { name: "New chat" }).click();
    await page.getByText("What are you planning?").waitFor();
    assert((await page.getByText("Hello there.").count()) === 0, "old reply still shown");
  });

  // ---- details form ----------------------------------------------------------------
  const detailsForm = (page) => page.locator("form").filter({ has: page.getByRole("button", { name: "Send details" }) });
  // A reply that found Room B free and asks for the customer's details.
  const freeRoomReply = (question) =>
    ndjson([
      { type: "conversation", id: "cv_fake0000000000" },
      { type: "tool_call", id: "t1", name: "check_availability", input: { date: "2026-10-21", room: "B" } },
      {
        type: "tool_result",
        id: "t1",
        name: "check_availability",
        ok: true,
        ms: 9,
        data: {
          date: "2026-10-21",
          dateLabel: "Wednesday 21 October 2026",
          freeWindows: {},
          requested: { start: "14:00", end: "18:00", rooms: [{ room: "B", roomName: "Room B", available: true }] },
          alternatives: [],
        },
      },
      { type: "text", delta: question },
      { type: "done" },
    ]);

  await check("details form: checks the email, suggests a fix, then sends one plain sentence", async (page) => {
    const bodies = [];
    await page.route("**/api/chat", async (route) => {
      bodies.push(route.request().postDataJSON());
      const body = bodies.length === 1 ? freeRoomReply("Room B is free then. What name and email should I use?") : fakeReply("Thanks!");
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await send(page, "Room B on Wednesday from 2pm to 6pm");
    const form = detailsForm(page);
    await form.waitFor();
    await form.getByLabel("Full name").fill("Jane Citizen");
    await form.getByLabel("Email").fill("jane@gmial");
    await form.getByRole("button", { name: "Send details" }).click();
    await form.getByText("That email doesn't look right").waitFor();
    assert(bodies.length === 1, "sent an invalid email");
    await form.getByLabel("Email").fill("jane@gmial.com");
    await form.getByText("jane@gmail.com").waitFor();
    await form.getByRole("button", { name: "Use this" }).click();
    assert((await form.getByLabel("Email").inputValue()) === "jane@gmail.com", "suggestion not applied");
    await form.getByRole("button", { name: "Send details" }).click();
    await page.getByText("Thanks!").waitFor();
    assert(
      bodies[1]?.message === "My name is Jane Citizen and my email is jane@gmail.com.",
      `sent: ${bodies[1]?.message}`,
    );
    assert((await detailsForm(page).count()) === 0, "form still shown");
  });

  await check("details form: answers in Chinese when the customer writes Chinese", async (page) => {
    const bodies = [];
    await page.route("**/api/chat", async (route) => {
      bodies.push(route.request().postDataJSON());
      const body = bodies.length === 1 ? freeRoomReply("B 房间有空。请告诉我您的姓名和邮箱。") : fakeReply("谢谢！");
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await send(page, "我想订周三下午2点到6点的B房间");
    const form = detailsForm(page);
    await form.getByLabel("Full name").fill("王小明");
    await form.getByLabel("Email").fill("xiaoming@gmail.com");
    await form.getByRole("button", { name: "Send details" }).click();
    await page.getByText("谢谢！").waitFor();
    assert(bodies[1]?.message === "我叫王小明，邮箱是 xiaoming@gmail.com。", `sent: ${bodies[1]?.message}`);
  });

  await check(
    "details form: fits a phone screen",
    async (page) => {
      await fakeChat(page, freeRoomReply("Room B is free then. What name and email should I use?"));
      await page.goto(base, { waitUntil: "networkidle" });
      await send(page, "Room B on Wednesday from 2pm to 6pm");
      const form = detailsForm(page);
      await form.waitFor();
      await form.getByLabel("Email").fill("maximiliana.konstantinopoulou@an-exceptionally-long-domain-name.con");
      await page.waitForTimeout(500);
      await noOverflow(page, "details form");
      await noClippedText(page, "details form");
      await form.screenshot({ path: join(outDir, "details-form-phone.png") });
    },
    { viewport: { width: 390, height: 844 }, mobile: true },
  );

  await check("real booking through the details form", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    // A Wednesday with Room B free 7–9 pm.
    const iso = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
    const weekday = (ms) => new Date(ms).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "long" });
    let t = Date.now() + 2 * 864e5;
    while (weekday(t) !== "Wednesday") t += 864e5;
    for (;; t += 7 * 864e5) {
      const day = await (await page.request.get(`${base}/api/day?date=${iso(t)}`)).json();
      assert(!day.error, `no free Wednesday evening found (${day.error})`);
      if (!day.rooms.B.some((b) => b.start < "21:00" && b.end > "19:00")) break;
    }
    const day = new Date(t).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long" });
    await send(page, `Is Room B free on ${day} from 7pm to 9pm?`);
    const form = detailsForm(page);
    await form.waitFor({ timeout: 120_000 });
    await form.getByLabel("Full name").fill("Form Tester");
    await form.getByLabel("Email").fill("form.tester@example.com");
    await form.getByRole("button", { name: "Send details" }).click();
    const confirm = page.getByRole("button", { name: /^Confirm and book/ });
    await confirm.waitFor({ timeout: 120_000 });
    await page.getByText("Confirmation email goes to").waitFor();
    await page.getByText("form.tester@example.com").first().waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Assistant is typing"]'), null, { timeout: 120_000 });
    await page.screenshot({ path: join(outDir, "details-form-quote.png") });
    await confirm.click();
    await page.getByText("Booking confirmed").waitFor({ timeout: 120_000 });
  });

  // ---- slot picker ---------------------------------------------------------------
  await check("picker closes with Esc, the close button and the backdrop", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    const dialog = await openPicker(page);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await openPicker(page);
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "hidden" });
    await openPicker(page);
    await page.mouse.click(8, 8);
    await dialog.waitFor({ state: "hidden" });
  });

  await check("picker returns focus to the button that opened it", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    const opener = roomCard(page, "A").getByRole("button", { name: /^(Other times|Pick another day)$/ });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert(await page.evaluate(() => !!document.activeElement?.closest("dialog")), "focus is not inside the dialog");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert(await opener.evaluate((el) => el === document.activeElement), "focus did not return to the opener");
  });

  await check("picker: quote needs a start and a length; clashing lengths are disabled", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    const dialog = await openPicker(page);
    const quote = dialog.getByRole("button", { name: "Get a quote" });
    assert(await quote.isDisabled(), "quote enabled before choosing");
    // Demo pattern: every Tuesday Room A is booked 2–6 pm.
    await chipFor(dialog, "Tue").click();
    await dialog.getByRole("button", { name: /^Room A/ }).click();
    await dialog.getByRole("button", { name: "1:00 pm", exact: true }).click();
    assert(await quote.isDisabled(), "quote enabled without a length");
    assert(!(await dialog.getByRole("button", { name: /^1 h/ }).isDisabled()), "1 h should fit before 2 pm");
    assert(await dialog.getByRole("button", { name: /^1\.5 h/ }).isDisabled(), "1.5 h runs into the 2 pm booking");
    assert((await dialog.getByRole("button", { name: "2:30 pm", exact: true }).count()) === 0, "offers a start inside a booking");
    await dialog.getByRole("button", { name: /^1 h/ }).click();
    assert(!(await quote.isDisabled()), "quote still disabled");
    // Switching room keeps the choice only if it is still free.
    await dialog.getByRole("button", { name: /^Room B/ }).click();
    assert(!(await quote.isDisabled()), "Room B is free at 1 pm on Tuesdays, the choice should stay");
  });

  await check("picker sends a precise sentence", async (page) => {
    const hits = { body: null };
    await page.route("**/api/chat", async (route) => {
      hits.body = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: fakeReply("Checking.") });
    });
    await page.goto(base, { waitUntil: "networkidle" });
    const dialog = await openPicker(page);
    await chipFor(dialog, "Tue").click();
    await dialog.getByRole("button", { name: /^Room B/ }).click();
    await dialog.getByRole("button", { name: "2:30 pm", exact: true }).click();
    await dialog.getByRole("button", { name: /^3\.5 h/ }).click();
    await dialog.getByText(/4 hours.*\$340|\$10 less|cheaper/i).first().waitFor();
    await dialog.getByRole("button", { name: "Get a quote" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("Checking.").waitFor();
    assert(
      /^Book Room B on Tuesday \d{1,2} \w+ from 2:30 pm to 6:00 pm\.$/.test(hits.body?.message ?? ""),
      `sent: ${hits.body?.message}`,
    );
  });

  await check("room cards show live free times and open the picker on that slot", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    const day = await page.getByRole("group", { name: "Day", exact: true }).locator('[aria-pressed="true"]').innerText();
    const card = roomCard(page, "B");
    await card.getByText(/^Free |No free hour/).waitFor();
    const start = card.getByRole("button", { name: /^Start Room B at / }).first();
    const label = await start.innerText();
    await start.click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const pressed = async (group) =>
      (await dialog.getByRole("group", { name: group }).locator('[aria-pressed="true"]').innerText()).replace(/\s+/g, " ");
    assert((await pressed("Room")).startsWith("Room B"), "picker did not open on Room B");
    assert((await pressed("Day")).includes(day.match(/\d+/)[0]), "picker did not open on the chosen day");
    // "2pm" on the card, "2:00 pm" in the picker.
    const chosen = await dialog.locator('[aria-label$="start times"] [aria-pressed="true"]').innerText();
    assert(chosen.replace(/:00| /g, "") === label.replace(/:00| /g, ""), `start ${chosen} vs card ${label}`);
  });

  await check("free times in the assistant's availability card open the picker there", async (page) => {
    const date = new Date(Date.now() + 3 * 864e5).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
    await fakeChat(
      page,
      ndjson([
        { type: "conversation", id: "cv_fake0000000000" },
        { type: "tool_call", id: "t1", name: "check_availability", input: { date } },
        {
          type: "tool_result",
          id: "t1",
          name: "check_availability",
          ok: true,
          ms: 9,
          data: {
            date,
            dateLabel: "That day",
            freeWindows: {
              "Room A": [{ start: "08:00", end: "10:00", label: "8:00 am – 10:00 am" }],
              "Room B": [{ start: "13:00", end: "18:00", label: "1:00 pm – 6:00 pm" }],
            },
            requested: null,
            alternatives: [],
          },
        },
        { type: "text", delta: "Room B is free from 1pm." },
        { type: "done" },
      ]),
    );
    await page.goto(base, { waitUntil: "networkidle" });
    await send(page, "A 3-hour workshop that day");
    await page.getByRole("button", { name: /^Pick a time in Room B/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const room = await dialog.getByRole("group", { name: "Room" }).locator('[aria-pressed="true"]').innerText();
    const day = await dialog.getByRole("group", { name: "Day" }).locator('[aria-pressed="true"]').innerText();
    assert(room.startsWith("Room B"), `opened on ${room}`);
    assert(day.includes(String(Number(date.slice(8)))), `opened on day ${day}, expected ${date}`);
  });

  await check(
    "phone: the summary strip opens the booking tab",
    async (page) => {
      await fakeChat(page, freeRoomReply("Room B is free then. What name and email should I use?"));
      await page.goto(base, { waitUntil: "networkidle" });
      await send(page, "Room B on Wednesday from 2pm to 6pm");
      const strip = page.getByRole("button", { name: /^Booking details/ });
      await strip.waitFor();
      await strip.click();
      await page.getByRole("heading", { name: "Your booking" }).waitFor();
      const tab = page.getByRole("button", { name: "Booking & schedule" });
      assert((await tab.getAttribute("aria-pressed")) === "true", "booking tab not selected");
    },
    { viewport: { width: 390, height: 844 }, mobile: true },
  );

  await check("desktop: booking panel, schedule and pricing sit beside the chat", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    const aside = page.getByRole("complementary", { name: "Booking and schedule" });
    for (const heading of ["Your booking", "Room schedule", "Pricing"]) {
      assert(await aside.getByRole("heading", { name: heading }).isVisible(), `${heading} not visible`);
    }
    assert((await page.getByRole("button", { name: /^Booking details/ }).count()) === 0, "summary strip shown on desktop");
  });

  await check("picker opened far ahead on the schedule shows the chosen day", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next week" }).click();
    await page.waitForLoadState("networkidle");
    await page.locator("aside").getByRole("button", { name: "Pick a time", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    // The schedule's selected day, from the week strip: its heading animates, so
    // for a moment the outgoing day's heading is still in the page.
    const heading = await page
      .getByRole("group", { name: "Choose a day" })
      .locator('[aria-pressed="true"]')
      .getAttribute("aria-label");
    const selected = dialog.getByRole("group", { name: "Day" }).locator('[aria-pressed="true"]');
    assert((await selected.count()) === 1, "no day chip is selected");
    assert(await selected.isVisible(), "the selected day chip is not visible");
    const day = heading.match(/\d{1,2}/)?.[0];
    assert((await selected.innerText()).includes(day), `selected chip ${await selected.innerText()} vs schedule ${heading}`);
  });

  await check("the last schedule week stops offering days past the booking window", async (page) => {
    await page.goto(base, { waitUntil: "networkidle" });
    const next = page.getByRole("button", { name: "Next week" });
    while (!(await next.isDisabled())) await next.click();
    await page.waitForTimeout(400);
    await page.getByRole("group", { name: "Choose a day" }).getByRole("button").last().click();
    await page.getByText("Not open for booking yet").waitFor();
    assert(
      (await page.locator("aside").getByRole("button", { name: "Pick a time", exact: true }).count()) === 0,
      "Pick a time offered for a day that can't be booked",
    );
  });

  await check(
    "picker works with reduced motion",
    async (page) => {
      await page.goto(base, { waitUntil: "networkidle" });
      const dialog = await openPicker(page);
      await dialog.getByRole("group", { name: /start times$/ }).first().getByRole("button").first().click();
      await dialog.getByRole("button", { name: /^1 h/ }).click();
      assert(!(await dialog.getByRole("button", { name: "Get a quote" }).isDisabled()), "quote disabled");
    },
    { reducedMotion: "reduce" },
  );

  // ---- phone layout ----------------------------------------------------------------
  const phone = { viewport: { width: 390, height: 844 }, mobile: true };
  await check(
    "phone: nothing overflows sideways",
    async (page) => {
      await page.goto(base, { waitUntil: "networkidle" });
      await noOverflow(page, "welcome");
      const dialog = await openPicker(page);
      await noOverflow(page, "picker");
      const box = await dialog.boundingBox();
      assert(box && Math.abs(box.y + box.height - 844) < 2, `picker is not a bottom sheet (${JSON.stringify(box)})`);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Booking & schedule" }).click();
      await noOverflow(page, "booking tab");
      await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
      await page.getByText("Studio overview").waitFor();
      await page.waitForTimeout(800);
      await noOverflow(page, "studio");
      await noClippedText(page, "studio");
    },
    phone,
  );

  // ---- studio ------------------------------------------------------------------------
  await check("studio transcript opens and closes", async (page) => {
    await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
    await page.getByText("Studio overview").waitFor();
    const rows = page.locator("ul button");
    if (!(await rows.count())) return; // nothing to open on an empty database
    await rows.first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page.waitForTimeout(500);
    // Customer emails are masked, e.g. "a***@example.com".
    const unmasked = (await dialog.innerText()).match(/\b[\w.+-]{2,}@[\w-]+\.[\w.]+/g)?.filter((e) => !e.includes("***"));
    assert(!unmasked?.length, `unmasked emails: ${unmasked}`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  });

  // ---- a real booking with awkward details, on a phone ------------------------------
  await check(
    "phone: real booking with a very long name and email",
    async (page) => {
      await page.goto(base, { waitUntil: "networkidle" });
      // The first Tuesday with Room A free 7–9 pm (earlier runs may have taken some).
      const iso = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
      const weekday = (ms) => new Date(ms).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "long" });
      let t = Date.now() + 2 * 864e5;
      while (weekday(t) !== "Tuesday") t += 864e5;
      for (;; t += 7 * 864e5) {
        const day = await (await page.request.get(`${base}/api/day?date=${iso(t)}`)).json();
        assert(!day.error, `no free Tuesday evening found (${day.error})`);
        if (!day.rooms.A.some((b) => b.start < "21:00" && b.end > "19:00")) break;
      }
      const day = new Date(t).toLocaleDateString("en-AU", {
        timeZone: "Australia/Sydney",
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      await send(
        page,
        `Room A on ${day} from 7pm to 9pm. Name: Maximiliana Konstantinopoulou-Featherstonehaugh, email maximiliana.konstantinopoulou.featherstonehaugh@an-exceptionally-long-domain-name.example.com`,
      );
      const confirm = page.getByRole("button", { name: /^Confirm and book/ });
      await confirm.waitFor({ timeout: 120_000 });
      await page.waitForFunction(() => !document.querySelector('[aria-label="Assistant is typing"]'), null, { timeout: 120_000 });
      await page.waitForTimeout(600);
      await noOverflow(page, "quote");
      await noClippedText(page, "quote");
      await page.screenshot({ path: join(outDir, "long-details-quote.png"), fullPage: true });
      await confirm.click();
      await page.getByText("Booking confirmed").waitFor({ timeout: 120_000 });
      await page.waitForFunction(() => !document.querySelector('[aria-label="Assistant is typing"]'), null, { timeout: 120_000 });
      await page.waitForTimeout(800);
      await noOverflow(page, "confirmed");
      await noClippedText(page, "confirmed");
      await page.screenshot({ path: join(outDir, "long-details-confirmed.png"), fullPage: true });
      await page.getByRole("button", { name: "Booking & schedule" }).click();
      await page.waitForTimeout(500);
      await noOverflow(page, "ticket");
      await noClippedText(page, "ticket");
      await page.screenshot({ path: join(outDir, "long-details-ticket.png"), fullPage: true });

      // The same conversation in the studio's transcript, newest first.
      await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
      await page.getByText("Studio overview").waitFor();
      await page.locator("ul button").first().click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(800);
      await noOverflow(page, "transcript");
      await noClippedText(page, "transcript", "dialog");
      await page.screenshot({ path: join(outDir, "long-details-transcript.png") });
    },
    phone,
  );
} finally {
  await browser.close();
}

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
