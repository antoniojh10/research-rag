import { after } from "next/server";
import { runIndexing, startIndexing } from "@/lib/indexing";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** (Re)builds the embeddings of an analyzed paper in the background. */
export async function POST(_req: Request, ctx: RouteContext<"/api/files/[id]/index">) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ error: "No encontrado." }, { status: 404 });

  if (!(await startIndexing(id))) {
    return Response.json(
      { error: "Solo se pueden indexar papers con el análisis terminado, y no mientras ya se indexan." },
      { status: 409 },
    );
  }

  after(() => runIndexing(id));
  return Response.json({ status: "indexing" }, { status: 202 });
}
