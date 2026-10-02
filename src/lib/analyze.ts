import { pool } from "@/lib/db";
import { notifyAnalysisChanged } from "@/lib/events";
import { runIndexing, startIndexing } from "@/lib/indexing";
import { chatJson, MODELS } from "@/lib/openrouter";
import { countPages, cropFigure, normalizeBbox, renderPages, toModelImage, type PageImage } from "@/lib/pages";

const MAX_PAGES = Number(process.env.ANALYSIS_MAX_PAGES) || 30;

type RawBbox = { x_min: number; y_min: number; x_max: number; y_max: number };

type RawFigure = {
  ref: string;
  label: string;
  caption: string;
  description: string;
  bbox: RawBbox;
};

type PageResult = { markdown: string; figures: RawFigure[] };

type Classification = {
  is_scientific_paper: boolean;
  reason: string;
  title: string | null;
  authors: string[];
};

type FirstPageResult = PageResult & Classification;

/** What is stored per page in analysis_pages.data. */
type StoredPage = {
  markdown: string;
  figures: FigureJson[];
  classification?: Classification;
};

export type FigureJson = {
  id: string;
  label: string;
  caption: string;
  description: string;
  page: number;
  /** Normalized to 0-1 relative to the page: [x0, y0, x1, y1]. */
  bbox: [number, number, number, number];
  imageUrl: string;
};

export type AnalysisResult = {
  documentId: string;
  filename: string;
  /** Models that answered, in page order (fallbacks appear when the primary was saturated). */
  models: string[];
  isScientificPaper: boolean;
  reason: string;
  title: string | null;
  authors: string[];
  pageCount: number;
  analyzedPages: number;
  figures: FigureJson[];
};

/** Lightweight state pushed over SSE while an analysis runs. */
export type AnalysisProgress = {
  status: "pending" | "processing" | "done" | "not_paper" | "error";
  model: string;
  pagesTotal: number;
  pagesDone: number;
  reason: string | null;
  error: string | null;
  updatedAt: string;
  /** Embedding index state: null (not indexed) | indexing | indexed | error. */
  indexStatus: "indexing" | "indexed" | "error" | null;
  indexError: string | null;
  textChunks: number;
  figureChunks: number;
};

/** Full analysis, fetched once it is done. */
export type AnalysisStatus = AnalysisProgress & {
  markdown: string | null;
  result: unknown;
};

const PROGRESS_COLUMNS = `status, model, pages_total AS "pagesTotal", pages_done AS "pagesDone",
  reason, error, updated_at AS "updatedAt", index_status AS "indexStatus", index_error AS "indexError",
  (SELECT count(*)::int FROM chunks c WHERE c.document_id = analyses.document_id AND c.kind = 'text') AS "textChunks",
  (SELECT count(*)::int FROM chunks c WHERE c.document_id = analyses.document_id AND c.kind = 'figure') AS "figureChunks"`;

export async function getAnalysisProgress(documentId: string) {
  const { rows } = await pool.query<AnalysisProgress>(
    `SELECT ${PROGRESS_COLUMNS} FROM analyses WHERE document_id = $1`,
    [documentId],
  );
  return rows[0] ?? null;
}

export async function getAnalysis(documentId: string) {
  const { rows } = await pool.query<AnalysisStatus>(
    `SELECT ${PROGRESS_COLUMNS}, markdown, result FROM analyses WHERE document_id = $1`,
    [documentId],
  );
  return rows[0] ?? null;
}

const figureSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ref", "label", "caption", "description", "bbox"],
  properties: {
    ref: { type: "string", description: "Short id unique within this page, e.g. F1, F2." },
    label: { type: "string", description: 'Label as printed, e.g. "Figure 3". Empty if unlabeled.' },
    caption: { type: "string", description: "Full caption text, verbatim." },
    description: { type: "string", description: "One or two sentences describing what the figure shows." },
    bbox: {
      type: "object",
      additionalProperties: false,
      required: ["x_min", "y_min", "x_max", "y_max"],
      description: "Box around the figure graphic (without caption), integers normalized 0-1000.",
      properties: {
        x_min: { type: "integer" },
        y_min: { type: "integer" },
        x_max: { type: "integer" },
        y_max: { type: "integer" },
      },
    },
  },
};

const pageProperties = {
  markdown: { type: "string" },
  figures: { type: "array", items: figureSchema },
};

const pageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["markdown", "figures"],
  properties: pageProperties,
};

const firstPageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["is_scientific_paper", "reason", "title", "authors", "markdown", "figures"],
  properties: {
    is_scientific_paper: { type: "boolean" },
    reason: { type: "string", description: "Brief justification of the classification." },
    title: { type: ["string", "null"] },
    authors: { type: "array", items: { type: "string" } },
    ...pageProperties,
  },
};

const CONVERSION_RULES = `Transcribe the page into GitHub-flavored Markdown:
- Keep the original language and wording; do not summarize.
- Use #/##/### for the paper title and section headings.
- Write equations in LaTeX: $...$ inline and $$...$$ for display equations.
- Convert tables into Markdown tables.
- Omit running headers, footers and page numbers.
- For every figure (plots, diagrams, photos, illustrations — not tables), add an entry to "figures"
  and put the placeholder ![<label>](figure:<ref>) in the markdown where the figure appears,
  followed by its caption in italics.
- bbox coordinates are integers normalized to 0-1000 over the page image: x_min/x_max measured from
  the left edge, y_min/y_max from the top edge. The box must tightly enclose the figure graphic,
  excluding its caption.`;

// Not every fallback model enforces response_format, so the schema is also spelled out in the prompt.
const jsonInstruction = (schema: object) =>
  `\n\nRespond with a single JSON object, no prose, matching this JSON Schema:\n${JSON.stringify(schema)}`;

const FIRST_PAGE_PROMPT = `You analyze documents. First decide whether this document is a scientific paper
(research article, preprint, conference/journal paper or thesis with academic structure).
Set is_scientific_paper and give a short reason. If it is not a scientific paper, return empty
markdown, an empty figures array, null title and empty authors.

If it is a scientific paper, extract the title and authors and:
${CONVERSION_RULES}${jsonInstruction(firstPageSchema)}`;

const PAGE_PROMPT = `You convert pages of a scientific paper into Markdown.
${CONVERSION_RULES}${jsonInstruction(pageSchema)}`;

function pageContent(page: PageImage, image: Buffer, totalPages: number) {
  const intro = `Page ${page.number} of ${totalPages}.`;
  const textLayer = page.text
    ? `\n\nText layer extracted from the PDF (use it for exact wording; the image is authoritative for layout):\n"""\n${page.text}\n"""`
    : "";
  return [
    { type: "text" as const, text: intro + textLayer },
    { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
  ];
}

async function setProgress(documentId: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await pool.query(`UPDATE analyses SET ${sets}, updated_at = now() WHERE document_id = $1`, [
    documentId,
    ...keys.map((k) => fields[k]),
  ]);
  notifyAnalysisChanged(documentId);
}

/**
 * Queues an analysis. With `restart`, previous page results are discarded; otherwise pages that
 * already succeeded are reused. Returns false if an analysis is already running.
 */
export async function startAnalysis(documentId: string, restart: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `INSERT INTO analyses (document_id, status, model)
       VALUES ($1, 'pending', $2)
       ON CONFLICT (document_id) DO UPDATE
         SET status = 'pending', model = $2, is_paper = NULL, reason = NULL, markdown = NULL,
             result = NULL, error = NULL, updated_at = now(),
             index_status = NULL, index_error = NULL, indexed_at = NULL
         -- A run that has not reported progress in 10 minutes is assumed dead (e.g. server restart).
         WHERE analyses.status NOT IN ('pending', 'processing')
            OR analyses.updated_at < now() - interval '10 minutes'`,
      [documentId, MODELS.join(", ")],
    );
    // The new analysis replaces the indexed content; it is re-indexed once the analysis finishes.
    if (rowCount === 1) {
      await client.query("DELETE FROM chunks WHERE document_id = $1", [documentId]);
    }
    if (rowCount === 1 && restart) {
      await client.query("DELETE FROM analysis_pages WHERE document_id = $1", [documentId]);
      await client.query("DELETE FROM figures WHERE document_id = $1", [documentId]);
      await client.query("UPDATE analyses SET pages_done = 0 WHERE document_id = $1", [documentId]);
    }
    await client.query("COMMIT");
    if (rowCount === 1) notifyAnalysisChanged(documentId);
    return rowCount === 1;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function runAnalysis(documentId: string) {
  try {
    await analyze(documentId);
  } catch (err) {
    console.error(`Analysis of ${documentId} failed`, err);
    await setProgress(documentId, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  // Only finished paper analyses are indexed; startIndexing skips anything else.
  if (await startIndexing(documentId)) await runIndexing(documentId);
}

async function analyze(documentId: string) {
  const { rows } = await pool.query<{ filename: string; mime_type: string; content: Buffer }>(
    "SELECT filename, mime_type, content FROM documents WHERE id = $1",
    [documentId],
  );
  const doc = rows[0];
  if (!doc) return;

  const pageCount = countPages(doc.content, doc.mime_type);
  const analyzedPages = Math.min(pageCount, MAX_PAGES);

  const stored = await pool.query<{ page: number; model: string; data: StoredPage }>(
    "SELECT page, model, data FROM analysis_pages WHERE document_id = $1 AND page <= $2",
    [documentId, analyzedPages],
  );
  const pages = new Map(stored.rows.map((r) => [r.page, r]));
  await setProgress(documentId, {
    status: "processing",
    pages_total: analyzedPages,
    pages_done: pages.size,
  });

  // Resuming a document already classified as not a paper must not convert its other pages.
  const knownNotPaper = pages.get(1)?.data.classification?.is_scientific_paper === false;
  const needed = (n: number) => !knownNotPaper && !pages.has(n);
  for await (const page of renderPages(doc.content, doc.mime_type, MAX_PAGES, needed)) {
    const image = await toModelImage(page);
    const content = pageContent(page, image, analyzedPages);

    let data: StoredPage;
    let model: string;
    if (page.number === 1) {
      const res = await chatJson<FirstPageResult>({
        system: FIRST_PAGE_PROMPT,
        content,
        schemaName: "first_page",
        schema: firstPageSchema,
      });
      const { markdown, figures, ...classification } = res.data;
      const placed = classification.is_scientific_paper
        ? await placeFigures(documentId, page, { markdown, figures })
        : { markdown: "", figures: [] };
      data = { ...placed, classification };
      model = res.model;
    } else {
      const res = await chatJson<PageResult>({
        system: PAGE_PROMPT,
        content,
        schemaName: "page",
        schema: pageSchema,
      });
      data = await placeFigures(documentId, page, res.data);
      model = res.model;
    }

    await pool.query(
      `INSERT INTO analysis_pages (document_id, page, model, data) VALUES ($1, $2, $3, $4)
       ON CONFLICT (document_id, page) DO UPDATE SET model = $3, data = $4, created_at = now()`,
      [documentId, page.number, model, JSON.stringify(data)],
    );
    pages.set(page.number, { page: page.number, model, data });
    await setProgress(documentId, { pages_done: pages.size });

    const classification = pages.get(1)?.data.classification;
    if (classification && !classification.is_scientific_paper) break;
  }

  const classification = pages.get(1)?.data.classification;
  if (!classification) throw new Error("El documento no tiene páginas.");

  if (!classification.is_scientific_paper) {
    await setProgress(documentId, {
      status: "not_paper",
      is_paper: false,
      reason: classification.reason,
      result: JSON.stringify({
        documentId,
        filename: doc.filename,
        models: [pages.get(1)!.model],
        isScientificPaper: false,
        reason: classification.reason,
      }),
    });
    return;
  }

  const ordered = [...pages.values()].sort((a, b) => a.page - b.page);
  const result: AnalysisResult = {
    documentId,
    filename: doc.filename,
    models: ordered.map((p) => p.model),
    isScientificPaper: true,
    reason: classification.reason,
    title: classification.title,
    authors: classification.authors,
    pageCount,
    analyzedPages,
    figures: ordered.flatMap((p) => p.data.figures),
  };
  await setProgress(documentId, {
    status: "done",
    is_paper: true,
    reason: classification.reason,
    markdown: ordered.map((p) => p.data.markdown).join("\n\n"),
    result: JSON.stringify(result),
  });
}

/** Crops and stores each figure, then points the page's markdown placeholders at the stored images. */
async function placeFigures(documentId: string, page: PageImage, result: PageResult) {
  let markdown = result.markdown ?? "";
  const figures: FigureJson[] = [];
  // Discard crops from an earlier attempt at this page.
  await pool.query("DELETE FROM figures WHERE document_id = $1 AND page = $2", [documentId, page.number]);

  for (const [i, raw] of (result.figures ?? []).entries()) {
    const id = `p${page.number}-f${i + 1}`;
    const b = raw.bbox;
    const bbox = b ? normalizeBbox([b.x_min, b.y_min, b.x_max, b.y_max]) : null;
    const placeholder = `(figure:${raw.ref})`;

    if (!bbox) {
      markdown = markdown.replaceAll(placeholder, "()");
      continue;
    }

    const image = await cropFigure(page, bbox);
    await pool.query(
      `INSERT INTO figures (document_id, figure_id, page, image) VALUES ($1, $2, $3, $4)
       ON CONFLICT (document_id, figure_id) DO UPDATE SET page = $3, image = $4`,
      [documentId, id, page.number, image],
    );

    const imageUrl = `/api/files/${documentId}/figures/${id}`;
    const label = raw.label || `Figure (p. ${page.number})`;
    figures.push({
      id,
      label,
      caption: raw.caption,
      description: raw.description,
      page: page.number,
      bbox: bbox.map((n) => n / 1000) as FigureJson["bbox"],
      imageUrl,
    });

    if (markdown.includes(placeholder)) {
      markdown = markdown.replaceAll(placeholder, `(${imageUrl})`);
    } else {
      // The model listed the figure but forgot the placeholder: append it to the page.
      markdown += `\n\n![${label}](${imageUrl})\n\n*${raw.caption}*`;
    }
  }

  // Drop placeholders that reference figures the model never described.
  markdown = markdown.replace(/!\[[^\]]*\]\(figure:[^)]*\)|!\[[^\]]*\]\(\)/g, "");
  return { markdown, figures };
}
