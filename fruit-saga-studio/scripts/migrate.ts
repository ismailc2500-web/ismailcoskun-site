import { getDb, runMigrations } from "@/lib/db";
import { paths } from "@/lib/config";

const db = getDb();
const applied = runMigrations(db);
const all = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
console.log(`Database: ${paths.db}`);
console.log(applied.length ? `Applied now: ${applied.join(", ")}` : "No pending migrations.");
console.table(all);
