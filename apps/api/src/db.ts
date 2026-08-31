import pg from "pg";
import type { QueryResultRow } from "pg";

const { Pool } = pg;

function createPoolConfig(): pg.PoolConfig {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000)
    };
  }

  return {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 55432),
    database: process.env.DB_NAME ?? "s100_dev",
    user: process.env.DB_USER ?? "s100_viewer_readonly",
    password: process.env.DB_PASSWORD ?? "CHANGE_ME",
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000)
  };
}

export const pool = new Pool({
  ...createPoolConfig()
});

export async function query<T extends QueryResultRow>(sql: string, values: readonly unknown[] = []) {
  return pool.query<T>(sql, [...values]);
}

export async function closePool() {
  await pool.end();
}
