# Assistent

Next.js app for uploading images or PDFs, storing them in PostgreSQL (with pgvector), and previewing them.
A vision LLM (via OpenRouter) can analyze a file: it detects whether it is a scientific paper, converts it
to Markdown, and extracts its figures as cropped images plus JSON metadata. Analyzed papers are then
indexed: their text and figure descriptions are embedded locally and stored in pgvector.

## Requirements

- Node.js 20+
- Docker
- An [OpenRouter](https://openrouter.ai/keys) API key

## Getting started

```bash
cp .env.example .env.local   # set OPENROUTER_API_KEY
docker compose up -d         # Postgres 17 + pgvector; creates the table from db/init.sql
npm install
npm run dev                  # http://localhost:3000
```

## Structure

- `docker-compose.yml` — `pgvector/pgvector:pg17` container.
- `db/001_init.sql` — `vector` extension and `documents` table (file stored as `bytea`, plus an `embedding vector(1536)` column reserved for RAG).
- `db/002_analysis.sql` — `analyses` (status, Markdown, JSON result) and `figures` (cropped PNGs).
- `db/003_analysis_pages.sql` — per-page results, so a failed analysis resumes where it stopped.
- `db/004_chunks.sql` — `chunks` with `vector(384)` embeddings and an HNSW cosine index.
- `src/app/api/files` — `GET` lists files, `POST` uploads one (multipart, `file` field, 20 MB max).
- `src/app/api/files/[id]` — `GET` serves the file inline, `DELETE` removes it.
- `src/app/api/files/[id]/analysis` — `POST` starts an analysis in the background, `GET` returns its status and result.
- `src/app/api/files/[id]/analysis/events` — Server-Sent Events stream of the analysis progress.
- `src/app/api/files/[id]/figures/[figureId]` — `GET` serves a cropped figure.
- `src/app/api/files/[id]/index` — `POST` (re)builds a paper's embeddings.
- `src/app/api/papers` — `GET` lists indexed papers.
- `src/lib/pages.ts` — renders PDF pages with MuPDF and crops figures with sharp.
- `src/lib/analyze.ts` — analysis pipeline and prompts.
- `src/lib/openrouter.ts` — OpenRouter client with model fallbacks and retries.
- `src/lib/chunking.ts` — splits the Markdown into section-aware chunks.
- `src/lib/embeddings.ts` / `src/lib/indexing.ts` — local embedding model and indexing into pgvector.
- `src/lib/events.ts` — in-process change notifications that feed the SSE stream.
- `src/components/Uploader.tsx` — drag-and-drop area, file list, and Preview/Analysis tabs.
- `src/components/AnalysisPanel.tsx` — rendered Markdown next to the JSON result, plus index state.
- `src/components/PaperList.tsx` — list of indexed papers.

## How the analysis works

1. Each page is rendered to an image (plain images are a single page), up to `ANALYSIS_MAX_PAGES`.
2. The first page is sent to the model to classify the document. If it is not a scientific paper, the analysis stops there.
3. Each page is sent with its PDF text layer; the model returns Markdown (LaTeX for equations) and figures with a bounding box normalized to 0-1000.
4. The server crops each figure from the page render, stores it, and replaces the `figure:<ref>` placeholders in the Markdown with the image URL.

5. Once the analysis is done, the paper is indexed (see below).

This takes one request per page. Free OpenRouter models are limited to 20 requests per minute and 50 per day
(1000 per day once the account has bought at least $10 of credits).

## Embeddings

Indexing runs locally with [transformers.js](https://huggingface.co/docs/transformers.js) and
`Xenova/multilingual-e5-small` (384 dimensions, multilingual), so it needs no API key and has no rate limits.
The model (~130 MB) is downloaded to `.cache/models` on first use.

- **Text chunks** follow the paper's sections: each heading starts a new chunk, and longer sections are split
  between paragraphs at ~400 tokens (the model reads at most 512), repeating the previous paragraph for context.
  Each chunk stores its section path and page range.
- **Figure chunks** hold each figure's caption and description, linked to the figure image by `figure_id`.
- The paper title (and section) is prepended to each chunk before embedding. E5 models expect the
  `passage: ` prefix for stored text and `query: ` for search queries.

Example search:

```sql
SELECT kind, section, page_start, content
FROM chunks
ORDER BY embedding <=> $1::vector  -- embedding of "query: <question>"
LIMIT 5;
```

> The SQL files in `db/` only run the first time the volume is created. To apply a new one to an existing database:
> `docker exec -i assistent-db psql -U assistent < db/004_chunks.sql`. To reset the database: `docker compose down -v`.
