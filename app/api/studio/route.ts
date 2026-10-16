import { getDb } from "@/lib/db";
import { ensureDemoSeed } from "@/lib/seed";
import { studioOverview } from "@/lib/studio";
import { studioNow } from "@/lib/time";

/** The studio's dashboard data. Personal details are masked; see lib/studio.ts. */
export async function GET() {
  const db = await getDb();
  const now = studioNow();
  await ensureDemoSeed(db, now);
  return Response.json(await studioOverview(db, now), { headers: { "Cache-Control": "no-store" } });
}
