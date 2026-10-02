import { pool } from "@/lib/db";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]/figures/[figureId]">) {
  const { id, figureId } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const { rows } = await pool.query<{ image: Buffer }>(
    "SELECT image FROM figures WHERE document_id = $1 AND figure_id = $2",
    [id, figureId],
  );
  if (!rows[0]) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(rows[0].image), {
    headers: {
      "Content-Type": "image/png",
      // Figures are regenerated on re-analysis, so do not cache for long.
      "Cache-Control": "private, no-cache",
    },
  });
}
