import { pool } from "@/lib/db";
import { notifyAnalysisChanged } from "@/lib/events";
import { chunkMarkdown } from "@/lib/chunking";
import { countTokens, embedPassages, toVectorLiteral } from "@/lib/embeddings";
import type { AnalysisResult } from "@/lib/analyze";

// Leaves room within the model's 512 tokens for the "passage:" prefix and the title/section header.
const CHUNK_MAX_TOKENS = 400;

type ChunkRow = {
  kind: "text" | "figure";
  chunkIndex: number;
  section: string | null;
  pageStart: number;
  pageEnd: number;
  figureId: string | null;
  content: string;
  /** What gets embedded: the content plus the context needed to make sense of it on its own. */
  embedText: string;
};

async function setIndexState(documentId: string, status: string, error: string | null = null) {
  await pool.query(
    `UPDATE analyses
     SET index_status = $2, index_error = $3,
         indexed_at = CASE WHEN $2 = 'indexed' THEN now() ELSE indexed_at END
     WHERE document_id = $1`,
    [documentId, status, error],
  );
  notifyAnalysisChanged(documentId);
}

/**
 * Marks an analyzed paper for indexing. Returns false when it is not a finished paper analysis
 * or is already being indexed (a run silent for 10 minutes is assumed dead).
 */
export async function startIndexing(documentId: string) {
  const { rowCount } = await pool.query(
    `UPDATE analyses SET index_status = 'indexing', index_error = NULL, index_started_at = now()
     WHERE document_id = $1 AND status = 'done'
       AND (index_status IS DISTINCT FROM 'indexing' OR index_started_at < now() - interval '10 minutes')`,
    [documentId],
  );
  if (rowCount) notifyAnalysisChanged(documentId);
  return rowCount === 1;
}

export async function runIndexing(documentId: string) {
  try {
    await indexDocument(documentId);
    await setIndexState(documentId, "indexed");
  } catch (err) {
    console.error(`Indexing of ${documentId} failed`, err);
    await setIndexState(documentId, "error", err instanceof Error ? err.message : String(err));
  }
}

async function indexDocument(documentId: string) {
  const analysis = await pool.query<{ result: AnalysisResult }>(
    "SELECT result FROM analyses WHERE document_id = $1 AND status = 'done'",
    [documentId],
  );
  const result = analysis.rows[0]?.result;
  if (!result) throw new Error("El documento no tiene un análisis terminado.");

  const pages = await pool.query<{ page: number; markdown: string }>(
    `SELECT page, data->>'markdown' AS markdown FROM analysis_pages
     WHERE document_id = $1 ORDER BY page`,
    [documentId],
  );

  const title = result.title ?? result.filename;
  const textChunks = await chunkMarkdown(pages.rows, countTokens, CHUNK_MAX_TOKENS);

  const rows: ChunkRow[] = [
    ...textChunks.map((c, i) => ({
      kind: "text" as const,
      chunkIndex: i,
      section: c.section,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      figureId: null,
      content: c.content,
      embedText: [title, c.section, c.content].filter(Boolean).join("\n"),
    })),
    ...result.figures.map((f, i) => {
      // Captions usually start with their own label ("Fig. 1 – ..."); avoid repeating it.
      const caption = f.caption.startsWith(f.label) ? f.caption : `${f.label}: ${f.caption}`;
      const content = [caption, f.description].filter(Boolean).join("\n");
      return {
        kind: "figure" as const,
        chunkIndex: i,
        section: null,
        pageStart: f.page,
        pageEnd: f.page,
        figureId: f.id,
        content,
        embedText: `${title}\n${content}`,
      };
    }),
  ];

  const vectors = await embedPassages(rows.map((r) => r.embedText));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM chunks WHERE document_id = $1", [documentId]);
    for (const [i, row] of rows.entries()) {
      await client.query(
        `INSERT INTO chunks
           (document_id, kind, chunk_index, section, page_start, page_end, figure_id, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)`,
        [
          documentId,
          row.kind,
          row.chunkIndex,
          row.section,
          row.pageStart,
          row.pageEnd,
          row.figureId,
          row.content,
          toVectorLiteral(vectors[i]),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
