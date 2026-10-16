import { getDb } from "@/lib/db";
import { conversationTranscript } from "@/lib/studio";

/** One conversation as the studio sees it, with personal details masked. */
export async function GET(_request: Request, ctx: RouteContext<"/api/studio/conversations/[id]">) {
  const { id } = await ctx.params;
  if (!/^cv_[a-z0-9]{16}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const transcript = await conversationTranscript(await getDb(), id);
  if (!transcript) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(transcript, { headers: { "Cache-Control": "no-store" } });
}
