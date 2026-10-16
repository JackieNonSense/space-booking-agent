import { describe, expect, it } from "vitest";
import { detailsRequest } from "@/app/components/derive";
import type { ChatMessage, Part } from "@/app/components/types";
import { isValidEmail, isValidName, suggestEmail } from "@/lib/contact";

describe("contact rules", () => {
  it("accepts what the server accepts", () => {
    expect(isValidEmail(" Jane@Example.com ")).toBe(true);
    expect(isValidEmail("jane@example")).toBe(false);
    expect(isValidEmail("jane example.com")).toBe(false);
    expect(isValidName("  Jane   Citizen ")).toBe(true);
    expect(isValidName("J")).toBe(false);
  });

  it.each([
    ["jane@gmial.com", "jane@gmail.com"],
    ["jane@gmail.con", "jane@gmail.com"],
    ["Jane@Hotmial.com", "jane@hotmail.com"],
    ["jane@company.con", "jane@company.com"],
    ["jane@gmail.com", null],
    ["jane@company.com.au", null],
  ])("suggests a fix for %s", (email, expected) => {
    expect(suggestEmail(email)).toBe(expected);
  });
});

// Chat history as the client holds it.
let n = 0;
const user = (text: string): ChatMessage => ({ id: `u${n++}`, role: "user", parts: [{ kind: "text", text }] });
const assistant = (...parts: Part[]): ChatMessage => ({ id: `a${n++}`, role: "assistant", parts });
const text = (t: string): Part => ({ kind: "text", text: t });
const tool = (name: string, ok: boolean, data: Record<string, unknown>, input: unknown = {}): Part => ({
  kind: "tool",
  id: `t${n++}`,
  name,
  input,
  at: 0,
  result: { ok, data, ms: 5 },
});
const availability = (...available: boolean[]) =>
  tool("check_availability", true, {
    date: "2026-10-21",
    requested: { rooms: available.map((a, i) => ({ room: i ? "B" : "A", available: a })) },
  });

describe("when the chat offers the details form", () => {
  it("after a free room is found and no details are known", () => {
    const messages = [
      user("Room B Wednesday 2-6pm"),
      assistant(availability(false, true), text("Room B is free. What's your name and email?")),
    ];
    expect(detailsRequest(messages)).toEqual({ name: "", email: "", retry: false });
  });

  it("not when the requested time is taken in every room, or no time was asked", () => {
    expect(detailsRequest([user("Room A Friday 2-6pm"), assistant(availability(false, false))])).toBeNull();
    expect(
      detailsRequest([user("What's free Friday?"), assistant(tool("check_availability", true, { requested: null }))]),
    ).toBeNull();
  });

  it("not once a quote, booking or lookup already carries the details", () => {
    const quoted = tool("create_booking_draft", true, { customerName: "Jane Citizen", customerEmail: "jane@gmail.com" });
    const messages = [
      user("Room B Wednesday 2-6pm, Jane Citizen, jane@gmail.com"),
      assistant(availability(true, true), quoted),
      user("Actually 3-7pm"),
      assistant(availability(true, true), text("Shall I quote 3-7pm?")),
    ];
    expect(detailsRequest(messages)).toBeNull();
  });

  it("again, prefilled, when the assistant rejects a mistyped email", () => {
    const rejected = tool(
      "create_booking_draft",
      false,
      { error_code: "INVALID_EMAIL" },
      { customer_name: "Jane Citizen", customer_email: "jane@gmail" },
    );
    const messages = [user("Room B Wednesday 2-6pm, Jane Citizen, jane@gmail"), assistant(availability(false, true), rejected)];
    expect(detailsRequest(messages)).toEqual({ name: "Jane Citizen", email: "jane@gmail", retry: true });
  });

  it("not while managing an existing booking, after an error, or while the customer is typing", () => {
    expect(
      detailsRequest([user("Move EE-7K3Q9M to Friday 2-6pm"), assistant(availability(true, true), text("What's the email?"))]),
    ).toBeNull();
    expect(detailsRequest([user("Room B Wednesday 2-6pm"), { ...assistant(availability(true, true)), error: "Busy" }])).toBeNull();
    expect(detailsRequest([user("Room B Wednesday 2-6pm")])).toBeNull();
  });
});
