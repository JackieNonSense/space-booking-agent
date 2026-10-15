import { describe, expect, it } from "vitest";
import { pgliteDb, splitStatements, withSchema } from "@/lib/db";
import { SCHEMA_SQL } from "@/lib/schema";

describe("schema setup", () => {
  it("splits the schema into individual statements", () => {
    const statements = splitStatements(SCHEMA_SQL);
    expect(statements.length).toBeGreaterThan(5);
    expect(statements.every((s) => !s.endsWith(";"))).toBe(true);
  });

  it("can be applied again to an existing database", async () => {
    const db = await pgliteDb(); // already has the schema
    await expect(withSchema(db)).resolves.toBe(db);
    const [{ count }] = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM bookings`);
    expect(count).toBe(0);
  });
});
