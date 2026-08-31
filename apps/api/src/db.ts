import pg from "pg";
import type { QueryResultRow } from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://s100_dev:CHANGE_ME_LOCAL_ONLY@127.0.0.1:55432/s100_dev",
  max: 10,
  idleTimeoutMillis: 30_000
});

export async function query<T extends QueryResultRow>(sql: string, values: readonly unknown[] = []) {
  return pool.query<T>(sql, [...values]);
}
