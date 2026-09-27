import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { paths } from "@/lib/config";

type DB = Database.Database;

const globalForDb = globalThis as unknown as { __fruitSagaDb?: DB };

/**
 * Returns the process-wide SQLite connection, creating the database file and
 * applying pending migrations on first use. The handle is cached on
 * globalThis so hot-reloads in `next dev` do not open a new connection.
 */
export function getDb(): DB {
  if (globalForDb.__fruitSagaDb) return globalForDb.__fruitSagaDb;
  fs.mkdirSync(path.dirname(paths.db), { recursive: true });
  const db = new Database(paths.db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  recoverInterruptedJobs(db);
  globalForDb.__fruitSagaDb = db;
  return db;
}

export function closeDb() {
  globalForDb.__fruitSagaDb?.close();
  globalForDb.__fruitSagaDb = undefined;
}

export function runMigrations(db: DB): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: string }[]).map((r) => r.version),
  );
  const files = fs.existsSync(paths.migrations)
    ? fs.readdirSync(paths.migrations).filter((f) => f.endsWith(".sql")).sort()
    : [];
  const newlyApplied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(paths.migrations, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, now());
    })();
    newlyApplied.push(version);
  }
  return newlyApplied;
}

function pidAlive(pid: number | null): boolean {
  if (!pid) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Jobs left "running" by a process that no longer exists are marked failed so they can be retried. */
function recoverInterruptedJobs(db: DB) {
  const rows = db
    .prepare("SELECT id, runner_pid FROM generation_jobs WHERE status IN ('running','queued')")
    .all() as { id: number; runner_pid: number | null }[];
  const stmt = db.prepare(
    "UPDATE generation_jobs SET status='failed', error='Interrupted: the process running this job stopped. Retry it.', finished_at=? WHERE id=?",
  );
  for (const row of rows) {
    if (row.runner_pid === process.pid) continue;
    if (!pidAlive(row.runner_pid)) stmt.run(now(), row.id);
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
