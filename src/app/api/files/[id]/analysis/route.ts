import { after } from "next/server";
import { pool } from "@/lib/db";
import { getAnalysis, runAnalysis, startAnalysis } from "@/lib/analyze";

const UUID_RE = /^[0-9a-f-]{36}$/i;

// Analysis runs in the background; allow it to outlive the response on platforms that cap duration.
export const maxDuration = 800;

export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]/analysis">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json(null, { status: 404 });

  const analysis = await getAnalysis(id);
  return Response.json(analysis, { status: analysis ? 200 : 404 });
}

/** Body: `{ "restart": true }` discards previous page results; by default the analysis resumes. */
export async function POST(req: Request, ctx: RouteContext<"/api/files/[id]/analysis">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: "No encontrado." }, { status: 404 });

  const { rowCount } = await pool.query("SELECT 1 FROM documents WHERE id = $1", [id]);
  if (!rowCount) return Response.json({ error: "No encontrado." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (!(await startAnalysis(id, body?.restart === true))) {
    return Response.json({ error: "El análisis ya está en curso." }, { status: 409 });
  }

  after(() => runAnalysis(id));
  return Response.json({ status: "pending" }, { status: 202 });
}
