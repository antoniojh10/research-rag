import { pool } from "@/lib/db";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const { rows } = await pool.query<{ filename: string; mime_type: string; content: Buffer }>(
    "SELECT filename, mime_type, content FROM documents WHERE id = $1",
    [id],
  );
  const doc = rows[0];
  if (!doc) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(doc.content), {
    headers: {
      "Content-Type": doc.mime_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response(null, { status: 404 });

  const { rowCount } = await pool.query("DELETE FROM documents WHERE id = $1", [id]);
  return new Response(null, { status: rowCount ? 204 : 404 });
}
