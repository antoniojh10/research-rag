import { pool, type IndexedPaper } from "@/lib/db";

/** Papers whose text and figures are embedded in pgvector, most recently indexed first. */
export async function GET() {
  const { rows } = await pool.query<IndexedPaper>(
    `SELECT d.id, d.filename,
            a.result->>'title' AS title,
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(a.result->'authors')), '{}') AS authors,
            (a.result->>'pageCount')::int AS "pageCount",
            count(c.id) FILTER (WHERE c.kind = 'text')::int AS "textChunks",
            count(c.id) FILTER (WHERE c.kind = 'figure')::int AS "figureChunks",
            a.indexed_at AS "indexedAt"
     FROM analyses a
     JOIN documents d ON d.id = a.document_id
     LEFT JOIN chunks c ON c.document_id = a.document_id
     WHERE a.index_status = 'indexed'
     GROUP BY d.id, a.document_id
     ORDER BY a.indexed_at DESC`,
  );
  return Response.json(rows);
}
