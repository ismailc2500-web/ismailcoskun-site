import { ensureBootstrapped, resetDatabase } from "@/lib/bootstrap";
import { listSeries, listCharacters, listLocations } from "@/lib/db/repos/series";
import { listEpisodes } from "@/lib/db/repos/episodes";

/**
 *   npm run db:seed            seed only if the database is empty
 *   npm run db:reset           delete the database and re-import data/series (your mirror) or data/seed
 *   npm run db:reset -- --demo delete the database and re-import the pristine demo from data/seed
 */
const args = process.argv.slice(2);
if (args.includes("--reset")) {
  const ids = resetDatabase({ preferSeed: args.includes("--demo") });
  console.log(`Database reset. Imported: ${ids.join(", ") || "(nothing)"}`);
} else {
  ensureBootstrapped();
}

for (const s of listSeries()) {
  console.log(
    `• ${s.title} (${s.id}) — ${listCharacters(s.id).length} characters, ${listLocations(s.id).length} locations, ${
      listEpisodes(s.id).length
    } episodes`,
  );
}
