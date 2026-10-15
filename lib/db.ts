import { neon } from "@neondatabase/serverless";
import { SCHEMA_SQL } from "./schema";

/**
 * The one database surface the app uses. Production talks to Neon Postgres over
 * HTTP; local development and tests run the same SQL on PGlite (Postgres
 * compiled to WASM), so the overlap constraint is exercised everywhere.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--.*\n?)*$/.test(s));
}

export function neonDb(url: string): Db {
  const sql = neon(url);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as T[];
    },
  };
}

/**
 * Applies the idempotent schema once per server instance, so a fresh database
 * needs no manual setup step. Two instances starting at once can race on
 * CREATE ... IF NOT EXISTS; "already exists" errors from that race are fine.
 */
export async function withSchema(db: Db): Promise<Db> {
  for (const statement of splitStatements(SCHEMA_SQL)) {
    try {
      await db.query(statement);
    } catch (err) {
      if (!["42P07", "42710", PG_UNIQUE_VIOLATION].includes(pgErrorCode(err) ?? "")) throw err;
    }
  }
  return db;
}

export async function pgliteDb(dataDir = "memory://"): Promise<Db> {
  const [{ PGlite }, { btree_gist }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/btree_gist"),
  ]);
  if (!dataDir.includes("://")) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dataDir, { recursive: true });
  }
  const pg = await PGlite.create(dataDir, { extensions: { btree_gist } });
  await pg.exec(SCHEMA_SQL);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };
}

const globalForDb = globalThis as unknown as { __db?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!process.env.DATABASE_URL && process.env.VERCEL) {
    // Serverless file systems are read-only and per-instance: an embedded
    // database there would lose bookings and break the overlap guarantee.
    return Promise.reject(new Error("DATABASE_URL is not set for this deployment."));
  }
  globalForDb.__db ??= (
    process.env.DATABASE_URL
      ? withSchema(neonDb(process.env.DATABASE_URL))
      : pgliteDb(process.env.PGLITE_DIR ?? "./.data/pglite")
  ).catch((err) => {
    globalForDb.__db = undefined; // let the next request retry
    throw err;
  });
  return globalForDb.__db;
}

/** Postgres SQLSTATE of a driver error, if any (e.g. 23P01 exclusion violation). */
export function pgErrorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export const PG_EXCLUSION_VIOLATION = "23P01";
export const PG_UNIQUE_VIOLATION = "23505";
